import { json, checkAuth, batchChunked } from './_utils.js';

const MAX_IMPORT = 2000; // 单次直接导入 JSON 的题目上限（超过请分批，防单请求撑爆内存/超时）

const VALID_SUBJECTS = ['politics', 'english', 'math', 'computer'];
const VALID_TYPES = ['single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'short_answer', 'code'];

// 由"科目 + 题干内容"生成稳定 id（64-bit 双 FNV），同一题重复导入会覆盖而非新增，避免重复题
export function stableQid(subject, stem) {
  const str = String(subject || '') + '|' + String(stem || '').replace(/\s+/g, ' ').trim();
  let h1 = 0x811c9dc5 >>> 0, h2 = 0xc2b2ae35 >>> 0;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

// —— 按题型规范化 + 校验答案 ——
// 返回 { answer:[...], warn:'...'|null }。策略保守：能修的修（大写/去重/限定选项内），
// 修不了的（如多选只给 1 个、答案不在选项里）保留原值但给出 warn，交由前端提示，不静默吞掉错题。
export function normalizeAnswer(type, rawAnswer, options) {
  const arr = Array.isArray(rawAnswer) ? rawAnswer : (rawAnswer != null && rawAnswer !== '' ? [rawAnswer] : []);
  const optKeys = (Array.isArray(options) ? options : []).map((o) => String(o && o.key || '').trim().toUpperCase()).filter(Boolean);
  if (type === 'single_choice' || type === 'multiple_choice') {
    let keys = [...new Set(arr.map((x) => String(x).trim().toUpperCase()).filter(Boolean))];
    let warn = null;
    if (optKeys.length) {
      const bad = keys.filter((k) => !optKeys.includes(k));
      if (bad.length) warn = `答案 ${bad.join('/')} 不在选项内`;
      const inRange = keys.filter((k) => optKeys.includes(k));
      if (inRange.length) keys = inRange;   // 有合法项就只留合法项；全不合法则保留原值供人工检查
    }
    if (!keys.length) warn = warn || '缺少答案';
    else if (type === 'single_choice' && keys.length > 1) { warn = '单选题有多个答案，已取第一个'; keys = [keys[0]]; }
    else if (type === 'multiple_choice' && keys.length < 2) warn = warn || '多选题只有一个答案';
    return { answer: keys, warn };
  }
  if (type === 'true_false') {
    const v = String(arr[0] != null ? arr[0] : '').trim();
    if (!v) return { answer: [], warn: '缺少答案' };
    return { answer: [/^(t|true|对|正确|是|√|1)$/i.test(v) ? 'T' : 'F'], warn: null };
  }
  // 填空 / 主观 / 代码：去空白空项，不强改
  const kept = arr.map((x) => String(x).trim()).filter(Boolean);
  return { answer: kept, warn: kept.length ? null : '缺少参考答案' };
}

// —— 结构特征判科目（代码语法 / 数学 TeX 符号 / 英文占比）——
export function structuralSubject(s) {
  if (/#include|void\s+main|int\s+main|printf\s*\(|scanf\s*\(|cout\s*<<|cin\s*>>|System\.out|public\s+(class|static|void)|def\s+\w+\s*\(|console\.log|malloc|struct\s+\w+|for\s*\([^;]*;|while\s*\(/.test(s)) return 'computer';
  if (/\\int|\\lim|\\sum|\\frac|\\sqrt|\\partial|\\overrightarrow|\\mathrm\{d\}/.test(s)) return 'math';
  const letters = (s.match(/[A-Za-z]/g) || []).length;
  const cjk = (s.match(/[\u4e00-\u9fa5]/g) || []).length;
  const len = s.replace(/\s/g, '').length;
  if (len >= 12 && letters >= len * 0.55 && cjk <= len * 0.15 && /\b(the|of|to|and|is|are|was|were|which|that|what|who|how|why|an?|in|on|for|with)\b/i.test(s)) return 'english';
  return '';
}

// —— 综合判科目：先结构特征，再按 subjects 表里的术语关键词匹配（仅强特征命中才返回，否则 ''）——
export function guessSubjectFromText(text, subjList) {
  const s = String(text || '');
  const codes = new Set((subjList || []).map((x) => x.code));
  const st = structuralSubject(s);
  if (st && (codes.size === 0 || codes.has(st))) return st;
  for (const sub of (subjList || [])) {
    const kws = String(sub.keywords || '').split(/[，,;；\s]+/).map((k) => k.trim()).filter((k) => k.length >= 2);
    for (const k of kws) { if (s.includes(k)) return sub.code; }
  }
  return '';
}

async function loadSubjectList(env) {
  try {
    const r = await env.DB.prepare(`SELECT code, keywords FROM subjects ORDER BY sort ASC, code ASC`).all();
    return (r.results || []).map((x) => ({ code: x.code, keywords: x.keywords || '' }));
  } catch (_) { return []; }
}
// kind: auto = AI 自动分辨；questions = 强制当题库；material = 强制当教材
const VALID_KINDS = ['auto', 'questions', 'material'];

export async function onRequestPost({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;

  let body;
  try { body = await request.json(); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }

  // 动态科目：合法科目 = 内置四科 ∪ subjects 表里用户自建的科目
  const subjList = await loadSubjectList(env);
  const validCodes = new Set([...VALID_SUBJECTS, ...subjList.map((x) => x.code)]);
  const subject = validCodes.has(body.subject) ? body.subject : 'computer';
  const defChapter = (body.chapter || '').trim();
  const defSource = (body.source || '').trim();
  const kind = VALID_KINDS.includes(body.kind) ? body.kind : 'auto';
  // trusted：前端直接传来的结构化题目数组（本地解析 / JSON 导入）→ 信任其科目，不做关键词猜测覆盖
  const trusted = Array.isArray(body.questions) && body.questions.length > 0;

  let questions = [];
  let materials = [];

  // —— 用户自定义中转站（全局覆盖：与 explain/visionocr 同一套守卫）——
  const ovBase = String(body.base_url || '').trim().replace(/\/+$/, '');
  const ovKey = String(body.api_key || '').trim();
  const ovModel = String(body.model || '').trim();
  const ovVision = String(body.vision_model || '').trim();
  if (ovBase && !ovKey) {
    return json({ error: '使用自定义 Base URL 时必须同时提供该站的 API Key（不会使用服务端密钥）' }, 400);
  }
  if (ovBase && !/^https:\/\//i.test(ovBase)) {
    return json({ error: '自定义 Base URL 必须以 https:// 开头' }, 400);
  }
  const ov = { base: ovBase, key: ovKey, model: ovModel, vision: ovVision };
  const aiReady = !!(ovBase && ovKey) || !!(env.AI_BASE_URL && env.AI_API_KEY);
  const noAiMsg = '未配置 AI 中转站：服务端未设 AI_BASE_URL/AI_API_KEY，也可在「设置 → AI 中转站」里填入你自己的';

  // 路径 A：直接导入已结构化的 JSON 数组（不调用 AI，零成本），始终视为题库
  if (Array.isArray(body.questions) && body.questions.length) {
    if (body.questions.length > MAX_IMPORT) {
      return json({ error: `单次最多导入 ${MAX_IMPORT} 题（本次 ${body.questions.length} 题），请拆成多批粘贴` }, 400);
    }
    questions = body.questions;
  } else if (Array.isArray(body.images) && body.images.length) {
    // 路径 C：图片/扫描页 → 视觉模型识别（含自动分辨）
    if (!aiReady) return json({ error: noAiMsg }, 400);
    const aiOut = await callAI(env, ov, { images: body.images.slice(0, 4) }, subject, defChapter, defSource, kind, true);
    if (aiOut.error) return json(aiOut, aiOut.status || 502);
    questions = aiOut.questions || [];
    materials = aiOut.materials || [];
  } else {
    // 路径 B：原文文本 → AI 中转站（含自动分辨）
    const rawText = (body.raw_text || '').trim();
    if (!rawText) return json({ error: '请提供 raw_text（原文）/ questions（JSON 数组）/ images（图片）' }, 400);
    if (!aiReady) return json({ error: noAiMsg }, 400);
    const aiOut = await callAI(env, ov, { rawText }, subject, defChapter, defSource, kind, false);
    if (aiOut.error) return json(aiOut, aiOut.status || 502);
    questions = aiOut.questions || [];
    materials = aiOut.materials || [];
  }

  // —— 校验 + 入库：题目 ——
  const cleanedQ = [];
  const answerWarns = [];
  for (const q of questions) {
    if (!q || !q.stem) continue;
    const type = VALID_TYPES.includes(q.type) ? q.type : 'single_choice';
    let subj;
    if (trusted) {
      // 信任前端给定的科目（本地解析/JSON 导入），不臆测覆盖
      subj = (q.subject && validCodes.has(q.subject)) ? q.subject
           : (validCodes.has(body.subject) ? body.subject : (q.subject || subject));
    } else {
      const guessed = guessSubjectFromText([q.stem, q.chapter, Array.isArray(q.options) ? q.options.map(o => o && o.text).join(' ') : ''].join('  '), subjList);
      subj = guessed || (validCodes.has(q.subject) ? q.subject : subject);
    }
    const id = (q.id && String(q.id).trim()) || `${subj}-${stableQid(subj, q.stem)}`;
    const optArr = Array.isArray(q.options) ? q.options : [];
    const na = normalizeAnswer(type, q.answer, optArr);
    if (na.warn) answerWarns.push(`「${String(q.stem).slice(0, 24)}…」${na.warn}`);
    cleanedQ.push({
      id,
      subject: subj,
      chapter: (q.chapter || defChapter || '').trim() || null,
      type,
      difficulty: Number.isInteger(q.difficulty) ? Math.min(5, Math.max(1, q.difficulty)) : 3,
      source: (q.source || defSource || '').trim() || null,
      page: Number.isInteger(q.page) ? q.page : (Number.isInteger(q._page) ? q._page : null),
      passage: (q.passage || '').trim() || null,
      stem: String(q.stem),
      options: JSON.stringify(optArr),
      answer: JSON.stringify(na.answer),
      analysis: (q.analysis || '').trim() || null,
      tags: JSON.stringify(Array.isArray(q.tags) ? q.tags : []),
      status: trusted ? null : 'draft',   // AI 整理的先进「待审核」，人工过目再发布；JSON 直导视为已校对
    });
  }

  // —— 校验 + 入库：教材 ——
  const cleanedM = [];
  for (const m of materials) {
    const content = String(m?.content_md || m?.content || '').trim();
    if (!content) continue;
    const subj = validCodes.has(m.subject) ? m.subject : subject;
    const id = (m.id && String(m.id).trim()) || `mat-${subj}-${crypto.randomUUID().slice(0, 12)}`;
    cleanedM.push({
      id,
      subject: subj,
      title: String(m.title || m.chapter || defChapter || '教材整理').trim().slice(0, 200),
      source: (m.source || defSource || '').trim() || null,
      page: Number.isInteger(m.page) ? m.page : null,
      page_image: (m.page_image || '').trim() || null,
      content_md: content,
      summary: (m.summary || '').trim() || null,
      tags: JSON.stringify(Array.isArray(m.tags) ? m.tags : []),
    });
  }

  if (!cleanedQ.length && !cleanedM.length) {
    return json({ error: '没有解析出有效内容（既无题目也无可整理的教材）' }, 422);
  }

  try {
    if (cleanedQ.length) {
      await ensureQuestionsSchema(env);
      // UPSERT 而非 OR REPLACE：保留 rowid/created_at 与关联的 progress 学习进度
      // （OR REPLACE = 先删后插，外键级联会顺带清掉该题的错题/收藏记录），且能正确触发 FTS 索引更新
      const sql = `INSERT INTO questions
        (id, subject, chapter, type, difficulty, source, passage, stem, options, answer, analysis, tags, page, status)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          subject=excluded.subject, chapter=excluded.chapter, type=excluded.type,
          difficulty=excluded.difficulty, source=excluded.source, passage=excluded.passage,
          stem=excluded.stem, options=excluded.options, answer=excluded.answer,
          analysis=excluded.analysis, tags=excluded.tags, page=excluded.page,
          status=excluded.status`;
      await batchChunked(env, cleanedQ.map((q) =>
        env.DB.prepare(sql).bind(
          q.id, q.subject, q.chapter, q.type, q.difficulty, q.source,
          q.passage, q.stem, q.options, q.answer, q.analysis, q.tags, q.page, q.status
        )
      ), 80);
    }
    if (cleanedM.length) {
      await ensureMaterialsTable(env);
      const sqlM = `INSERT OR REPLACE INTO materials
        (id, subject, title, source, page, page_image, content_md, summary, tags)
        VALUES (?,?,?,?,?,?,?,?,?)`;
      await batchChunked(env, cleanedM.map((m) =>
        env.DB.prepare(sqlM).bind(
          m.id, m.subject, m.title, m.source, m.page,
          m.page_image, m.content_md, m.summary, m.tags
        )
      ), 80);
    }
  } catch (e) {
    return json({ error: '写入数据库失败：' + e.message }, 500);
  }

  // detected：本次 AI 实际判定的类型，前端可据此提示用户
  const detected = cleanedQ.length && cleanedM.length ? 'mixed'
    : cleanedQ.length ? 'questions'
    : 'material';

  return json({
    ok: true,
    kind: detected,
    inserted: cleanedQ.length,            // 兼容旧前端：仍表示题目数
    inserted_questions: cleanedQ.length,
    inserted_materials: cleanedM.length,
    inserted_drafts: cleanedQ.filter((q) => q.status === 'draft').length,   // 其中进「待审核」的数量（AI 整理路径）
    answer_warns: answerWarns.slice(0, 8),   // 答案疑点（不在选项内/单选多答/多选单答等），前端提示，不阻断入库
    sample: cleanedQ.slice(0, 3).map((q) => ({ subject: q.subject, type: q.type, stem: q.stem.slice(0, 60) })),
    material_sample: cleanedM.slice(0, 3).map((m) => ({ subject: m.subject, title: m.title })),
  });
}

async function ensureQuestionsSchema(env) {
  // 老库的 questions 表可能没有 page / status 列，自动补上（已存在则忽略报错），无需手动迁移
  try { await env.DB.prepare('ALTER TABLE questions ADD COLUMN page INTEGER').run(); }
  catch (e) { /* duplicate column name：已存在，忽略 */ }
  try { await env.DB.prepare('ALTER TABLE questions ADD COLUMN status TEXT').run(); }
  catch (e) { /* 已存在，忽略 */ }
}

async function ensureMaterialsTable(env) {
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS materials (
    id TEXT PRIMARY KEY, subject TEXT NOT NULL, title TEXT NOT NULL, source TEXT,
    page INTEGER, page_image TEXT, content_md TEXT, summary TEXT, tags TEXT,
    created_at INTEGER DEFAULT (unixepoch())
  )`).run();
}

// —— 统一的 AI 调用：根据 kind 让模型分辨并返回 {kind, questions, materials} ——
async function callAI(env, ov, input, subject, chapter, source, kind, vision) {
  // 生效配置：自定义 base+key 成对生效；模型解析注意——自定义站时不沿用服务端模型名（可能在该站不存在）
  const custom = !!(ov && ov.base && ov.key);
  const base = (custom ? ov.base : env.AI_BASE_URL).replace(/\/+$/, '');
  const key = custom ? ov.key : ((ov && ov.key) || env.AI_API_KEY);
  const model = vision
    ? ((ov && ov.vision) || (custom ? ((ov && ov.model) || 'gpt-4o') : (env.AI_VISION_MODEL || env.AI_MODEL || 'gpt-4o')))
    : ((ov && ov.model) || (custom ? 'gpt-4o' : (env.AI_MODEL || 'gpt-4o')));
  const sys = buildSystemPrompt(kind);
  const hint = buildHint(subject, chapter, source, kind);

  let messages;
  if (vision) {
    const content = [{ type: 'text', text: hint + '\n\n下面是页面图片，请先准确识别图中文字（含数学公式、代码），再按上述要求处理。' }];
    for (const img of input.images) content.push({ type: 'image_url', image_url: { url: img } });
    messages = [{ role: 'system', content: sys }, { role: 'user', content }];
  } else {
    messages = [
      { role: 'system', content: sys },
      { role: 'user', content: `${hint}\n\n请处理下面的原文：\n\n"""\n${input.rawText}\n"""` },
    ];
  }

  let resp;
  try {
    resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, temperature: 0.1, messages, response_format: { type: 'json_object' } }),
    });
  } catch (e) {
    return { error: '调用 AI 中转站失败：' + e.message, status: 502 };
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    const extra = vision ? '（请确认所选模型支持图片输入）' : '';
    return { error: `AI 中转站返回 ${resp.status}${extra}`, detail: t.slice(0, 400), status: 502 };
  }
  const data = await resp.json().catch(() => null);
  const out = data?.choices?.[0]?.message?.content || '';
  const parsed = safeParse(out);
  if (!parsed.questions.length && !parsed.materials.length) {
    return { error: 'AI 未解析出有效内容，可换更强的模型或缩短单次输入', raw: String(out).slice(0, 800), status: 422 };
  }
  return parsed;
}

function safeParse(text) {
  const empty = { kind: 'unknown', questions: [], materials: [] };
  if (!text) return empty;
  let t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let obj;
  try { obj = JSON.parse(t); }
  catch {
    const m = t.match(/[\[{][\s\S]*[\]}]/);
    if (!m) return empty;
    try { obj = JSON.parse(m[0]); } catch { return empty; }
  }
  // 兼容：模型有时直接返回题目数组
  if (Array.isArray(obj)) return { kind: 'questions', questions: obj.filter((q) => q && q.stem), materials: [] };
  const questions = (obj.questions || obj.data || obj.items || []).filter((q) => q && q.stem);
  let materials = obj.materials || [];
  if (obj.material && typeof obj.material === 'object') materials = [obj.material, ...materials];
  materials = materials.filter((m) => m && (m.content_md || m.content));
  return { kind: obj.kind || 'unknown', questions, materials };
}

function buildSystemPrompt(kind) {
  const base = `你是「广东普通专升本（专插本）」备考资料的智能整理助手。用户会给你一段可能格式混乱的内容，可能是【试题/习题】，也可能是【教材正文/讲义】，也可能两者混在一起。

【第一步：判断内容类型】
- questions（题库）：存在明确的题目、例题、习题、选择项、答案或可训练的问题。
- material（教材）：是讲解性正文、概念定义、定理推导、知识点叙述，没有可直接作答的题目。
- mixed（混合）：同一段里既有讲解又有习题。

【第二步：按类型整理】只输出一个 JSON 对象，不要任何解释或 Markdown 围栏，结构如下：
{
  "kind": "questions" | "material" | "mixed",
  "questions": [ 题目对象… ],   // 没有题目则空数组
  "materials": [ 教材对象… ]    // 没有教材则空数组
}

题目对象字段：
  - subject: "politics"(政治) | "english"(英语) | "math"(高等数学) | "computer"(计算机基础与程序设计)。用户指定时优先。
  - chapter: 章节/知识点（如「数据结构-线性表」「C语言-指针」；不确定留空字符串）。
  - type: "single_choice" | "multiple_choice" | "true_false" | "fill_blank" | "short_answer" | "code"。
  - difficulty: 1~5 整数，默认 3。
  - source: 来源（如「2023真题」），不确定留空。
  - passage: 阅读理解/完形填空公共材料，无则空字符串；同篇多题各自重复。
  - stem: 题干（必填）。数学公式用 LaTeX（$...$ 或 $$...$$），代码用 \`\`\`c ... \`\`\`。
  - options: 选择题选项 [{"key":"A","text":"..."}]；非选择题为 []。
  - answer: 答案数组。选择题用 key（["B"] / ["A","C"]）；判断用 ["T"]/["F"]；填空按顺序给各空标准答案；简答/代码把参考答案文本放进首元素。
  - analysis: 解析；原文没有就你补一段简明解析。
  - tags: 关键词标签字符串数组。

教材对象字段（这是你要主动做的"整理分析"，不是照抄原文）：
  - subject: 同上四选一。
  - title: 这页/这段教材的小标题（如「极限的定义与性质」「指针与数组的关系」）。
  - chapter: 所属章节。
  - summary: 一两句话概括本段核心内容。
  - content_md: 用 Markdown 把知识点整理成结构化笔记——提炼要点、列出关键定义/公式/定理、必要时配简短例子；公式用 LaTeX，代码用围栏。这是给学生复习用的精炼笔记，不是原文复制。
  - tags: 关键概念标签字符串数组。

【规则】保持原意不臆造；把混在一起的答案、解析正确归位；目录、页码、广告等无关内容忽略；只有当原文确实是讲解性正文时才放进 materials，确实是题目时才放进 questions。`;

  if (kind === 'questions') {
    return base + `\n\n【本次强制】用户已指定只要题库：materials 一律返回空数组，把内容尽量结构化为题目。`;
  }
  if (kind === 'material') {
    return base + `\n\n【本次强制】用户已指定只要教材整理：questions 一律返回空数组，把内容整理成结构化教材笔记。`;
  }
  return base + `\n\n【本次】自动分辨，按真实类型填充 questions 与 materials。`;
}

function buildHint(subject, chapter, source, kind) {
  const map = { politics: '政治理论', english: '英语', math: '高等数学', computer: '计算机基础与程序设计' };
  let hint = `本批内容科目默认为：${map[subject]}（subject="${subject}"）。`;
  if (chapter) hint += `\n章节默认为：「${chapter}」。`;
  if (source) hint += `\n来源默认为：「${source}」。`;
  if (kind === 'questions') hint += `\n用户选择了"只导入题库"。`;
  else if (kind === 'material') hint += `\n用户选择了"只导入教材"。`;
  else hint += `\n用户选择了"自动分辨"，请你判断这是题目还是教材。`;
  return hint;
}
