import { json, checkAuth } from './_utils.js';

const DEFAULT_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

// 【修改点 1】：加强 Prompt，加上更严厉的格式禁令
const PROMPT = [
  '你是一个精确的 OCR 引擎，只转写图片中“真实存在”的文字，不做任何创作。',
  '规则：',
  '1) 用图片本来的语言（简体中文/英文）逐字转写，严禁翻译、严禁音译成拼音、严禁改写或润色。',
  '2) 保留阅读顺序、段落与换行。',
  '3) 核心规则：数学公式、符号、上下标等一律转成 LaTeX，行内公式必须用 $ 包裹，独立段落公式必须用 $$ 包裹。',
  '4) 严禁使用 \\[ \\] 或 \\( \\) 作为公式界定符！严禁！多行对齐推导公式请使用 $$ \\begin{aligned} ... \\end{aligned} $$。',
  '5) 只输出纯文本（Markdown），绝对不要用 ```markdown 或 ```latex 代码块包裹，也不要输出任何无关前言。',
  '6) 看不清或空白处就留空，绝不编造。',
].join('\n');

function todayUTC() { return new Date().toISOString().slice(0, 10); }
function limitOf(env) { const n = parseInt(env.AI_DAILY_PAGE_LIMIT || '70', 10); return Number.isFinite(n) ? n : 70; }
const NEURON_BUDGET = 10000;          // 免费层每日神经元
const EST_NEURONS_PER_PAGE = 115;     // 实测 llama-3.2-vision 约 111/页（2.4× 分辨率），取 115 留余量

async function ensureUsage(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_usage (day TEXT PRIMARY KEY, pages INTEGER DEFAULT 0)`).run();
}
async function usedToday(env) {
  const row = await env.DB.prepare(`SELECT pages FROM ai_usage WHERE day = ?`).bind(todayUTC()).first();
  return row ? (row.pages || 0) : 0;
}

// 【修改点 2：新增清洗函数】在 AI 返回后强制纠正格式错误
function cleanAIOutput(text) {
  if (!text) return '';
  
  // 1. 去除 AI 经常自作主张加的 markdown 代码块外壳 (如 ```markdown ... ```)
  text = text.replace(/^```(?:markdown|latex|html|text)?\s*\n/i, '');
  text = text.replace(/\n```\s*$/i, '');

  // 2. 强制转换 LaTeX 默认定界符为前端 Markdown 兼容的 $ 和 $$
  // Llama 经常不听话输出 \[ 和 \]，前端解析 Markdown 时会吞掉反斜杠变成 [ 和 ]
  // 注意：在 JS 的 replace 中，'$$$$' 代表插入真实的 "$$" 字符串
  text = text.replace(/\\\[/g, '$$$$'); 
  text = text.replace(/\\\]/g, '$$$$');
  
  // 将 \( 和 \) 替换为 $
  // 注意：在 JS 的 replace 中，'$$' 代表插入真实的 "$" 字符串
  text = text.replace(/\\\(/g, '$$'); 
  text = text.replace(/\\\)/g, '$$');

  return text.trim();
}

// GET → 返回今日用量与上限（前端展示与闸门提示）
export async function onRequestGet({ request, env }) {
  const auth = checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  await ensureUsage(env);
  const used = await usedToday(env);
  return json({ used, limit: limitOf(env), has_cf_ai: !!env.AI, budget: NEURON_BUDGET, npp: EST_NEURONS_PER_PAGE });
}

// POST { image_b64 } → 用 Workers AI 视觉模型 OCR 一页；先查配额，到上限直接拒绝（不调用 AI）
export async function onRequestPost({ request, env }) {
  const auth = checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  if (!env.AI) return json({ error: '服务端未绑定 Workers AI（变量名 AI）。请在 Pages → Settings → Bindings 添加 Workers AI binding 后重新部署。' }, 500);
  await ensureUsage(env);

  const limit = limitOf(env);
  if (limit <= 0) return json({ error: 'Workers AI OCR 已停用（每日上限为 0）。', used: 0, limit }, 429);

  // —— 配额硬闸门：到上限直接拒绝，绝不发起 AI 调用 ——
  const used = await usedToday(env);
  if (used >= limit) {
    return json({ error: `今日免费额度已用完（${used}/${limit} 页）。每天 UTC 00:00 重置，或改用其他 OCR 引擎。`, used, limit }, 429);
  }

  let body;
  try { body = await request.json(); } catch { return json({ error: '请求体解析失败' }, 400); }
  const b64 = (body && body.image_b64) || '';
  if (!b64) return json({ error: '缺少图片数据' }, 400);

  let bytes;
  try {
    const bin = atob(b64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch { return json({ error: '图片解码失败' }, 400); }

  const reqModel = (body && typeof body.model === 'string' && body.model.trim().startsWith('@cf/')) ? body.model.trim() : '';
  const model = reqModel || env.CF_OCR_MODEL || DEFAULT_MODEL;
  let text = '';
  try {
    let out;
    const input = { image: [...bytes], prompt: PROMPT, max_tokens: 2048, temperature: 0.1 };
    try {
      out = await env.AI.run(model, input);
    } catch (e1) {
      // Llama 3.2 等模型首次使用需先提交 'agree' 接受许可（错误码 5016）。自动接受后重试一次。
      if (/\b5016\b|submit the prompt 'agree'|must submit/i.test(e1.message || '')) {
        try { await env.AI.run(model, { prompt: 'agree' }); } catch (_) {}
        out = await env.AI.run(model, input);
      } else {
        throw e1;
      }
    }
    text = String((out && (out.response || out.text || out.description)) || '').trim();
    
    // 【修改点 3】：在这里调用清洗函数，拦截并修复 AI 输出格式
    text = cleanAIOutput(text);

  } catch (e) {
    return json({ error: 'Workers AI 调用失败：' + e.message, used, limit }, 502);
  }

  // 仅在成功后才计数（失败不扣额度）
  try {
    await env.DB.prepare(`INSERT INTO ai_usage (day, pages) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET pages = pages + 1`).bind(todayUTC()).run();
  } catch (_) {}

  return json({ text, used: used + 1, limit, budget: NEURON_BUDGET, npp: EST_NEURONS_PER_PAGE });
}
