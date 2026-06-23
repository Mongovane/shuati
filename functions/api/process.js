import { json, checkAuth } from './_utils.js';

const VALID_SUBJECTS = ['politics', 'english', 'math', 'chinese', 'computer'];
const VALID_TYPES = ['single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'code'];

export async function onRequestPost({ request, env }) {
  const auth = checkAuth(request, env);
  if (!auth.ok) return auth.resp;

  let body;
  try { body = await request.json(); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }

  const subject = VALID_SUBJECTS.includes(body.subject) ? body.subject : 'computer';
  const defChapter = (body.chapter || '').trim();
  const defSource = (body.source || '').trim();

  let questions;

  // 路径 A：直接导入已结构化的 JSON 数组（不调用 AI，零成本）
  if (Array.isArray(body.questions) && body.questions.length) {
    // 路径 A：直接导入已结构化 JSON（零成本）
    questions = body.questions;
  } else if (Array.isArray(body.images) && body.images.length) {
    // 路径 C：扫描件页面图片 → 视觉模型识别（用于扫描版 PDF）
    if (!env.AI_BASE_URL || !env.AI_API_KEY) {
      return json({ error: '服务端未配置 AI_BASE_URL / AI_API_KEY，无法调用 AI 中转站' }, 500);
    }
    const aiOut = await callAIVision(env, body.images.slice(0, 4), subject, defChapter, defSource);
    if (aiOut.error) return json(aiOut, aiOut.status || 502);
    questions = aiOut.questions;
  } else {
    // 路径 B：原文文本 → AI 中转站清洗
    const rawText = (body.raw_text || '').trim();
    if (!rawText) return json({ error: '请提供 raw_text（原文）/ questions（JSON 数组）/ images（图片）' }, 400);
    if (!env.AI_BASE_URL || !env.AI_API_KEY) {
      return json({ error: '服务端未配置 AI_BASE_URL / AI_API_KEY，无法调用 AI 中转站' }, 500);
    }
    const aiOut = await callAI(env, rawText, subject, defChapter, defSource);
    if (aiOut.error) return json(aiOut, aiOut.status || 502);
    questions = aiOut.questions;
  }

  // 校验 + 入库
  const cleaned = [];
  for (const q of questions) {
    if (!q || !q.stem) continue;
    const type = VALID_TYPES.includes(q.type) ? q.type : 'single_choice';
    const subj = VALID_SUBJECTS.includes(q.subject) ? q.subject : subject;
    const id = (q.id && String(q.id).trim()) || `${subj}-${crypto.randomUUID().slice(0, 8)}`;
    cleaned.push({
      id,
      subject: subj,
      chapter: (q.chapter || defChapter || '').trim() || null,
      type,
      difficulty: Number.isInteger(q.difficulty) ? Math.min(5, Math.max(1, q.difficulty)) : 3,
      source: (q.source || defSource || '').trim() || null,
      passage: (q.passage || '').trim() || null,
      stem: String(q.stem),
      options: JSON.stringify(Array.isArray(q.options) ? q.options : []),
      answer: JSON.stringify(Array.isArray(q.answer) ? q.answer : (q.answer != null ? [q.answer] : [])),
      analysis: (q.analysis || '').trim() || null,
      tags: JSON.stringify(Array.isArray(q.tags) ? q.tags : []),
    });
  }

  if (!cleaned.length) return json({ error: '没有解析出有效题目' }, 422);

  const sql = `INSERT OR REPLACE INTO questions
    (id, subject, chapter, type, difficulty, source, passage, stem, options, answer, analysis, tags)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`;
  const stmts = cleaned.map((q) =>
    env.DB.prepare(sql).bind(
      q.id, q.subject, q.chapter, q.type, q.difficulty, q.source,
      q.passage, q.stem, q.options, q.answer, q.analysis, q.tags
    )
  );

  try {
    await env.DB.batch(stmts);
  } catch (e) {
    return json({ error: '写入数据库失败：' + e.message }, 500);
  }

  return json({
    ok: true,
    inserted: cleaned.length,
    sample: cleaned.slice(0, 3).map((q) => ({ subject: q.subject, type: q.type, stem: q.stem.slice(0, 60) })),
  });
}

// —— 调用 OpenAI 兼容的中转站，把原文转成题目数组 ——
async function callAI(env, rawText, subject, chapter, source) {
  const base = env.AI_BASE_URL.replace(/\/+$/, '');
  const sys = buildSystemPrompt();
  const user = buildUserPrompt(rawText, subject, chapter, source);

  let resp;
  try {
    resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${env.AI_API_KEY}`,
      },
      body: JSON.stringify({
        model: env.AI_MODEL || 'gpt-4o',
        temperature: 0.1,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: user },
        ],
        response_format: { type: 'json_object' },
      }),
    });
  } catch (e) {
    return { error: '调用 AI 中转站失败：' + e.message, status: 502 };
  }

  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    return { error: `AI 中转站返回 ${resp.status}`, detail: t.slice(0, 400), status: 502 };
  }

  const data = await resp.json().catch(() => null);
  const content = data?.choices?.[0]?.message?.content || '';
  const questions = safeParseQuestions(content);
  if (!questions.length) {
    return { error: 'AI 未解析出题目，可换更强的模型或缩短单次原文', raw: String(content).slice(0, 800), status: 422 };
  }
  return { questions };
}

// —— 调用视觉模型识别扫描页图片（扫描版 PDF 用） ——
async function callAIVision(env, images, subject, chapter, source) {
  const base = env.AI_BASE_URL.replace(/\/+$/, '');
  const content = [
    { type: 'text', text: buildHint(subject, chapter, source) + '\n\n下面是试卷扫描页图片，请先准确识别图中文字（含数学公式、代码），再按上述要求结构化为 JSON。' },
  ];
  for (const img of images) content.push({ type: 'image_url', image_url: { url: img } });

  let resp;
  try {
    resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.AI_API_KEY}` },
      body: JSON.stringify({
        model: env.AI_MODEL || 'gpt-4o',
        temperature: 0.1,
        messages: [{ role: 'system', content: buildSystemPrompt() }, { role: 'user', content }],
        response_format: { type: 'json_object' },
      }),
    });
  } catch (e) {
    return { error: '调用视觉模型失败：' + e.message, status: 502 };
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    return { error: `AI 中转站返回 ${resp.status}（请确认所选模型支持图片输入）`, detail: t.slice(0, 400), status: 502 };
  }
  const data = await resp.json().catch(() => null);
  const out = data?.choices?.[0]?.message?.content || '';
  const questions = safeParseQuestions(out);
  if (!questions.length) {
    return { error: '未从图片识别出题目，请确认模型支持视觉，或改用文字版 PDF', raw: String(out).slice(0, 800), status: 422 };
  }
  return { questions };
}

