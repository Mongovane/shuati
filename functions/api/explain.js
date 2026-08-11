import { json, checkAuth } from './_utils.js';
import { systemPrompt } from './_prompts.js';

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
  const trimLevel = Math.max(0, parseInt(b.trim_level, 10) || 0); // 前端降级重试时递增
  const priorAnalysis = String(b.analysis || '').slice(0, trimLevel >= 2 ? 2500 : (trimLevel >= 1 ? 4000 : 6000));
  const keepN = Math.max(2, 10 - trimLevel * 2);                   // 每级降级少留 2 条
  const perMsgCap = trimLevel >= 2 ? 2000 : 4000;                  // 降级到 2 级时单条也收紧
  const rawHist = Array.isArray(b.history) ? b.history.slice(-keepN) : [];
  const history = rawHist.map((m) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content || '').slice(0, perMsgCap),
  }));

  const reading = b.mode === 'reading';
  const concept = b.kind === 'concept';
  // 系统提示词按学科分流（见 _prompts.js）：英语走中英对照 / 语法卡片，其余保持原口径。
  // q.subject 前端一直在传（practice.js 的 aiFetch），以前后端没用，现在接上。
  const sys = systemPrompt({ subject: q.subject, ask, concept, reading });

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
    max_tokens: ask ? 4096 : (concept ? 6000 : 8192),
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
        // SSE 原样透传 + 附带 Gateway 降级信息供前端显示实际模型
        const served = up.headers.get('X-Served-Model') || up.headers.get('x-served-model') || '';
        const fallbackFrom = up.headers.get('X-Fallback-From') || up.headers.get('x-fallback-from') || '';
        const actualModel = served || String((up.headers && (up.headers.get('x-upstream-model') || up.headers.get('x-upstream'))) || payload.model);
        return new Response(up.body, {
          headers: {
            'content-type': 'text/event-stream; charset=utf-8',
            'cache-control': 'no-store',
            'x-accel-buffering': 'no',
            'x-ai-model': actualModel,
            ...(fallbackFrom ? { 'x-ai-fallback': fallbackFrom } : {}),
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
