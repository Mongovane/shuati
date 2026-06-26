import { json, checkAuth } from './_utils.js';

const DEFAULT_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
const PROMPT = [
  'You are a precise OCR engine for textbook pages.',
  'Transcribe ALL text in the image in its original language (Chinese and/or English).',
  'Preserve reading order, paragraphs and line breaks.',
  'Render every mathematical formula, equation, symbol, subscript and superscript as LaTeX,',
  'wrapped in $...$ for inline math and $$...$$ for display math.',
  'Output ONLY the transcribed content as Markdown. No explanations, no preamble, no translation.',
].join(' ');

function todayUTC() { return new Date().toISOString().slice(0, 10); }
function limitOf(env) { const n = parseInt(env.AI_DAILY_PAGE_LIMIT || '60', 10); return Number.isFinite(n) ? n : 60; }

async function ensureUsage(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS ai_usage (day TEXT PRIMARY KEY, pages INTEGER DEFAULT 0)`).run();
}
async function usedToday(env) {
  const row = await env.DB.prepare(`SELECT pages FROM ai_usage WHERE day = ?`).bind(todayUTC()).first();
  return row ? (row.pages || 0) : 0;
}

// GET → 返回今日用量与上限（前端展示与闸门提示）
export async function onRequestGet({ request, env }) {
  const auth = checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  await ensureUsage(env);
  const used = await usedToday(env);
  return json({ used, limit: limitOf(env), has_cf_ai: !!env.AI });
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

  const model = env.CF_OCR_MODEL || DEFAULT_MODEL;
  let text = '';
  try {
    let out;
    try {
      out = await env.AI.run(model, { image: [...bytes], prompt: PROMPT, max_tokens: 2048 });
    } catch (e1) {
      // Llama 3.2 等模型首次使用需先提交 'agree' 接受许可（错误码 5016）。自动接受后重试一次。
      if (/\b5016\b|submit the prompt 'agree'|must submit/i.test(e1.message || '')) {
        try { await env.AI.run(model, { prompt: 'agree' }); } catch (_) {}
        out = await env.AI.run(model, { image: [...bytes], prompt: PROMPT, max_tokens: 2048 });
      } else {
        throw e1;
      }
    }
    text = String((out && (out.response || out.text || out.description)) || '').trim();
  } catch (e) {
    return json({ error: 'Workers AI 调用失败：' + e.message, used, limit }, 502);
  }

  // 仅在成功后才计数（失败不扣额度）
  try {
    await env.DB.prepare(`INSERT INTO ai_usage (day, pages) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET pages = pages + 1`).bind(todayUTC()).run();
  } catch (_) {}

  return json({ text, used: used + 1, limit });
}
