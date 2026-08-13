import { json, checkAuth } from './_utils.js';
import { normalizeAnswer } from './process.js';

// POST /api/answerfill —— 给「抽出来但没有答案」的题批量补参考答案
//
// 输入 { questions:[{id,type,stem,options,passage,subject}], base_url?, api_key?, model? }
// 输出 { items:[{id, answer:[], analysis, warn?, skip?}], model }
//
// 只返回建议、**不写库**：前端拿到后按 status='draft' 落库，走仓库里已有的「待审」流程
// 人工过一遍再发布。AI 补的答案（尤其数学推导）必须当草稿看待。
//
// 依赖插图的题（「对图 1-9 所示的函数…」）会被要求返回 skip 而不是硬编一个答案 ——
// 插图现在存在 R2，提示词里只有短链，模型看不到图，硬答必然是幻觉。

const TIMEOUT_MS = 180000;   // 3 分钟：一次 8 题，正常十几秒；超过说明上游卡了

const TYPE_CN = {
  single_choice: '单选题', multiple_choice: '多选题', true_false: '判断题',
  fill_blank: '填空题', short_answer: '简答/计算/证明题', code: '编程题',
};

const SYS = [
  '你是一位严谨的中文教材助教，任务是为已有题干的习题补出「参考答案」。',
  '必须严格输出 JSON 对象，形如 {"items":[{"id":"...","answer":[...],"analysis":"...","skip":""}]}，不要任何解释性前后缀、不要 Markdown 代码围栏。',
  '规则：',
  '1) 选择题 / 多选题：answer 只放选项字母，如 ["A"] 或 ["A","C"]；不要放选项正文。',
  '2) 判断题：answer 放 ["T"] 或 ["F"]。',
  '3) 填空题：answer 按空的顺序逐项放，每空一个字符串。',
  '4) 简答/计算/证明题：answer 放一个字符串，是完整的参考答案（可含推导步骤）。数学公式用 $...$ 或 $$...$$ 的 LaTeX。',
  '5) analysis 放简短思路或易错点，可为空字符串。',
  '6) 如果题干依赖你看不到的插图、表格、附录或前文（例如出现「如图」「下图」「上表」而正文没有给出数据），',
  '   不要猜：把 answer 设为 []，并在 skip 里写明原因（如「依赖插图」）。',
  '7) 如果题干本身残缺、读不通，同样按第 6 条返回 skip（原因写「题干不完整」）。',
  '8) items 必须与输入的题一一对应，id 原样回填，不要增删、不要改写 id。',
].join('\n');

function safeParseItems(text) {
  if (!text) return [];
  let t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let obj = null;
  try { obj = JSON.parse(t); } catch {
    const m = t.match(/[[{][\s\S]*[\]}]/);
    if (!m) return [];
    try { obj = JSON.parse(m[0]); } catch { return []; }
  }
  if (Array.isArray(obj)) return obj;
  const arr = obj && (obj.items || obj.answers || obj.data || obj.questions);
  return Array.isArray(arr) ? arr : [];
}

