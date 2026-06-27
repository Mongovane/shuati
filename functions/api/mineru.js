import { json, checkAuth } from './_utils.js';

const BASE = 'https://mineru.net/api/v4';

// 仅从环境变量读取，绝不硬编码（密钥不进仓库）。在 Pages → Settings → 环境变量 添加 MINERU_API_KEY。
function tokenOf(env) { return env.MINERU_API_KEY || env.MINERU_TOKEN || ''; }
function authHeaders(env) {
  return { Authorization: `Bearer ${tokenOf(env)}`, 'Content-Type': 'application/json' };
}

// 从 MinerU 各种可能的返回结构里挑出字段，做容错
function pick(obj, keys) { for (const k of keys) { if (obj && obj[k] != null) return obj[k]; } return undefined; }

export async function onRequest(context) {
  const { request, env } = context;
  const auth = checkAuth(request, env);
  if (!auth.ok) return auth.resp;

  const url = new URL(request.url);
  const action = url.searchParams.get('action');
  const isAgent = (action || '').startsWith('agent');
  const noToken = isAgent || action === 'upload';

  // 精准解析 API 需要 Token；Agent 轻量 API 与 上传代理 免 Token
  if (!noToken && !tokenOf(env)) {
    return json({ error: '服务端未配置 MinerU 密钥。精准模式需在 Cloudflare Pages → 环境变量 添加 MINERU_API_KEY（控制台「API 管理 → 创建 Token」生成），然后重新部署。或改用「免 Token 轻量」模式。' }, 500);
  }

  try {
    // 上传代理：浏览器把文件 PUT 到本接口，由服务器转 PUT 到 MinerU 预签名地址（绕过 OSS 跨域 403）
    if (action === 'upload' && (request.method === 'PUT' || request.method === 'POST')) {
      const up = url.searchParams.get('upload_url');
      if (!up) return json({ error: '缺少 upload_url' }, 400);
      let uphost = '';
      try { uphost = new URL(up).host; } catch { return json({ error: 'upload_url 非法' }, 400); }
      if (!/(?:^|\.)(?:mineru\.net|openxlab\.org\.cn|aliyuncs\.com)$/i.test(uphost)) return json({ error: '不允许的上传域名：' + uphost }, 400);
      const bytes = await request.arrayBuffer();
      if (!bytes || bytes.byteLength === 0) return json({ error: '上传内容为空' }, 400);
      // 不设置 Content-Type（MinerU 预签名要求不带该头），ArrayBuffer body 不会自动添加
      const put = await fetch(up, { method: 'PUT', body: bytes });
      if (!put.ok) { const t = await put.text().catch(() => ''); return json({ error: '转发上传到 MinerU 失败 HTTP ' + put.status, detail: t.slice(0, 300) }, 502); }
      return json({ ok: true });
    }

    // 1) 申请上传地址（批量），返回 batch_id 与预签名上传 URL
    if (request.method === 'POST' && action === 'get_upload_url') {
      const body = await request.json().catch(() => ({}));
      const fileEntry = { name: body.filename || 'book.pdf', is_ocr: body.is_ocr !== false, data_id: 'shuati-1' };
      if (body.page_ranges) fileEntry.page_ranges = String(body.page_ranges);
      const payload = {
        enable_formula: body.enable_formula !== false,
        enable_table: body.enable_table !== false,
        language: body.language || 'ch',
        model_version: body.model_version || 'vlm',
        files: [fileEntry],
      };
      const res = await fetch(`${BASE}/file-urls/batch`, { method: 'POST', headers: authHeaders(env), body: JSON.stringify(payload) });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d) return json({ error: 'MinerU 申请上传地址失败', status: res.status, raw: d }, 502);
      if (d.code != null && d.code !== 0) return json({ error: 'MinerU 申请上传地址失败：' + (d.msg || d.code), raw: d }, 502);
      const data = d.data || d;
      const batch_id = pick(data, ['batch_id', 'batchId', 'id']);
      const fileUrls = pick(data, ['file_urls', 'fileUrls', 'urls']) || [];
      const upload_url = Array.isArray(fileUrls) ? fileUrls[0] : fileUrls;
      if (!batch_id || !upload_url) return json({ error: 'MinerU 返回缺少 batch_id 或上传地址', raw: d }, 502);
      return json({ batch_id, upload_url });
    }

    // 2) 查询批量解析进度/结果
    if (request.method === 'GET' && action === 'status') {
      const batchId = url.searchParams.get('batch_id');
      if (!batchId) return json({ error: '缺少 batch_id' }, 400);
      const res = await fetch(`${BASE}/extract-results/batch/${batchId}`, { method: 'GET', headers: authHeaders(env) });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d) return json({ error: 'MinerU 查询失败', status: res.status, raw: d }, 502);
      if (d.code != null && d.code !== 0) return json({ error: 'MinerU 查询失败：' + (d.msg || d.code), raw: d }, 502);
      const data = d.data || d;
      const list = pick(data, ['extract_result', 'extractResult', 'results', 'files']) || [];
      const item = Array.isArray(list) ? (list[0] || {}) : list;
      const state = String(pick(item, ['state', 'status']) || 'unknown').toLowerCase();
      const zip_url = pick(item, ['full_zip_url', 'fullZipUrl', 'zip_url', 'zipUrl']);
      const err = pick(item, ['err_msg', 'errMsg', 'error', 'msg']) || '';
      const progress = pick(item, ['extract_progress', 'progress']);
      return json({ state, zip_url, err, progress, raw: item });
    }

    // 3) 代理下载结果 ZIP（避免浏览器跨域），返回原始字节
    if (request.method === 'GET' && action === 'download') {
      const zipUrl = url.searchParams.get('zip_url');
      if (!zipUrl) return json({ error: '缺少 zip_url' }, 400);
      // 只允许下载 MinerU / 阿里云 OSS 域名，避免被当作任意代理
      let host = '';
      try { host = new URL(zipUrl).host; } catch { return json({ error: 'zip_url 非法' }, 400); }
      if (!/(?:^|\.)(?:mineru\.net|openxlab\.org\.cn|aliyuncs\.com)$/i.test(host)) {
        return json({ error: '不允许的下载域名：' + host }, 400);
      }
      const res = await fetch(zipUrl);
      if (!res.ok) return json({ error: '下载结果 ZIP 失败 ' + res.status }, 502);
      return new Response(res.body, { headers: { 'content-type': 'application/zip', 'cache-control': 'no-store' } });
    }

    // —— Agent 轻量解析 API（免 Token，IP 限频）——
    if (request.method === 'POST' && action === 'agent_submit') {
      const body = await request.json().catch(() => ({}));
      const payload = {
        file_name: body.filename || 'book.pdf',
        language: body.language || 'ch',
        is_ocr: body.is_ocr !== false,
        enable_formula: body.enable_formula !== false,
        enable_table: body.enable_table !== false,
      };
      if (body.page_range) payload.page_range = String(body.page_range);
      const res = await fetch('https://mineru.net/api/v1/agent/parse/file', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const d = await res.json().catch(() => null);
      if (res.status === 429) return json({ error: 'Agent 接口限频（429），请过一会再试' }, 429);
      if (!res.ok || !d) return json({ error: 'Agent 提交失败', status: res.status, raw: d }, 502);
      if (d.code != null && d.code !== 0) return json({ error: 'Agent 提交失败：' + (d.msg || d.code), raw: d }, 502);
      const data = d.data || d;
      const task_id = pick(data, ['task_id']);
      const file_url = pick(data, ['file_url']);
      if (!task_id || !file_url) return json({ error: 'Agent 返回缺少 task_id 或上传地址', raw: d }, 502);
      return json({ task_id, file_url });
    }

    if (request.method === 'GET' && action === 'agent_status') {
      const taskId = url.searchParams.get('task_id');
      if (!taskId) return json({ error: '缺少 task_id' }, 400);
      const res = await fetch(`https://mineru.net/api/v1/agent/parse/${taskId}`, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d) return json({ error: 'Agent 查询失败', status: res.status, raw: d }, 502);
      if (d.code != null && d.code !== 0) return json({ error: 'Agent 查询失败：' + (d.msg || d.code), raw: d }, 502);
      const data = d.data || d;
      return json({ state: String(pick(data, ['state']) || 'unknown').toLowerCase(), markdown_url: pick(data, ['markdown_url']), err: pick(data, ['err_msg']) || '' });
    }

    if (request.method === 'GET' && action === 'agent_md') {
      const mdUrl = url.searchParams.get('md_url');
      if (!mdUrl) return json({ error: '缺少 md_url' }, 400);
      let host = '';
      try { host = new URL(mdUrl).host; } catch { return json({ error: 'md_url 非法' }, 400); }
      if (!/(?:^|\.)(?:mineru\.net|openxlab\.org\.cn|aliyuncs\.com)$/i.test(host)) return json({ error: '不允许的域名：' + host }, 400);
      const res = await fetch(mdUrl);
      if (!res.ok) return json({ error: '下载 Markdown 失败 ' + res.status }, 502);
      return json({ text: await res.text() });
    }

    return json({ error: '无效的 action 参数（get_upload_url / status / download / agent_submit / agent_status / agent_md）' }, 400);
  } catch (err) {
    return json({ error: 'MinerU 接口异常：' + err.message }, 500);
  }
}
