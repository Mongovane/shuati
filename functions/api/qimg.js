import { json, checkAuth } from './_utils.js';

// 题目插图（几何图 / 数据结构示意图等），复用 pdfs 用的 R2 桶（binding: PDF_BUCKET）。
// POST /api/qimg   multipart 表单字段 file → { ok, url:'/api/qimg?k=qimg/<32位随机>.<ext>' }
//                  需要访问口令；png/jpg/webp/gif；单张 ≤ 2MB
// GET  /api/qimg?k=qimg/xxxx.png → 图片流
//   ★ 安全说明：<img> 标签无法携带 Authorization 头，故 GET 不做口令校验，
//     依靠 128 位随机键不可枚举 + 无列表接口来保护；图片属低敏内容，README 已注明。
//     未绑定 R2 的部署会在上传时收到清晰提示（小图可走前端「内嵌 base64」方案，无需本接口）。
export async function onRequestPost({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  if (!env.PDF_BUCKET) {
    return json({ error: '未绑定 R2（PDF_BUCKET），无法上传插图。小图可勾选「内嵌」直接存进题干；或按 README 绑定 R2 后再试' }, 400);
  }
  let fd;
  try { fd = await request.formData(); } catch { return json({ error: '请用 multipart 表单上传（字段名 file）' }, 400); }
  const f = fd.get('file');
  if (!f || typeof f === 'string') return json({ error: '缺少文件字段 file' }, 400);
  const type = f.type || '';
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(type)) return json({ error: '仅支持 png / jpg / webp / gif' }, 400);
  if (f.size > 2 * 1024 * 1024) return json({ error: '图片不能超过 2MB（截图前可先压缩）' }, 400);
  const ext = type.split('/')[1].replace('jpeg', 'jpg');
  const key = 'qimg/' + crypto.randomUUID().replace(/-/g, '') + '.' + ext;
  try {
    await env.PDF_BUCKET.put(key, f.stream(), { httpMetadata: { contentType: type } });
  } catch (e) {
    return json({ error: '写入 R2 失败：' + e.message }, 500);
  }
  return json({ ok: true, url: '/api/qimg?k=' + encodeURIComponent(key) });
}

export async function onRequestGet({ request, env }) {
  const k = new URL(request.url).searchParams.get('k') || '';
  if (!/^qimg\/[0-9a-f]{32}\.(png|jpg|webp|gif)$/.test(k)) return json({ error: 'bad key' }, 400);
  if (!env.PDF_BUCKET) return json({ error: 'R2 未绑定' }, 404);
  const obj = await env.PDF_BUCKET.get(k);
  if (!obj) return new Response('not found', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'content-type': (obj.httpMetadata && obj.httpMetadata.contentType) || 'image/png',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}
