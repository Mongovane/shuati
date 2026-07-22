import { json, checkAuth } from './_utils.js';

// POST /api/explain —— AI 解析当前题目
// 默认以 SSE 流式透传（浏览器边收边渲染）；上游不支持流式时自动降级为一次性 JSON {text}
// 客户端中断（切题/重新生成）会通过 request.signal 传导到上游，及时止损 token 消耗
export async function onRequestPost({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;

  let b;
  try { b = await request.json(); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }

  // —— 用户自定义中转站（保存在其浏览器 localStorage，请求时随身携带）——
  // 安全守卫与 visionocr 一致：自带 base_url 必须自带 api_key，绝不把服务端密钥发往非配置地址
  const ovBase = String(b.base_url || '').trim().replace(/\/+$/, '');
  const ovKey = String(b.api_key || '').trim();
  const ovModel = String(b.model || '').trim();
  if (ovBase && !ovKey) {
    return json({ error: '使用自定义 Base URL 时必须同时填写该站的 API Key（不会使用服务端密钥）' }, 400);
  }
  if (ovBase && !/^https:\/\//i.test(ovBase)) {
    return json({ error: '自定义 Base URL 必须以 https:// 开头' }, 400);
  }
  const effBase = ovBase || (env.AI_BASE_URL ? String(env.AI_BASE_URL).replace(/\/+$/, '') : '');
  const effKey = ovBase ? ovKey : (ovKey || env.AI_API_KEY || '');
  if (!effBase || !effKey) {
    return json({ error: '未配置 AI 中转站：服务端未设 AI_BASE_URL/AI_API_KEY，也可在「设置 → AI 解析」里填入你自己的中转站' }, 400);
  }
  const q = b.question || {};
  const stem = String(q.stem || '').trim().slice(0, 6000);
  const pageImage = typeof b.image === 'string' && /^data:image\//.test(b.image) ? b.image : '';
  if (!stem && !pageImage) return json({ error: '缺少题目内容' }, 400);
  const wantStream = b.stream !== false && b.kind !== 'concept';

  const typeMap = { single_choice: '单选题', multiple_choice: '多选题', true_false: '判断题', fill_blank: '填空题', short_answer: '简答题', code: '编程题' };
  const parts = [];
  if (q.passage) parts.push('【材料】\n' + String(q.passage).slice(0, 3000));
  parts.push('【题目】' + (typeMap[q.type] ? '（' + typeMap[q.type] + '）' : '') + '\n' + stem);
  if (Array.isArray(q.options) && q.options.length) {
    parts.push('【选项】\n' + q.options.map((o) => (o.key || '') + '. ' + (o.text || '')).join('\n'));
  }
  const ans = Array.isArray(q.answer) ? q.answer.join('；') : (q.answer == null ? '' : String(q.answer));
  if (ans.trim()) parts.push('【参考答案】\n' + ans.slice(0, 3000));

  // —— 追问模式：ask 存在时，在「题目 + 已生成解析」上下文里继续多轮问答 ——
  const ask = String(b.ask || '').trim().slice(0, 2000);
  const priorAnalysis = String(b.analysis || '').slice(0, 6000);
  const history = Array.isArray(b.history) ? b.history.slice(-8).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, 4000),
  })) : [];

  const fmtRule = '数学公式一律用 $...$（行内）或 $$...$$（独立行）作为定界符，严禁使用 \\( \\) 与 \\[ \\]。';
  const reading = b.mode === 'reading';
  const concept = b.kind === 'concept';
  const sys = ask
    ? (reading
      ? ('你是一位耐心的大学课程辅导老师，学生在阅读教材/资料时就选中的内容提问。基于提供的材料与选段作答，聚焦所问，讲清概念与来龙去脉，简洁清楚；使用 Markdown，' + fmtRule + '中文回答，直接开始。')
      : ('你是一位耐心且严谨的大学课程解题老师，正在就同一道题回答学生的追问。基于题目与先前给出的解析作答，聚焦学生问的点，简洁清楚；使用 Markdown，' + fmtRule + '中文回答，直接开始。'))
    : concept
      ? ('你面对的是一位脱产多年、数学/专业基础几乎忘光、正在从零重新备考的成年学习者。TA 看到常规解析会因为"跳步"和"默认你还记得基础"而看不懂。请【不要解这道题】，而是提取本题涉及的【前置知识点/公式/概念】，做成 4~7 张知识卡片，把每个知识点讲到"一个高中都没学好的人也能懂"的程度。\n只输出一个 JSON 数组，不要任何额外文字、不要 Markdown 代码块围栏。每个元素形如：\n{"term":"知识点名称","formula":"核心公式（用 $...$ 包裹的 LaTeX；无公式则空字符串）","plain":"详细讲解","example":"具体例子"}\n对 plain 的要求（这是重点）：不要只写一句话！要 3~5 句，像给完全忘光的人补课：①先说它直白是什么、解决什么问题；②用一个生活类比帮 TA 建立直觉；③如果有公式，逐个符号说明"这个字母代表什么、为什么这么算"，不要假设 TA 认识记号。宁可啰嗦也不要跳步。\n对 example 的要求：给一个带具体数字的最简单例子，或说明它在本题里具体怎么用，让 TA 看到"原来是这样用的"。\n格式铁律：所有数学符号、变量、公式、区间（例如 $f(x)$、$x_1$、$[a,b]$、$\\xi$、$\\ln x$）都必须用 $...$ 包裹，绝不能写成普通文本；定界符只用 $...$，禁止 \\\\( \\\\) 与 \\\\[ \\\\]。整个输出必须能被 JSON.parse 解析；不要输出本题答案或完整解题步骤。')
      : ('你是一位耐心且严谨的大学课程解题老师。请针对给出的题目输出一份【详尽】的解析，使用 Markdown，' + fmtRule + '结构：先用一两句话点明「思路」；然后【完整分步推导】——每一步写出具体运算过程与所依据的定理/公式，不跳步、不省略中间步骤、不用「显然」「易得」「略」带过，选择题要逐个选项分析对错原因；最后给出「易错点」。输出长度不设上限，宁详勿略。若提供了参考答案，以参考答案为准展开讲解，不要另起炉灶；不要重复抄写题干；中文回答，直接开始，不要客套话。');

  const base = effBase;
  // reading 模式：用「材料 + 选段」的自然表述做上下文，不套题目/选项/参考答案模板（否则模型误以为在解题而非阅读辅导）
  let userText;
  if (reading) {
    const seg = [];
    if (q.passage) seg.push('【本页材料】\n' + String(q.passage).slice(0, 4000));
    const focus = String(q.stem || '').trim();
    if (focus && !/^（/.test(focus)) seg.push('【我选中/关注的部分】\n' + focus.slice(0, 3000));
    userText = seg.join('\n\n') || '（见下方图片/材料）';
  } else {
    userText = parts.join('\n\n');
  }
  const firstUser = pageImage
    ? { role: 'user', content: [ { type: 'text', text: (userText || '（请阅读下图这一页教材内容）') }, { type: 'image_url', image_url: { url: pageImage } } ] }
    : { role: 'user', content: userText };
  const messages = [ { role: 'system', content: sys }, firstUser ];
  if (ask) {
    if (priorAnalysis) messages.push({ role: 'assistant', content: priorAnalysis }); // 已生成的解析作为上一轮回答
    messages.push(...history);                                                        // 之前的追问轮次
    messages.push({ role: 'user', content: ask });                                    // 本次追问
  }
  const payload = {
    model: pageImage ? (String(b.vision_model||'').trim() || ovModel || env.AI_VISION_MODEL || env.AI_MODEL || 'gpt-4o') : (ovModel || env.AI_MODEL || 'gpt-4o'),
    messages,
    temperature: 0.3,
    max_tokens: ask ? 1400 : (concept ? 4200 : 3000),
  };
  const call = (stream) => fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + effKey },
    body: JSON.stringify({ ...payload, stream }),
    signal: request.signal, // 客户端中断 → 上游同步中断
  });

  try {
    if (wantStream) {
      const up = await call(true);
      if (up.ok && up.body) {
        // SSE 原样透传：Cloudflare Pages Functions 支持流式 Response
        return new Response(up.body, {
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store',
            'x-accel-buffering': 'no',
            // 真实模型：优先取上游声明（one-api/new-api 常回 x-upstream-model / x-upstream），
            // 兜底用请求的模型名；前端还会用 SSE chunk 里的 model 字段做最终校准
            'x-ai-model': String((up.headers && (up.headers.get('x-upstream-model') || up.headers.get('x-upstream'))) || payload.model),
          },
        });
      }
      // 上游拒绝流式（部分中转站不支持）→ 自动降级一次性
      const up2 = await call(false);
      if (!up2.ok) {
        let msg = '上游 HTTP ' + up2.status;
        try { const d = await up2.json(); msg = (d.error && (d.error.message || d.error)) || msg; } catch (_) {}
        return json({ error: 'AI 中转站错误：' + msg }, 502);
      }
      const d = await up2.json();
      const text = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
      return json({ text, model: (d && d.model) || payload.model });
    }
    const up = await call(false);
    if (!up.ok) {
      let msg = '上游 HTTP ' + up.status;
      try { const d = await up.json(); msg = (d.error && (d.error.message || d.error)) || msg; } catch (_) {}
      return json({ error: 'AI 中转站错误：' + msg }, 502);
    }
    const d = await up.json();
    const text = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
    return json({ text, model: (d && d.model) || payload.model });
  } catch (e) {
    if (e && e.name === 'AbortError') return json({ error: '已取消' }, 499);
    return json({ error: '连接 AI 中转站失败：' + e.message }, 502);
  }
}
