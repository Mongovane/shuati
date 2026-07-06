import { json, checkAuth } from './_utils.js';

const VALID_SUBJECTS = ['politics', 'english', 'math', 'computer'];

async function ensureTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS pdfs (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    subject TEXT,
    size INTEGER,
    created_at INTEGER DEFAULT (unixepoch())
  )`).run();
}

function noBucket() {
  return json({ error: '服务端未绑定 R2 存储桶（变量名 PDF_BUCKET）。请在 Pages → Settings → Bindings 添加 R2 bucket binding 后重试。' }, 500);
}

// GET ?list=1 → 列出已保存的 PDF；GET ?id=xxx → 下载该 PDF（流式返回）
export async function onRequestGet({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  if (!env.PDF_BUCKET) return noBucket();
  await ensureTable(env);
  const p = new URL(request.url).searchParams;
  const id = p.get('id');

  if (!id) {
    try {
      const rs = await env.DB.prepare(
        `SELECT id, title, subject, size, created_at FROM pdfs ORDER BY created_at DESC`
      ).all();
      return json({ items: rs.results });
    } catch (e) {
      return json({ error: '查询失败：' + e.message }, 500);
    }
  }

  const obj = await env.PDF_BUCKET.get('pdf/' + id);
  if (!obj) return json({ error: '未找到该 PDF' }, 404);
  return new Response(obj.body, {
    headers: {
      'content-type': 'application/pdf',
      'cache-control': 'private, max-age=3600',
    },
  });
}

// PUT（body 为 PDF 字节，?title=&subject= 带元信息）→ 存入 R2 + 元信息入 D1
export async function onRequestPut({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  if (!env.PDF_BUCKET) return noBucket();
  await ensureTable(env);

  const p = new URL(request.url).searchParams;
  const title = (p.get('title') || '').trim() || '未命名 PDF';
  const subject = VALID_SUBJECTS.includes(p.get('subject')) ? p.get('subject') : 'computer';

  let buf;
  try { buf = await request.arrayBuffer(); } catch { return json({ error: '读取上传内容失败' }, 400); }
  if (!buf || buf.byteLength < 100) return json({ error: '文件为空或过小' }, 400);

  const id = `pdf-${subject}-${crypto.randomUUID().slice(0, 12)}`;
  try {
    await env.PDF_BUCKET.put('pdf/' + id, buf, { httpMetadata: { contentType: 'application/pdf' } });
    await env.DB.prepare(`INSERT OR REPLACE INTO pdfs (id, title, subject, size) VALUES (?,?,?,?)`)
      .bind(id, title, subject, buf.byteLength).run();
    return json({ ok: true, id, title, subject, size: buf.byteLength });
  } catch (e) {
    return json({ error: '上传失败：' + e.message }, 500);
  }
}

// DELETE ?id=xxx → 删 R2 对象 + D1 记录
export async function onRequestDelete({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  if (!env.PDF_BUCKET) return noBucket();
  await ensureTable(env);
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json({ error: '缺少 id' }, 400);
  try {
    await env.PDF_BUCKET.delete('pdf/' + id);
    await env.DB.prepare(`DELETE FROM pdfs WHERE id = ?`).bind(id).run();
    return json({ ok: true });
  } catch (e) {
    return json({ error: '删除失败：' + e.message }, 500);
  }
}
