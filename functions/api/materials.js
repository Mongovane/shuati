import { json, checkAuth, checkStorage } from './_utils.js';

const VALID_SUBJECTS = ['politics', 'english', 'math', 'computer'];

// meta=true 时不返回 content_md / page_image（书架分组只需元信息，正文按 ids= 按需取）。
// 注意：是「不带这两个键」而不是「给空串」——前端靠 content_md === undefined 判断"还没载入"。
function rowToMaterial(r, meta = false) {
  const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
  const o = {
    id: r.id,
    subject: r.subject,
    title: r.title,
    source: r.source || '',
    page: r.page || 0,
    summary: r.summary || '',
    tags: parse(r.tags, []),
    created_at: r.created_at,
  };
  if (!meta) {
    o.page_image = r.page_image || '';
    o.content_md = r.content_md || '';
  }
  return o;
}

async function ensureMaterialsTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY,
    subject TEXT NOT NULL,
    title TEXT NOT NULL,
    source TEXT,
    page INTEGER,
    page_image TEXT,
    content_md TEXT,
    summary TEXT,
    tags TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  )`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_m_subject ON materials(subject)`).run();
  await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_m_source ON materials(source)`).run();
}

export async function onRequestGet({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  await ensureMaterialsTable(env);
  const p = new URL(request.url).searchParams;
  const subject = p.get('subject');
  const meta = p.get('meta') === '1';
  const ids = (p.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 200);
  // 元信息一行几十字节，几千行也就几百 KB，可以整架一次拉完；带正文的仍限 500 行（正文可能内嵌 base64 图，很重）
  const MAXL = meta ? 5000 : 500;
  const DEFL = meta ? 2000 : 200;
  const limit = Math.min(Math.max(parseInt(p.get('limit') || String(DEFL), 10) || DEFL, 1), MAXL);
  const offset = Math.max(0, parseInt(p.get('offset') || '0', 10) || 0);
  const where = [];
  const binds = [];
  if (subject && subject !== 'all') { where.push('subject = ?'); binds.push(subject); }
  if (ids.length) { where.push(`id IN (${ids.map(() => '?').join(',')})`); binds.push(...ids); }
  const W = where.length ? 'WHERE ' + where.join(' AND ') : '';
  // 排序末尾必须补 id：整本导入时同一批行的 created_at 往往同秒，没有唯一 tiebreaker 时
  // LIMIT/OFFSET 翻页的行序不稳定，会漏行 + 重复行。
  const sql = `SELECT ${meta ? 'id, subject, title, source, page, summary, tags, created_at' : '*'} FROM materials
    ${W} ORDER BY created_at DESC, source, page, id LIMIT ? OFFSET ?`;
  try {
    const rs = await env.DB.prepare(sql).bind(...binds, limit, offset).all();
    const out = { items: rs.results.map((r) => rowToMaterial(r, meta)), limit, offset };
    if (p.get('count') === '1') {
      const c = await env.DB.prepare(`SELECT COUNT(*) AS n FROM materials ${W}`).bind(...binds).first();
      if (c && c.n != null) out.total = c.n;
    }
    return json(out);
  } catch (e) {
    return json({ error: '查询教材失败：' + e.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  await ensureMaterialsTable(env);
  let b;
  try { b = await request.json(); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }
  // 批量模式：body.items 为数组时，一次插入多条（MinerU/PDF 整本导入用，避免逐页串行）
  if (Array.isArray(b.items) && b.items.length) {
    // 写入前存储保护：估算本批体积，接近 5GB 上限则拒绝，避免超 Cloudflare 免费额度
    const addBytes = b.items.reduce((s, it) => s + ((it.content_md || '').length + (it.page_image || '').length), 0);
    const sc = await checkStorage(env, addBytes);
    if (sc.blocked) return json({ error: 'storage_full', message: '存储空间接近免费上限（5GB），已阻止本次导入以免超额产生费用。请先删除一些不需要的题目或带图的大教材。', used: sc.used, limit: sc.limit }, 507);
    try {
      const stmt = env.DB.prepare(`INSERT OR REPLACE INTO materials
        (id, subject, title, source, page, page_image, content_md, summary, tags)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      const rows = [];
      for (const it of b.items) {
        const subject = VALID_SUBJECTS.includes(it.subject) ? it.subject : 'computer';
        const title = String(it.title || it.source || '教材页面').trim();
        const content = String(it.content_md || it.content || '').trim();
        if (!title || !content) continue;
        const id = (it.id && String(it.id).trim()) || `mat-${subject}-${crypto.randomUUID().slice(0, 12)}`;
        const tags = JSON.stringify(Array.isArray(it.tags) ? it.tags : []);
        rows.push(stmt.bind(id, subject, title, String(it.source || '').trim() || null,
          parseInt(it.page || 0, 10) || null, String(it.page_image || '').trim() || null,
          content, String(it.summary || '').trim() || null, tags));
      }
      if (!rows.length) return json({ error: '批量项全部无效（缺 title/content）' }, 400);
      // 分批 batch，避免单次事务过大
      let inserted = 0;
      for (let i = 0; i < rows.length; i += 25) {
        await env.DB.batch(rows.slice(i, i + 25));
        inserted += Math.min(25, rows.length - i);
      }
      return json({ ok: true, inserted });
    } catch (e) {
      return json({ error: '批量写入教材失败：' + e.message }, 500);
    }
  }
  const subject = VALID_SUBJECTS.includes(b.subject) ? b.subject : 'computer';
  const title = String(b.title || b.source || '教材页面').trim();
  const content = String(b.content_md || b.content || '').trim();
  if (!title || !content) return json({ error: '缺少 title 或 content_md' }, 400);
  const id = (b.id && String(b.id).trim()) || `mat-${subject}-${crypto.randomUUID().slice(0, 12)}`;
  const tags = JSON.stringify(Array.isArray(b.tags) ? b.tags : []);
  // 写入前存储保护（单条）
  { const sc = await checkStorage(env, content.length + String(b.page_image || '').length); if (sc.blocked) return json({ error: 'storage_full', message: '存储空间接近免费上限（5GB），已阻止写入。请先清理部分内容。', used: sc.used, limit: sc.limit }, 507); }
  try {
    await env.DB.prepare(`INSERT OR REPLACE INTO materials
      (id, subject, title, source, page, page_image, content_md, summary, tags)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(
        id, subject, title, String(b.source || '').trim() || null,
        parseInt(b.page || 0, 10) || null, String(b.page_image || '').trim() || null,
        content, String(b.summary || '').trim() || null, tags
      ).run();
    return json({ ok: true, inserted: 1, item: { id, subject, title, source: b.source || '', page: b.page || 0 } });
  } catch (e) {
    return json({ error: '写入教材失败：' + e.message }, 500);
  }
}

// DELETE：按 id 批量删除教材页。body: { ids: ["mat-...","..."] }
// 批量把一组教材页改到某科目（书籍归类用，一次请求代替逐页串行）
export async function onRequestPatch({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  await ensureMaterialsTable(env);
  let b;
  try { b = await request.json(); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }
  const ids = Array.isArray(b.ids) ? b.ids.map((x) => String(x)).filter(Boolean) : [];
  const subject = String(b.subject || '').trim();
  if (!ids.length) return json({ error: '缺少要修改的 ids 数组' }, 400);
  if (!subject) return json({ error: '缺少目标 subject' }, 400);
  try {
    let updated = 0;
    for (let i = 0; i < ids.length; i += 50) {
      const part = ids.slice(i, i + 50);
      const placeholders = part.map(() => '?').join(',');
      const rs = await env.DB.prepare(`UPDATE materials SET subject = ? WHERE id IN (${placeholders})`).bind(subject, ...part).run();
      updated += (rs.meta && rs.meta.changes) || 0;
    }
    return json({ ok: true, updated });
  } catch (e) {
    return json({ error: '修改科目失败：' + e.message }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  await ensureMaterialsTable(env);
  let b;
  try { b = await request.json(); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }
  const ids = Array.isArray(b.ids) ? b.ids.map((x) => String(x)).filter(Boolean) : [];
  if (!ids.length) return json({ error: '缺少要删除的 ids 数组' }, 400);
  try {
    // 分批，避免单条语句绑定参数过多
    let deleted = 0;
    for (let i = 0; i < ids.length; i += 50) {
      const part = ids.slice(i, i + 50);
      const placeholders = part.map(() => '?').join(',');
      const rs = await env.DB.prepare(`DELETE FROM materials WHERE id IN (${placeholders})`).bind(...part).run();
      deleted += (rs.meta && rs.meta.changes) || 0;
    }
    return json({ ok: true, deleted });
  } catch (e) {
    return json({ error: '删除教材失败：' + e.message }, 500);
  }
}
