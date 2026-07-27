import { json, checkAuth, estimateDbBytes, STORAGE_LIMIT, STORAGE_BLOCK, STORAGE_WARN } from './_utils.js';

// GET /api/storage —— 返回估算的数据库用量与阈值，供前端显示与预警
export async function onRequestGet({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  const used = await estimateDbBytes(env);
  return json({
    used,
    limit: STORAGE_LIMIT,
    block: STORAGE_BLOCK,
    warn: STORAGE_WARN,
    pct: Math.min(100, Math.round((used / STORAGE_LIMIT) * 100)),
    warning: used >= STORAGE_WARN,
    blocked: used >= STORAGE_BLOCK,
  });
}
