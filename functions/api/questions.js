import { json, checkAuth, rowToQuestion, ensureSrsSchema } from './_utils.js';

export async function onRequestGet({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;

  await ensureSrsSchema(env); // 旧库自动补 SRS 列，保证下方 pr.due_at 可用

  const p = new URL(request.url).searchParams;

  // —— meta：给前端筛选器用的科目 / 章节清单 ——
  if (p.get('meta')) {
    const subjStmt = env.DB.prepare(
      `SELECT subject, COUNT(*) AS n FROM questions GROUP BY subject`
    );
    const chapStmt = env.DB.prepare(
      `SELECT subject, chapter, COUNT(*) AS n FROM questions
       WHERE chapter IS NOT NULL AND chapter <> '' GROUP BY subject, chapter ORDER BY subject, chapter`
    );
    const [subs, chaps] = await Promise.all([subjStmt.all(), chapStmt.all()]);
    return json({ subjects: subs.results, chapters: chaps.results });
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

  const where = [];
  const binds = [];
  if (idsParam.length) { where.push(`q.id IN (${idsParam.map(() => '?').join(',')})`); binds.push(...idsParam); }
  if (subject && subject !== 'all') { where.push('q.subject = ?'); binds.push(subject); }
  if (chapter) { where.push('q.chapter = ?'); binds.push(chapter); }
  if (type) { where.push('q.type = ?'); binds.push(type); }
  if (search) { where.push('(q.stem LIKE ? OR q.chapter LIKE ?)'); binds.push(`%${search}%`, `%${search}%`); }

  if (mode === 'wrong') where.push('pr.wrong_count > 0 AND IFNULL(pr.mastered, 0) = 0');
  else if (mode === 'favorite') where.push('IFNULL(pr.favorited, 0) = 1');
  else if (mode === 'mastered') where.push('IFNULL(pr.mastered, 0) = 1');
  else if (mode === 'unseen') where.push('pr.question_id IS NULL');
  else if (mode === 'due') where.push('IFNULL(pr.mastered, 0) = 0 AND pr.due_at IS NOT NULL AND pr.due_at <= unixepoch()');

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const baseSelect = `SELECT q.*, pr.wrong_count, pr.right_count, pr.favorited, pr.mastered, pr.due_at, pr.note AS user_note
                      FROM questions q
                      LEFT JOIN progress pr ON pr.question_id = q.id`;
  const countSql = `SELECT COUNT(*) AS total FROM questions q
                    LEFT JOIN progress pr ON pr.question_id = q.id ${whereSql}`;

  try {
    let rows, total;
    if (order === 'random' && !where.length) {
      // 全表无筛选时的高效随机：随机取一个 rowid 阈值，从该点起按 rowid 顺序取 limit 条，不足则从头补齐，再打乱。
      // 避免 ORDER BY RANDOM() 对整张表排序造成的全表扫描与高额 D1 读配额（上万题时尤其明显）。
      const mx = await env.DB.prepare('SELECT MAX(rowid) AS m FROM questions').first();
      const maxId = (mx && mx.m) || 0;
      const threshold = maxId > 0 ? Math.floor(Math.random() * maxId) : 0;
      const r1 = await env.DB.prepare(`${baseSelect} WHERE q.rowid >= ? ORDER BY q.rowid ASC LIMIT ?`).bind(threshold, limit).all();
      rows = r1.results || [];
      if (rows.length < limit) { // 阈值靠后，从头补齐
        const r2 = await env.DB.prepare(`${baseSelect} ORDER BY q.rowid ASC LIMIT ?`).bind(limit).all();
        const got = new Set(rows.map(r => r.id));
        for (const r of (r2.results || [])) { if (!got.has(r.id)) { rows.push(r); got.add(r.id); if (rows.length >= limit) break; } }
      }
      for (let i = rows.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = rows[i]; rows[i] = rows[j]; rows[j] = t; }
      const c = await env.DB.prepare(countSql).bind(...binds).first();
      total = c?.total ?? rows.length;
    } else if (order === 'random') {
      // 有筛选条件时命中集较小：直接在子集上 ORDER BY RANDOM()，保证均匀（rowid 阈值法在稀疏子集上会偏向连续区段）
      const [list, cnt] = await Promise.all([
        env.DB.prepare(`${baseSelect} ${whereSql} ORDER BY RANDOM() LIMIT ?`).bind(...binds, limit).all(),
        env.DB.prepare(countSql).bind(...binds).first(),
      ]);
      rows = list.results || []; total = cnt?.total ?? rows.length;
    } else {
      const orderBy = order === 'seq' ? 'q.created_at ASC, q.id ASC'
        : order === 'due' ? 'pr.due_at ASC'                                            // due：最早到期优先
        : 'IFNULL(pr.wrong_count,0) DESC, IFNULL(pr.right_count,0) ASC, RANDOM()'; // weak：最不熟优先
      const sql = `${baseSelect} ${whereSql} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
      const [list, cnt] = await Promise.all([
        env.DB.prepare(sql).bind(...binds, limit, offset).all(),
        env.DB.prepare(countSql).bind(...binds).first(),
      ]);
      rows = list.results; total = cnt?.total ?? rows.length;
    }
    return json({ items: rows.map(rowToQuestion), total });
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
  const ids = Array.isArray(body && body.ids) ? body.ids.filter(Boolean) : (body && body.id ? [body.id] : []);
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
  const ids = Array.isArray(body && body.ids) ? body.ids.filter(Boolean) : (body && body.id ? [body.id] : []);
  if (!ids.length) return json({ error: '缺少题目 id' }, 400);
  const ALLOWED = ['subject', 'chapter', 'type', 'difficulty', 'stem', 'passage', 'analysis', 'options', 'answer', 'tags'];
  const JSON_FIELDS = new Set(['options', 'answer', 'tags']);
  const sets = [], vals = [];
  for (const k of ALLOWED) {
    if (body[k] !== undefined && body[k] !== null) {
      sets.push(`${k} = ?`);
      if (k === 'difficulty') vals.push(Number(body[k]) || 3);
      else if (JSON_FIELDS.has(k)) vals.push(JSON.stringify(Array.isArray(body[k]) ? body[k] : (body[k] === '' ? [] : [body[k]])));
      else vals.push(String(body[k]));
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
