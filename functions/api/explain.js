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
  if (!stem) return json({ error: '缺少题目内容' }, 400);
  const wantStream = b.stream !== false;

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
  const sys = ask
    ? ('你是一位耐心且严谨的大学课程解题老师，正在就同一道题回答学生的追问。基于题目与先前给出的解析作答，聚焦学生问的点，简洁清楚；使用 Markdown，' + fmtRule + '中文回答，直接开始。')
    : ('你是一位耐心且严谨的大学课程解题老师。请针对给出的题目输出一份详细解析，使用 Markdown，' + fmtRule + '结构：先用一两句话点明「思路」；然后分步推导（关键步骤要交代依据，如用到的定理/公式）；最后给出「易错点」。若提供了参考答案，以参考答案为准展开讲解，不要另起炉灶；不要重复抄写题干；中文回答，直接开始，不要客套话。');

  const base = effBase;
  const messages = [ { role: 'system', content: sys }, { role: 'user', content: parts.join('\n\n') } ];
  if (ask) {
    if (priorAnalysis) messages.push({ role: 'assistant', content: priorAnalysis }); // 已生成的解析作为上一轮回答
    messages.push(...history);                                                        // 之前的追问轮次
    messages.push({ role: 'user', content: ask });                                    // 本次追问
  }
  const payload = {
    model: ovModel || env.AI_MODEL || 'gpt-4o',
    messages,
    temperature: 0.3,
    max_tokens: ask ? 1000 : 1600,
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
