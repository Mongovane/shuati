import { json, checkAuth, rowToQuestion, ensureSrsSchema, ensureFts, ftsQuote, batchChunked } from './_utils.js';

export async function onRequestGet({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;

  await ensureSrsSchema(env); // 旧库自动补 SRS 列，保证下方 pr.due_at 可用

  const p = new URL(request.url).searchParams;

  // —— meta：给前端筛选器用的科目 / 章节清单（不含待审核草稿；另附草稿数供题库页角标）——
  if (p.get('meta')) {
    const subjStmt = env.DB.prepare(
      `SELECT subject, COUNT(*) AS n FROM questions WHERE IFNULL(status,'') <> 'draft' GROUP BY subject`
    );
    const chapStmt = env.DB.prepare(
      `SELECT subject, chapter, COUNT(*) AS n FROM questions
       WHERE chapter IS NOT NULL AND chapter <> '' AND IFNULL(status,'') <> 'draft' GROUP BY subject, chapter ORDER BY subject, chapter`
    );
    let drafts = 0;
    try { const d = await env.DB.prepare(`SELECT COUNT(*) AS n FROM questions WHERE status = 'draft'`).first(); drafts = (d && d.n) || 0; } catch (_) {}
    const [subs, chaps] = await Promise.all([subjStmt.all(), chapStmt.all()]);
    return json({ subjects: subs.results, chapters: chaps.results, drafts });
  }

  const subject = p.get('subject');
  const chapter = p.get('chapter');
  const type = p.get('type');
  const mode = p.get('mode') || 'all';
  const search = p.get('q');
  const idsParam = (p.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);
  const order = ['seq','weak','due'].includes(p.get('order')) ? p.get('order') : 'random';
  const limit = Math.min(parseInt(p.get('limit') || '20', 10) || 20, 200);
  const offset = parseInt(p.get('offset') || '0', 10) || 0;
  // nocount=1：跳过 COUNT 总数查询（分页续拉/离线全量下载用，省一次带 JOIN 的全表扫），total 返回 -1
  const noCount = p.get('nocount') === '1';

  const where = [];
  const binds = [];
  if (idsParam.length) { where.push(`q.id IN (${idsParam.map(() => '?').join(',')})`); binds.push(...idsParam); }
  if (subject && subject !== 'all') { where.push('q.subject = ?'); binds.push(subject); }
  if (chapter) { where.push('q.chapter = ?'); binds.push(chapter); }
  if (type) { where.push('q.type = ?'); binds.push(type); }
  // —— 标签筛选：tags 以 JSON 数组字符串存储（["指针","链表"]），按整词 "tag" 匹配 ——
  const tag = (p.get('tag') || '').trim().replace(/["\\%_]/g, '');
  if (tag) { where.push('q.tags LIKE ?'); binds.push('%"' + tag + '"%'); }
  // —— 待审核（AI 导入草稿）：status=draft 时只看草稿；默认把草稿排除在刷题/模考/离线包之外；ids 精确取题不受限 ——
  // 单独放一个 draftCond（不进 where 数组），避免占掉「无筛选随机抽题」的 rowid 快路径判断位
  const draftCond = p.get('status') === 'draft' ? `q.status = 'draft'`
    : (!idsParam.length ? `IFNULL(q.status,'') <> 'draft'` : '');

  if (mode === 'wrong') where.push('pr.wrong_count > 0 AND IFNULL(pr.mastered, 0) = 0');
  else if (mode === 'favorite') where.push('IFNULL(pr.favorited, 0) = 1');
  else if (mode === 'mastered') where.push('IFNULL(pr.mastered, 0) = 1');
  else if (mode === 'unseen') where.push('pr.question_id IS NULL');
  else if (mode === 'due') where.push('IFNULL(pr.mastered, 0) = 0 AND pr.due_at IS NOT NULL AND pr.due_at <= unixepoch()');

  // —— 关键词检索：优先 FTS5 trigram（题量过万时 LIKE 全表扫极费 D1 读配额）——
  // trigram 只能命中 ≥3 字符的子串；短词、FTS 不可用、或 MATCH 出错时回退 LIKE
  const kw = (search || '').trim();
  let ftsTry = false;
  if (kw) ftsTry = kw.length >= 3 && (await ensureFts(env)) === 'ok';
  const withSearch = (useFts) => {
    if (!kw) return { w: where, b: binds };
    const w = [...where], b = [...binds];
    if (useFts) { w.push('q.rowid IN (SELECT rowid FROM questions_fts WHERE questions_fts MATCH ?)'); b.push(ftsQuote(kw)); }
    else { w.push('(q.stem LIKE ? OR q.chapter LIKE ?)'); b.push(`%${kw}%`, `%${kw}%`); }
    return { w, b };
  };

  // —— 轻量投影（light=1）——
  // 刷题页取一批 30 题时，analysis（参考解析）和 ai_cards（知识点卡片）加起来能占
  // 整个响应的 40%（实测 220KB 里 analysis 88KB + ai_cards 6KB），
  // 而这两样在「答题阶段」根本不显示 —— 用户揭晓答案时才需要，那时按 id 单独取更划算。
  // 骨架屏转很久的主因就是这坨用不上的负载。
  const light = p.get('light') === '1';
  const qCols = light
    ? `q.id, q.subject, q.chapter, q.type, q.difficulty, q.source, q.page, q.passage, q.stem,
       q.options, q.answer, q.tags, q.status, q.created_at,
       (CASE WHEN IFNULL(q.analysis,'') <> '' THEN 1 ELSE 0 END) AS has_analysis,
       (CASE WHEN IFNULL(q.ai_cards,'') NOT IN ('','[]') THEN 1 ELSE 0 END) AS has_cards`
    : 'q.*';
  const baseSelect = `SELECT ${qCols}, pr.wrong_count, pr.right_count, pr.favorited, pr.mastered, pr.due_at, pr.note AS user_note
                      FROM questions q
                      LEFT JOIN progress pr ON pr.question_id = q.id`;

  // —— 只要 id（idsonly=1）——
  // 「全选全部匹配」要跨页拿到所有 id，但题干里可能内嵌 base64 插图，
  // 整批拉回前端会是几 MB。这里只查 id 列，几千条也就几十 KB。
  const idsCap = Math.min(Math.max(parseInt(p.get('cap') || '5000', 10) || 5000, 1), 20000);
  if (p.get('idsonly') === '1') {
    const doIds = async (useFts) => {
      const { w, b } = withSearch(useFts);
      const conds = draftCond ? [...w, draftCond] : w;
      const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
      const rs = await env.DB.prepare(
        `SELECT q.id FROM questions q LEFT JOIN progress pr ON pr.question_id = q.id
         ${whereSql} ORDER BY q.rowid LIMIT ?`
      ).bind(...b, idsCap).all();
      return ((rs && rs.results) || []).map((r) => r.id);
    };
    try {
      const ids = await doIds(ftsTry);
      return json({ ids, count: ids.length, truncated: ids.length >= idsCap });
    } catch (e) {
      if (ftsTry) {
        try { const ids = await doIds(false); return json({ ids, count: ids.length, truncated: ids.length >= idsCap }); } catch (_) { /* 落到下面报错 */ }
      }
      return json({ error: '查询 id 失败：' + e.message }, 500);
    }
  }

  const run = async (useFts) => {
    const { w, b } = withSearch(useFts);
    const where = w, binds = b;
    const conds = draftCond ? [...where, draftCond] : where;      // draftCond 只拼 SQL，不影响快路径判断
    const whereSql = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*) AS total FROM questions q
                    LEFT JOIN progress pr ON pr.question_id = q.id ${whereSql}`;
    let rows, total;
    if (order === 'random' && !where.length) {
      // 全表无筛选时的高效随机：随机取一个 rowid 阈值，从该点起按 rowid 顺序取 limit 条，不足则从头补齐，再打乱。
      // 避免 ORDER BY RANDOM() 对整张表排序造成的全表扫描与高额 D1 读配额（上万题时尤其明显）。
      const draftAnd = draftCond ? ` AND ${draftCond}` : '';
      const draftWhere = draftCond ? `WHERE ${draftCond} ` : '';
      const mx = await env.DB.prepare('SELECT MAX(rowid) AS m FROM questions').first();
      const maxId = (mx && mx.m) || 0;
      const threshold = maxId > 0 ? Math.floor(Math.random() * maxId) : 0;
      const r1 = await env.DB.prepare(`${baseSelect} WHERE q.rowid >= ?${draftAnd} ORDER BY q.rowid ASC LIMIT ?`).bind(threshold, limit).all();
      rows = r1.results || [];
      if (rows.length < limit) { // 阈值靠后，从头补齐
        const r2 = await env.DB.prepare(`${baseSelect} ${draftWhere}ORDER BY q.rowid ASC LIMIT ?`).bind(limit).all();
        const got = new Set(rows.map(r => r.id));
        for (const r of (r2.results || [])) { if (!got.has(r.id)) { rows.push(r); got.add(r.id); if (rows.length >= limit) break; } }
      }
      for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = rows[i]; rows[i] = rows[j]; rows[j] = t; }
      const c = noCount ? null : await env.DB.prepare(countSql).bind(...binds).first();
      total = noCount ? -1 : (c?.total ?? rows.length);
    } else if (order === 'random') {
      // 有筛选条件时命中集较小：直接在子集上 ORDER BY RANDOM()，保证均匀（rowid 阈值法在稀疏子集上会偏向连续区段）
      const [list, cnt] = await Promise.all([
        env.DB.prepare(`${baseSelect} ${whereSql} ORDER BY RANDOM() LIMIT ?`).bind(...binds, limit).all(),
        noCount ? Promise.resolve(null) : env.DB.prepare(countSql).bind(...binds).first(),
      ]);
      rows = list.results || []; total = noCount ? -1 : (cnt?.total ?? rows.length);
    } else {
      const orderBy = order === 'seq' ? 'q.created_at ASC, q.id ASC'
        : order === 'due' ? 'pr.due_at ASC'                                            // due：最早到期优先
        : 'IFNULL(pr.wrong_count,0) DESC, IFNULL(pr.right_count,0) ASC, RANDOM()'; // weak：最不熟优先
      const sql = `${baseSelect} ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
      const [list, cnt] = await Promise.all([
        env.DB.prepare(sql).bind(...binds, limit, offset).all(),
        noCount ? Promise.resolve(null) : env.DB.prepare(countSql).bind(...binds).first(),
      ]);
      rows = list.results; total = noCount ? -1 : (cnt?.total ?? rows.length);
    }
    return { rows, total };
  };

  try {
    let out;
    try { out = await run(ftsTry); }
    catch (e) {
      if (!ftsTry) throw e;
      out = await run(false); // FTS 查询异常（索引损坏等罕见情况）：降级 LIKE 保功能
    }
    return json({ items: out.rows.map(rowToQuestion), total: out.total });
  } catch (e) {
    return json({ error: '查询失败：' + e.message }, 500);
  }
}

// —— 删除题目（按 id 批量）——
export async function onRequestDelete({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求体解析失败' }, 400); }
  // 上限 200：id IN (?,?,…) 每个 id 占一个绑定变量，一次几百个会撞 D1 的变量上限。
  // 前端按 80 分批发，这里只是兜底（超出的截断而不是静默失败，deleted 会如实反映）。
  const ids = (Array.isArray(body && body.ids) ? body.ids.filter(Boolean) : (body && body.id ? [body.id] : [])).slice(0, 200);
  if (!ids.length) return json({ error: '缺少要删除的题目 id' }, 400);
  try {
    const ph = ids.map(() => '?').join(',');
    // batch = 单事务：progress 与 questions 要么都删要么都不删，不留孤儿
    const rs = await env.DB.batch([
      env.DB.prepare(`DELETE FROM progress WHERE question_id IN (${ph})`).bind(...ids),
      env.DB.prepare(`DELETE FROM questions WHERE id IN (${ph})`).bind(...ids),
    ]);
    const r = rs && rs[1];
    const deleted = (r && r.meta && r.meta.changes != null) ? r.meta.changes : ids.length;
    return json({ ok: true, deleted });
  } catch (e) {
    return json({ error: '删除失败：' + e.message }, 500);
  }
}

// —— 更新题目字段（按 id 批量；可改 科目/章节/题干/解析/题型/难度）——
export async function onRequestPatch({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求体解析失败' }, 400); }
  const ALLOWED = ['subject', 'chapter', 'type', 'difficulty', 'stem', 'passage', 'analysis', 'options', 'answer', 'tags', 'status', 'ai_cards'];
  const JSON_FIELDS = new Set(['options', 'answer', 'tags', 'ai_cards']);

  // —— 逐题不同值的批量更新：body.items = [{id, ...字段}] ——
  //
  // 原有的 {ids, 字段} 是「给所有 id 设同一个值」，AI 补答案这种每题答案都不一样的场景用不上，
  // 前端只能一题发一个 PATCH —— 100 题就是 100 个往返，而且中间失败会留下补了一半的状态。
  // 这里补一条按 id 分别赋值的入口，一次请求搞定，D1 侧走 batch（同一事务）。
  //
  // 只开放 answer / analysis / status / difficulty 四个字段：这是「补答案」「批量订正」真正需要的，
  // 题干、选项、科目这些结构性字段仍然只能走单值路径，避免一个接口能改一切。
  if (Array.isArray(body && body.items)) {
    const PER_ITEM = new Set(['answer', 'analysis', 'status', 'difficulty']);
    const MAX = 200;
    const raw = body.items.filter((it) => it && it.id).slice(0, MAX);
    if (!raw.length) return json({ error: 'items 里没有可更新的条目' }, 400);
    if (body.items.length > MAX) return json({ error: `items 一次最多 ${MAX} 条` }, 400);

    // 先确认哪些 id 真的存在，不存在的如实报出来而不是当成成功
    const idList = [...new Set(raw.map((it) => String(it.id)))];
    const exist = new Set();
    try {
      for (let i = 0; i < idList.length; i += 80) {
        const part = idList.slice(i, i + 80);
        const rs = await env.DB.prepare(
          `SELECT id FROM questions WHERE id IN (${part.map(() => '?').join(',')})`
        ).bind(...part).all();
        for (const r of (rs && rs.results) || []) exist.add(String(r.id));
      }
    } catch (e) {
      return json({ error: '校验题目 id 失败：' + e.message }, 500);
    }

    const stmts = [];
    const skipped = [];
    for (const it of raw) {
      const id = String(it.id);
      if (!exist.has(id)) continue;                    // 不存在 → 落到 missing
      const sets2 = [], vals2 = [];
      for (const k of ALLOWED) {
        if (!PER_ITEM.has(k)) continue;
        if (it[k] === undefined || it[k] === null) continue;   // 与单值路径一致：不传就不动
        if (k === 'status') {
          const v = String(it[k]); if (v !== 'draft' && v !== 'ok') continue;
          sets2.push('status = ?'); vals2.push(v); continue;
        }
        sets2.push(`${k} = ?`);
        if (k === 'difficulty') vals2.push(Number(it[k]) || 3);
        else if (JSON_FIELDS.has(k)) vals2.push(JSON.stringify(Array.isArray(it[k]) ? it[k] : (it[k] === '' ? [] : [it[k]])));
        else vals2.push(String(it[k]));
      }
      if (!sets2.length) { skipped.push(id); continue; }        // 一个可写字段都没带
      stmts.push(env.DB.prepare(`UPDATE questions SET ${sets2.join(', ')} WHERE id = ?`).bind(...vals2, id));
    }
    if (!stmts.length) {
      return json({ ok: true, updated: 0, matched: 0, missing: idList.filter((x) => !exist.has(x)), skipped });
    }
    try {
      await batchChunked(env, stmts, 80);
    } catch (e) {
      return json({ error: '批量更新失败：' + e.message }, 500);
    }
    return json({
      ok: true, updated: stmts.length, matched: stmts.length,
      missing: idList.filter((x) => !exist.has(x)), skipped,
    });
  }

  const ids = Array.isArray(body && body.ids) ? body.ids.filter(Boolean) : (body && body.id ? [body.id] : []);
  if (!ids.length) return json({ error: '缺少题目 id' }, 400);
  const sets = [], vals = [];
  for (const k of ALLOWED) {
    if (body[k] !== undefined && body[k] !== null) {
      if (k === 'status') { const v = String(body[k]); if (v !== 'draft' && v !== 'ok') continue; sets.push('status = ?'); vals.push(v); continue; }
      sets.push(`${k} = ?`);
      if (k === 'difficulty') vals.push(Number(body[k]) || 3);
      else if (JSON_FIELDS.has(k)) vals.push(JSON.stringify(Array.isArray(body[k]) ? body[k] : (body[k] === '' ? [] : [body[k]])));
      else vals.push(String(body[k]));
    }
  }
  // —— 标签增量改：addTags / removeTags ——
  // 前端原来的做法是「读本页 items 里的 tags → 在前端合并 → 每题发一个 PATCH」，
  // 两个毛病：(a) 勾 50 题就是 50 个请求；(b) 跨页勾选的 id 不在 items 里会被静默跳过，
  // 但提示照样说「已给 N 题加标签」。改成服务端读改写，任意条数都是常数次 D1 调用。
  const normTags = (v) => (Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]))
    .map((x) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 50);
  const addTags = normTags(body.addTags);
  const delTags = normTags(body.removeTags);
  if (addTags.length || delTags.length) {
    if (body.tags !== undefined && body.tags !== null) {
      return json({ error: 'tags 与 addTags/removeTags 不能同时使用' }, 400);
    }
    try {
      // id IN (...) 的占位符要分块，否则条数一多就撞 D1 的变量上限
      const CH = 80;
      const rows = [];
      for (let i = 0; i < ids.length; i += CH) {
        const part = ids.slice(i, i + CH);
        const rs = await env.DB.prepare(
          `SELECT id, tags FROM questions WHERE id IN (${part.map(() => '?').join(',')})`
        ).bind(...part).all();
        for (const r of (rs && rs.results) || []) rows.push(r);
      }
      const del = new Set(delTags);
      const stmts = [];
      for (const r of rows) {
        let cur = [];
        try { const p = JSON.parse(r.tags); if (Array.isArray(p)) cur = p.map((x) => String(x)); } catch { /* 脏数据当空数组 */ }
        const merged = [...new Set([...cur, ...addTags])].filter((t) => !del.has(t)).slice(0, 50);
        const same = merged.length === cur.length && merged.every((t, i) => t === cur[i]);
        if (same) continue;                                  // 没变化就不写，省 D1 写次数
        stmts.push(env.DB.prepare(`UPDATE questions SET tags = ? WHERE id = ?`).bind(JSON.stringify(merged), r.id));
      }
      if (stmts.length) await batchChunked(env, stmts, 80);
      if (!sets.length) {
        // 找不到的 id 如实报出来，不再假装全部成功
        return json({ ok: true, updated: stmts.length, matched: rows.length, missing: ids.length - rows.length });
      }
    } catch (e) {
      return json({ error: '更新标签失败：' + e.message }, 500);
    }
  }
  if (!sets.length) return json({ error: '没有可更新的字段' }, 400);
  try {
    const ph = ids.map(() => '?').join(',');
    const r = await env.DB.prepare(`UPDATE questions SET ${sets.join(', ')} WHERE id IN (${ph})`).bind(...vals, ...ids).run();
    const updated = (r && r.meta && r.meta.changes != null) ? r.meta.changes : ids.length;
    return json({ ok: true, updated });
  } catch (e) {
    return json({ error: '更新失败：' + e.message }, 500);
  }
}