function safeParseQuestions(text) {
  if (!text) return [];
  let t = String(text).trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  let obj;
  try {
    obj = JSON.parse(t);
  } catch {
    const m = t.match(/[\[{][\s\S]*[\]}]/);
    if (!m) return [];
    try { obj = JSON.parse(m[0]); } catch { return []; }
  }
  const arr = Array.isArray(obj) ? obj : (obj.questions || obj.data || obj.items || []);
  return Array.isArray(arr) ? arr.filter((q) => q && q.stem) : [];
}

function buildSystemPrompt() {
  return `你是专业的考试题库结构化助手，服务于「广东普通专升本（专插本）」备考。
任务：把用户提供的、可能格式混乱的题目原文，转换为严格符合下述结构的题目数组。

输出要求（务必遵守）：
1. 只输出一个 JSON 对象，形如 {"questions":[ ... ]}，不要任何解释文字或 Markdown 代码块标记。
2. 每道题对象字段：
   - subject: "politics"(政治) | "english"(英语) | "math"(高数) | "chinese"(大学语文) | "computer"(计算机基础与程序设计)。用户已指定科目时优先用指定值。
   - chapter: 章节/知识点（如「数据结构-线性表」「C语言-指针」「政治-马原-唯物史观」「英语-阅读理解」；不确定可留空字符串）。
   - type: "single_choice"(单选) | "multiple_choice"(多选) | "true_false"(判断) | "fill_blank"(填空) | "short_answer"(简答/论述/材料分析) | "code"(程序设计/手写代码)。
   - difficulty: 1~5 的整数，凭经验估计，默认 3。
   - source: 来源（如「2023真题」），不确定留空字符串。
   - passage: 阅读理解/完形填空的公共材料文本；无公共材料则空字符串。同一篇阅读的多个小题请拆成多道题，每道都重复带相同 passage。
   - stem: 题干（必填）。数学公式用 LaTeX，行内用 $...$、独立用 $$...$$；代码用 Markdown 围栏 \`\`\`c ... \`\`\`。
   - options: 选择题选项数组，元素 {"key":"A","text":"..."}；非选择题为 []。
   - answer: 答案数组。single_choice/multiple_choice 用选项 key，如 ["B"] 或 ["A","C"]；true_false 用 ["T"](正确)/["F"](错误)；fill_blank 用各空标准答案字符串数组（按顺序）；short_answer/code 把参考答案文本放进数组首元素。
   - analysis: 解析；原文无解析则你补写一段简明解析，代码题给出关键思路。
   - tags: 关键词标签字符串数组。
3. 保持原意，不臆造题目；把混在一起的答案、解析正确归位到对应题目；非题目内容（目录、页码、广告等）忽略。`;
}

function buildHint(subject, chapter, source) {
  const map = { politics: '政治', english: '英语', math: '高数', chinese: '大学语文', computer: '计算机基础与程序设计' };
  let hint = `本批题目科目默认为：${map[subject]}（subject="${subject}"）。`;
  if (chapter) hint += `\n章节默认为：「${chapter}」。`;
  if (source) hint += `\n来源默认为：「${source}」。`;
  return hint;
}

function buildUserPrompt(rawText, subject, chapter, source) {
  return `${buildHint(subject, chapter, source)}\n\n请把下面的原文结构化为 JSON：\n\n"""\n${rawText}\n"""`;
}
