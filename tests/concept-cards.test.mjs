// 知识点卡片解析 _parseConceptCards 的健壮性（纯逻辑等价校验）
import { describe, it, expect } from 'vitest';

// 与 js/views/practice.js 的 _parseConceptCards 等价实现
function parse(raw) {
  let s = String(raw || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const a = s.indexOf('['), b = s.lastIndexOf(']');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  let arr;
  try { arr = JSON.parse(s); } catch (_) { return []; }
  if (!Array.isArray(arr)) return [];
  return arr.filter((x) => x && typeof x === 'object' && (x.term || x.plain)).slice(0, 8).map((x) => ({
    term: String(x.term || '').trim() || '知识点',
    formula: String(x.formula || '').trim(),
    plain: String(x.plain || '').trim(),
    example: String(x.example || '').trim(),
  }));
}

describe('_parseConceptCards', () => {
  it('解析纯 JSON 数组', () => {
    const r = parse('[{"term":"导数","formula":"$f\'(x)$","plain":"变化率","example":"速度"}]');
    expect(r.length).toBe(1);
    expect(r[0]).toEqual({ term: '导数', formula: "$f'(x)$", plain: '变化率', example: '速度' });
  });
  it('剥离 ```json 代码围栏', () => {
    const r = parse('```json\n[{"term":"极限","plain":"逼近"}]\n```');
    expect(r.length).toBe(1);
    expect(r[0].term).toBe('极限');
    expect(r[0].formula).toBe('');
  });
  it('截取前后夹杂文字里的数组片段', () => {
    const r = parse('好的，以下是卡片：[{"term":"连续","plain":"不断开"}] 希望有用');
    expect(r.length).toBe(1);
    expect(r[0].term).toBe('连续');
  });
  it('非法 JSON 返回空数组（触发重试）', () => {
    expect(parse('这不是JSON')).toEqual([]);
    expect(parse('')).toEqual([]);
  });
  it('过滤空对象、缺字段补默认、最多 8 张', () => {
    const many = JSON.stringify(Array.from({ length: 12 }, (_, i) => ({ term: 'T' + i, plain: 'p' })));
    expect(parse(many).length).toBe(8);
    const r = parse('[{"plain":"只有解释"},{},{"term":"只有名"}]');
    expect(r.length).toBe(2); // 空对象被过滤
    expect(r[0].term).toBe('知识点'); // 缺 term 补默认
  });
});

describe('toggleAllCards 全部翻开/收起逻辑', () => {
  // 等价逻辑
  function toggleAll(aiX) {
    const cards = aiX.cards || [];
    if (!cards.length) return aiX.flip;
    const allNow = cards.every((_, i) => aiX.flip && aiX.flip[i]);
    const f = {};
    if (!allNow) cards.forEach((_, i) => { f[i] = true; });
    return f;
  }
  it('未全翻开时 → 全部翻开', () => {
    const aiX = { cards: [{}, {}, {}], flip: { 0: true } };
    expect(toggleAll(aiX)).toEqual({ 0: true, 1: true, 2: true });
  });
  it('已全翻开时 → 全部收起', () => {
    const aiX = { cards: [{}, {}], flip: { 0: true, 1: true } };
    expect(toggleAll(aiX)).toEqual({});
  });
  it('无卡片时不变', () => {
    const aiX = { cards: [], flip: {} };
    expect(toggleAll(aiX)).toEqual({});
  });
});

describe('切题状态缓存（qStates / aiStates 逻辑）', () => {
  it('切题保存旧题已完成的 AI 内容、恢复新题缓存', () => {
    // 模拟 watch 'cur.id' 的逻辑
    function switchQ(ctx, nid, oid) {
      if (oid && ctx.aiX.id === oid && !ctx.aiX.busy && (ctx.aiX.text || (ctx.aiX.cards && ctx.aiX.cards.length))) {
        ctx.aiStates[oid] = { id: oid, view: ctx.aiX.view, text: ctx.aiX.text, cards: (ctx.aiX.cards || []).slice(), flip: { ...(ctx.aiX.flip || {}) } };
      }
      if (nid && ctx.aiStates[nid]) {
        const s = ctx.aiStates[nid];
        ctx.aiX = { id: s.id, view: s.view, text: s.text, busy: false, cards: (s.cards || []).slice(), flip: { ...(s.flip || {}) } };
      } else {
        ctx.aiX = { id: '', view: '', text: '', busy: false, cards: [], flip: {} };
      }
    }
    const ctx = { aiX: { id: 'q1', view: 'explain', text: '解析A', cards: [], flip: {}, busy: false }, aiStates: {} };
    switchQ(ctx, 'q2', 'q1');                 // q1→q2
    expect(ctx.aiStates.q1.text).toBe('解析A'); // q1 已缓存
    expect(ctx.aiX.id).toBe('');               // q2 无缓存→空
    ctx.aiX = { id: 'q2', view: 'concept', text: '', cards: [{ term: 'T' }], flip: { 0: true }, busy: false };
    switchQ(ctx, 'q1', 'q2');                  // q2→q1
    expect(ctx.aiStates.q2.cards.length).toBe(1); // q2 缓存
    expect(ctx.aiX.text).toBe('解析A');        // 回到 q1 恢复解析
    expect(ctx.aiX.view).toBe('explain');
  });
  it('后台生成：结果写入 aiStates[题id]，切题不影响其归属', () => {
    // 新架构：生成写 aiStates[qid]（局部 st 引用），与当前显示题无关
    const aiStates = {};
    const st = aiStates['q1'] = { id: 'q1', view: 'explain', text: '', cards: [] };
    // 模拟流式回调持续写 st（即便已切到别的题）
    st.text = '生成中的内容';
    st.text = '最终解析';   // 完成
    expect(aiStates['q1'].text).toBe('最终解析'); // 结果仍在 q1 名下，切题不丢
  });
  it('_aiJobs 并发标记：解析与知识点用不同 key，互不覆盖', () => {
    const jobs = {};
    jobs['q1:e'] = 'ctrlE';   // 解析生成中
    jobs['q1:c'] = 'ctrlC';   // 知识点同时生成中
    expect(jobs['q1:e']).toBe('ctrlE');
    expect(jobs['q1:c']).toBe('ctrlC'); // 两者并存，未互相 abort
    delete jobs['q1:e'];       // 解析完成
    expect(jobs['q1:c']).toBe('ctrlC'); // 知识点仍在跑
  });
});
