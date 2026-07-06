import { json, checkAuth } from './_utils.js';

const DEFAULT_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

// 【修改点 1】：重写 Prompt，适配全学科，并用严厉的语气禁止重复和遗漏
const PROMPT = [
  '你是一个极其严谨的通用学术 OCR 引擎，适用于任意学科（数学、物理、文史、英语等）的教材与试卷。',
  '规则：',
  '1) 忠实原图：逐字逐句转写图片中真实可见的所有内容。绝对不允许自行省略、遗漏任何段落，也【绝对不允许重复输出】同一句话！',
  '2) 学科自适应：',
  '   - 如果图片中有数学/物理公式、化学方程式、上下标，一律严格使用 LaTeX 语法（行内公式用 $...$，独立公式用 $$...$$）。',
  '   - 如果是纯文科/英语内容，请直接输出排版整洁的纯文本。',
  '3) 格式保留：保持原有的大纲层级、题号、段落与换行。',
  '4) 严禁使用 \\[ \\] 或 \\( \\) 作为公式界定符。严禁输出 ```markdown 等代码块。',
  '5) 只输出图片里出现的内容本身，不要添加任何废话、解释或前言。绝不凭空编造（幻觉）。'
].join('\n');

function todayUTC() { return new Date().toISOString().slice(0, 10); }
function limitOf(env) { const n = parseInt(env.AI_DAILY_PAGE_LIMIT || '70', 10); return Number.isFinite(n) ? n : 70; }
const NEURON_BUDGET = 10000;          
const EST_NEURONS_PER_PAGE = 115;     

async function ensureUsage(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_usage (day TEXT PRIMARY KEY, pages INTEGER DEFAULT 0)`).run();
}
async function usedToday(env) {
  const row = await env.DB.prepare(`SELECT pages FROM ai_usage WHERE day = ?`).bind(todayUTC()).first();
  return row ? (row.pages || 0) : 0;
}

// 清洗函数保持不变，用于拦截 AI 的格式错误
function cleanAIOutput(text) {
  if (!text) return '';
  text = text.replace(/^```(?:markdown|latex|html|text)?\s*\n/i, '');
  text = text.replace(/\n```\s*$/i, '');
  text = text.replace(/\\\[/g, '$$$$'); 
  text = text.replace(/\\\]/g, '$$$$');
  text = text.replace(/\\\(/g, '$$'); 
  text = text.replace(/\\\)/g, '$$');
  return text.trim();
}

export async function onRequestGet({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  await ensureUsage(env);
  const used = await usedToday(env);
  return json({ used, limit: limitOf(env), has_cf_ai: !!env.AI, budget: NEURON_BUDGET, npp: EST_NEURONS_PER_PAGE });
}

export async function onRequestPost({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  if (!env.AI) return json({ error: '服务端未绑定 Workers AI' }, 500);
  await ensureUsage(env);

  const limit = limitOf(env);
  if (limit <= 0) return json({ error: 'Workers AI OCR 已停用', used: 0, limit }, 429);

  const used = await usedToday(env);
  if (used >= limit) {
    return json({ error: `今日免费额度已用完（${used}/${limit} 页）。`, used, limit }, 429);
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
    // 【修改点 2】：调整 AI 运行参数，加入防复读机机制
    const input = { 
      image: [...bytes], 
      prompt: PROMPT, 
      max_tokens: 2500,       // 稍微调大最大 token，防止截断（没写完整的问题）
      temperature: 0.2,       // 稍微提高一点点温度（原为0.1），打破模型自我重复的死循环
      repetition_penalty: 1.15 // 惩罚重复输出：强制打断大模型的“复读机”行为
    };
    try {
      out = await env.AI.run(model, input);
    } catch (e1) {
      if (/\b5016\b|submit the prompt 'agree'|must submit/i.test(e1.message || '')) {
        try { await env.AI.run(model, { prompt: 'agree' }); } catch (_) {}
        out = await env.AI.run(model, input);
      } else {
        throw e1;
      }
    }
    text = String((out && (out.response || out.text || out.description)) || '').trim();
    text = cleanAIOutput(text);

  } catch (e) {
    return json({ error: 'Workers AI 调用失败：' + e.message, used, limit }, 502);
  }

  try {
    await env.DB.prepare(`INSERT INTO ai_usage (day, pages) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET pages = pages + 1`).bind(todayUTC()).run();
  } catch (_) {}

  return json({ text, used: used + 1, limit, budget: NEURON_BUDGET, npp: EST_NEURONS_PER_PAGE });
}
