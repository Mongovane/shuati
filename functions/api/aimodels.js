import { json, checkAuth } from './_utils.js';

// POST /api/aimodels —— 拉取中转站可用模型列表（OpenAI 兼容 GET /v1/models）
// 为什么走后端代理而非浏览器直连：
//   ① 中转站通常不给浏览器放 CORS，前端 fetch 会被拦；
//   ② 与 explain / visionocr 一致，API Key 只经本站后端转发，不在浏览器发起跨域请求里暴露。
// 安全守卫同 explain：自带 base_url 必须自带 api_key，绝不把服务端密钥发往非配置地址。
export async function onRequestPost({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;

  let b;
  try { b = await request.json(); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }

  const ovBase = String(b.base_url || '').trim().replace(/\/+$/, '');
  const ovKey = String(b.api_key || '').trim();
  if (ovBase && !ovKey) {
    return json({ error: '使用自定义 Base URL 时必须同时填写该站的 API Key（不会使用服务端密钥）' }, 400);
  }
  if (ovBase && !/^https:\/\//i.test(ovBase)) {
    return json({ error: '自定义 Base URL 必须以 https:// 开头' }, 400);
  }
  const effBase = ovBase || (env.AI_BASE_URL ? String(env.AI_BASE_URL).replace(/\/+$/, '') : '');
  const effKey = ovBase ? ovKey : (ovKey || env.AI_API_KEY || '');
  if (!effBase || !effKey) {
    return json({ error: '未配置 AI 中转站：请先填写 Base URL 与 API Key（或在服务端设置 AI_BASE_URL/AI_API_KEY）' }, 400);
  }

  // effBase 通常已含 /v1；末尾接 /models。兼容用户少填 /v1 的情况。
  const url = /\/v\d+$/.test(effBase) ? effBase + '/models' : effBase + '/v1/models';
  let up;
  try {
    up = await fetch(url, {
      headers: { authorization: 'Bearer ' + effKey, accept: 'application/json' },
      signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
    });
  } catch (e) {
    return json({ error: '连接中转站失败：' + (e && e.message || e) + '（检查 Base URL 是否可达）' }, 502);
  }
  if (!up.ok) {
    let detail = '';
    try { detail = (await up.text()).slice(0, 300); } catch (_) {}
    const hint = up.status === 401 ? '（API Key 不对或无权限）' : up.status === 404 ? '（该中转站可能不支持 /v1/models 接口）' : '';
    return json({ error: `中转站返回 ${up.status} ${hint}`, detail }, 502);
  }

  let data;
  try { data = await up.json(); } catch { return json({ error: '中转站返回的不是合法 JSON（可能不是 OpenAI 兼容接口）' }, 502); }

  // 归一化：OpenAI 是 { data:[{id}] }；部分站直接返回数组或 { models:[...] }
  const raw = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : (Array.isArray(data.models) ? data.models : []));
  const ids = [...new Set(raw
    .map((m) => (typeof m === 'string' ? m : (m && (m.id || m.name || m.model))))
    .filter((x) => typeof x === 'string' && x.trim())
    .map((x) => x.trim()))]
    .sort((a, b2) => a.localeCompare(b2));

  if (!ids.length) return json({ error: '中转站没有返回任何模型（接口正常但列表为空）' }, 502);
  return json({ ok: true, models: ids });
}
