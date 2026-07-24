import { json, checkAuth } from './_utils.js';

const VALID_SUBJECTS = ['politics', 'english', 'math', 'computer'];

function rowToMaterial(r) {
  const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
  return {
    id: r.id,
    subject: r.subject,
    title: r.title,
    source: r.source || '',
    page: r.page || 0,
    page_image: r.page_image || '',
    content_md: r.content_md || '',
    summary: r.summary || '',
    tags: parse(r.tags, []),
    created_at: r.created_at,
  };
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
  const limit = Math.min(parseInt(p.get('limit') || '200', 10) || 200, 500);
  const where = [];
  const binds = [];
  if (subject && subject !== 'all') { where.push('subject = ?'); binds.push(subject); }
  const sql = `SELECT * FROM materials ${where.length ? 'WHERE '+where.join(' AND ') : ''} ORDER BY created_at DESC, source, page LIMIT ?`;
  binds.push(limit);
  try {
    const rs = await env.DB.prepare(sql).bind(...binds).all();
    return json({ items: rs.results.map(rowToMaterial) });
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
  const subject = VALID_SUBJECTS.includes(b.subject) ? b.subject : 'computer';
  const title = String(b.title || b.source || '教材页面').trim();
  const content = String(b.content_md || b.content || '').trim();
  if (!title || !content) return json({ error: '缺少 title 或 content_md' }, 400);
  const id = (b.id && String(b.id).trim()) || `mat-${subject}-${crypto.randomUUID().slice(0, 12)}`;
  const tags = JSON.stringify(Array.isArray(b.tags) ? b.tags : []);
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
