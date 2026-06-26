import { json, checkAuth } from './_utils.js';

const PROMPT = [
  '你是精准的 OCR 转写引擎。把这张教材/习题页图片【逐字转写】成 Markdown。',
  '硬性要求：',
  '1) 用图片原本的语言（简体中文/英文）转写，严禁翻译、严禁解题、严禁自行作答、严禁编造或补全任何内容。',
  '2) 不要输出任何图片路径、文件名、“Step 1 / Problem Description / Introduction”之类自创结构，也不要复述本提示词。',
  '3) 标题用 Markdown 标题（#、##、###）；题号、选项（A. B. C. D.）、段落、列表保持原样。',
  '4) 所有数学公式、符号、上下标、积分、求和、根号、分式一律转成 LaTeX：行内用 $...$，独立公式用 $$...$$。',
  '5) 只输出这页图片里“真实出现”的内容（纯 Markdown）：不要前言、不要解释、不要用代码块包裹整页。看不清或空白就留空，绝不编造。',
].join('\n');

export async function onRequestPost({ request, env }) {
  const auth = checkAuth(request, env);
  if (!auth.ok) return auth.resp;

  let body;
  try { body = await request.json(); } catch { return json({ error: '请求体解析失败' }, 400); }
  const b64 = (body && body.image_b64) || '';
  if (!b64) return json({ error: '缺少图片数据' }, 400);
  const dataUrl = b64.startsWith('data:') ? b64 : ('data:image/png;base64,' + b64);

  // 允许前端临时覆盖中转站配置（便于指定真正支持图片的视觉模型）
  const ovBase = (body && typeof body.base_url === 'string' && /^https?:\/\//i.test(body.base_url.trim())) ? body.base_url.trim() : '';
  const ovKey = (body && typeof body.api_key === 'string' && body.api_key.trim()) ? body.api_key.trim() : '';
  const ovModel = (body && typeof body.model === 'string' && body.model.trim()) ? body.model.trim() : '';

  const baseRaw = ovBase || env.AI_BASE_URL;
  const apiKey = ovKey || env.AI_API_KEY;
  if (!baseRaw || !apiKey) {
    return json({ error: '未配置中转站：请在下方「OCR 模型设置」填写 Base URL 与 API Key，或在服务端配置 AI_BASE_URL / AI_API_KEY。' }, 500);
  }
  const base = baseRaw.replace(/\/+$/, '');
  const model = ovModel || env.AI_VISION_MODEL || env.AI_MODEL || 'gpt-4o';

  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: PROMPT },
      { type: 'image_url', image_url: { url: dataUrl } },
    ],
  }];

  let resp;
  try {
    resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0.1, max_tokens: 4000, messages }),
    });
  } catch (e) {
    return json({ error: '调用中转站失败：' + e.message }, 502);
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    return json({ error: `中转站返回 ${resp.status}（请确认该模型支持图片输入）`, detail: t.slice(0, 300) }, 502);
  }
  const data = await resp.json().catch(() => null);
  let text = String(data?.choices?.[0]?.message?.content || '').trim();
  text = text.replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/, '').trim();
  return json({ text, model });
}