export async function onRequestPost({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;

  let b;
  try { b = await request.json(); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }

  // 自带中转站的守卫与 explain / visionocr 保持一致：
  // 自带 base_url 就必须自带 api_key，绝不把服务端密钥发往非配置地址
  const ovBase = String(b.base_url || '').trim().replace(/\/+$/, '');
  const ovKey = String(b.api_key || '').trim();
  const ovModel = String(b.model || '').trim();
  if (ovBase && !ovKey) {
    return json({ error: '使用自定义 Base URL 时必须同时填写该站的 API Key（不会使用服务端密钥）' }, 400);
  }
  if (ovBase && !/^https:\/\//i.test(ovBase)) {
    return json({ error: '自定义 Base URL 必须以 https:// 开头' }, 400);
  }
  const base = ovBase || (env.AI_BASE_URL ? String(env.AI_BASE_URL).replace(/\/+$/, '') : '');
  const key = ovBase ? ovKey : (ovKey || env.AI_API_KEY || '');
  if (!base || !key) {
    return json({ error: '未配置 AI 中转站：服务端未设 AI_BASE_URL/AI_API_KEY，也可在「设置 → AI 解析」里填入你自己的中转站' }, 400);
  }
  const model = ovModel || env.AI_MODEL || 'gpt-4o';

  const raw = Array.isArray(b.questions) ? b.questions : [];
  // 一次最多 8 题：再多提示词会长到影响答案质量，而且单次失败的代价太大
  const qs = raw.filter((q) => q && q.id && String(q.stem || '').trim()).slice(0, 8);
  if (!qs.length) return json({ error: '缺少要补答案的题目' }, 400);

  // 用户在「设置 → AI 解析 → 输出上限」里填的值（bank.js 走 aiOv() 带过来），0 = 用默认
  const ovMax = Math.floor(Number(b.max_tokens) || 0);

  const blocks = qs.map((q, i) => {
    const parts = [`### 第 ${i + 1} 题 (id=${q.id})`];
    parts.push(`题型：${TYPE_CN[q.type] || '简答题'}`);
    if (q.subject) parts.push(`科目：${q.subject}`);
    if (q.passage) parts.push('材料：\n' + String(q.passage).slice(0, 1500));
    // 图片已转存 R2，提示词里把链接摘掉，避免模型以为自己看得到图
    const stem = String(q.stem).slice(0, 3000)
      // 先整块吃掉 <figure>…</figure>，再处理裸的 <img> / markdown 图片。
      // 只替换 <img> 的话，包在外面的 <figure class="fig"> 和 </figure> 会留在提示词里，
      // 模型看到一堆残缺 HTML；而且这段还会原样出现在补答案面板的日志上
      //（实测显示成「…如图 4.18 所示。 <figure class="fig"><」）。
      .replace(/<figure[\s\S]*?<\/figure>/gi, '［此处有插图，未提供］')
      .replace(/<figure[^>]*>/gi, '［此处有插图，未提供］')   // 跨页被截断、没有闭合标签的情况
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '［此处有插图，未提供］')
      .replace(/<img[^>]*>/gi, '［此处有插图，未提供］')
      .replace(/<img\b[\s\S]*$/i, "［此处有插图，未提供］")   // 跨页截断：<img 开了头但没收尾
      .replace(/<\/?(?:figcaption|figure|div|span|p|br)[^>]*>/gi, ' ')   // 残留的结构标签
      .replace(/\s{2,}/g, ' ');
    parts.push('题干：\n' + stem);
    if (Array.isArray(q.options) && q.options.length) {
      parts.push('选项：\n' + q.options.map((o) => `${o.key || ''}. ${String(o.text || '').slice(0, 400)}`).join('\n'));
    }
    return parts.join('\n');
  });

  let resp;
  try {
    resp = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      // 超时保护：这条路是非流式的（await 完整响应再解析 JSON），没有字节在流动，
      // 生成多久整个请求就吊多久。给它一个上限，免得一次卡住把整轮补答案堵死。
      // 用户中断（request.signal）和超时取先到的那个；AbortSignal.any 不可用时退回只认中断。
      signal: (typeof AbortSignal !== 'undefined' && AbortSignal.any && AbortSignal.timeout)
        ? AbortSignal.any([request.signal, AbortSignal.timeout(TIMEOUT_MS)])
        : request.signal,
      body: JSON.stringify({
        model, temperature: 0.1,
        response_format: { type: 'json_object' },
        // 输出上限默认不传，用中转站/模型自己的最大值（和 explain.js 一致）。
        // 这条路是非流式的，检测不了复读，所以「跑飞」只能靠上面的超时兜。
        // 用户在「设置 → AI 解析 → 输出上限」里填了就听他的。
        ...(ovMax > 0 ? { max_tokens: Math.min(200000, Math.max(256, ovMax)) } : {}),
        messages: [
          { role: 'system', content: SYS },
          { role: 'user', content: `请为下面 ${qs.length} 道题补出参考答案：\n\n${blocks.join('\n\n')}` },
        ],
      }),
    });
  } catch (e) {
    // 超时和用户主动取消都表现为 AbortError / TimeoutError，要分开说，
    // 否则用户看到「已取消」会以为是自己点了停止。
    if (e && (e.name === 'TimeoutError' || /timed? ?out/i.test(String(e.message || ''))))
      return json({ error: `AI 中转站超过 ${Math.round(TIMEOUT_MS / 1000)} 秒没有返回，已放弃这一批（可减少每批题数或换更快的模型）` }, 504);
    if (e && e.name === 'AbortError') {
      if (request.signal && request.signal.aborted) return json({ error: '已取消' }, 499);
      return json({ error: `AI 中转站超过 ${Math.round(TIMEOUT_MS / 1000)} 秒没有返回，已放弃这一批` }, 504);
    }
    return json({ error: '调用 AI 中转站失败：' + e.message }, 502);
  }
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    return json({ error: `AI 中转站返回 ${resp.status}`, detail: t.slice(0, 400) }, 502);
  }
  const data = await resp.json().catch(() => null);
  const out = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
  const parsed = safeParseItems(out);
  if (!parsed.length) {
    return json({ error: 'AI 未返回可用的答案（可换更强的模型）', raw: String(out).slice(0, 600) }, 422);
  }

  // 只认输入里存在的 id，防止模型编造或串号
  const byId = new Map(qs.map((q) => [String(q.id), q]));
  const items = [];
  for (const it of parsed) {
    const id = String((it && it.id) || '').trim();
    const src = byId.get(id);
    if (!src) continue;
    const skip = String((it && it.skip) || '').trim().slice(0, 120);
    if (skip) { items.push({ id, answer: [], analysis: '', skip }); continue; }
    const { answer, warn } = normalizeAnswer(src.type, it && it.answer, src.options);
    const analysis = String((it && it.analysis) || '').slice(0, 4000);
    if (!answer.length) { items.push({ id, answer: [], analysis, skip: warn || '未给出答案' }); continue; }
    items.push({ id, answer, analysis, warn: warn || undefined });
  }
  const missing = qs.filter((q) => !items.some((it) => it.id === String(q.id))).map((q) => q.id);
  return json({ ok: true, model, items, missing });
}
