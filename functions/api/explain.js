import { json, checkAuth } from './_utils.js';

// POST /api/explain —— AI 解析当前题目
// 默认以 SSE 流式透传（浏览器边收边渲染）；上游不支持流式时自动降级为一次性 JSON {text}
// 客户端中断（切题/重新生成）会通过 request.signal 传导到上游，及时止损 token 消耗
export async function onRequestPost({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  if (!env.AI_BASE_URL || !env.AI_API_KEY) {
    return json({ error: '未配置 AI 中转站（AI_BASE_URL / AI_API_KEY），无法生成 AI 解析' }, 400);
  }

  let b;
  try { b = await request.json(); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }
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

  const sys = '你是一位耐心且严谨的大学课程解题老师。请针对给出的题目输出一份详细解析，使用 Markdown，数学公式一律用 $...$（行内）或 $$...$$（独立行）作为定界符，严禁使用 \\( \\) 与 \\[ \\]。结构：先用一两句话点明「思路」；然后分步推导（关键步骤要交代依据，如用到的定理/公式）；最后给出「易错点」。若提供了参考答案，以参考答案为准展开讲解，不要另起炉灶；不要重复抄写题干；中文回答，直接开始，不要客套话。';

  const base = env.AI_BASE_URL.replace(/\/+$/, '');
  const payload = {
    model: env.AI_MODEL || 'gpt-4o',
    messages: [ { role: 'system', content: sys }, { role: 'user', content: parts.join('\n\n') } ],
    temperature: 0.3,
    max_tokens: 1600,
  };
  const call = (stream) => fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env.AI_API_KEY },
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
      return json({ text });
    }
    const up = await call(false);
    if (!up.ok) {
      let msg = '上游 HTTP ' + up.status;
      try { const d = await up.json(); msg = (d.error && (d.error.message || d.error)) || msg; } catch (_) {}
      return json({ error: 'AI 中转站错误：' + msg }, 502);
    }
    const d = await up.json();
    const text = (d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '';
    return json({ text });
  } catch (e) {
    if (e && e.name === 'AbortError') return json({ error: '已取消' }, 499);
    return json({ error: '连接 AI 中转站失败：' + e.message }, 502);
  }
}
