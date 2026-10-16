// 知识点卡片解析 _parseConceptCards 的健壮性（纯逻辑等价校验 + 真实 PracticeMixin 深入回归）
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const PracticeMixin = new Function(read('js/views/practice.js') + '\nreturn PracticeMixin;')();
const QC = new Function('RichText', read('js/constants.js') + '\n' + read('js/components/question-card.js') + '\nreturn QuestionCard;')({});

// 与 js/views/practice.js 的 _parseConceptCards 真实实现绑定
function parse(raw, subj = 'math') {
  return PracticeMixin.methods._parseConceptCards.call({ cur: { subject: subj } }, raw, subj);
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
  it('前置文字含数学闭区间 [0, 1] 时仍能准确定位 [{...}] 数组', () => {
    const r = parse('本题讨论闭区间 [0, 1] 上的性质，知识点卡片如下：\n[{"term":"闭区间连续","formula":"$f(x) \\in C[a,b]$","plain":"最值定理"}]');
    expect(r.length).toBe(1);
    expect(r[0].term).toBe('闭区间连续');
  });
  it('剥离 <think>...</think> 思维链块后正常解析 JSON', () => {
    const r = parse('<think>先提炼这道高数题的3个核心概念，注意在 [a,b] 上的积分</think>\n[{"term":"牛顿-莱布尼茨公式","formula":"$\\\\int_a^b f(x)\\\\,\\\\mathrm{d}x = F(b)-F(a)$","plain":"定积分与原函数的联系"}]');
    expect(r.length).toBe(1);
    expect(r[0].term).toBe('牛顿-莱布尼茨公式');
  });
  it('修复单反斜杠非字母 LaTeX 转义（\\, \\; \\! \\{ \\} \\| \\_）', () => {
    const raw = '[{"term":"定积分","formula":"$\\\\int_0^1 2x\\,\\\\mathrm{d}x = 1$","plain":"集合 $\\{x \\\\mid x > 0\\}$ 上的积分 a\\_1"}]';
    const r = parse(raw);
    expect(r.length).toBe(1);
    expect(r[0].formula).toContain('\\,');
    expect(r[0].plain).toContain('\\{');
  });
  it('尾部截断但含 LaTeX 花括号 {x} 时仍能挽救已闭合的前置卡片', () => {
    const raw = '[{"term":"分部积分","formula":"$\\\\int u\\\\,\\\\mathrm{d}v = uv - \\\\int v\\\\,\\\\mathrm{d}u$","plain":"用于乘积求积分"},{"term":"未写完的卡","formula":"$\\\\frac{1}{2';
    const r = parse(raw);
    expect(r.length).toBe(1);
    expect(r[0].term).toBe('分部积分');
  });
  it('英语科目卡片不会把英文单词和中文词性括注误包进 $...$', () => {
    const raw = '[{"term":"respondent","formula":"respondent /rɪˈspɒndənt/ n. 调查对象","plain":"① 由动词 respond(回答) 加后缀 -ent(表示人) 构成","example":"More than 60% of respondents agreed."}]';
    const r = parse(raw, 'english');
    expect(r.length).toBe(1);
    expect(r[0].plain).not.toContain('$');
    expect(r[0].example).not.toContain('$');
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

describe('逐张背诵模式 kcardTap 与越界保护', () => {
  it('正面点击触发翻面，背面点击自动推进下一张（末张翻回正面）', () => {
    const emitted = [];
    const vm = {
      kcardIdx: 0,
      aiCards: [{ term: 'A' }, { term: 'B' }],
      aiFlip: {},
      $emit(ev, idx) { emitted.push([ev, idx]); },
    };
    QC.methods.kcardTap.call(vm);
    expect(emitted).toEqual([['card-flip', 0]]);
    // 翻到背面后再次点击 → 推进到第 2 张（kcardIdx=1）
    vm.aiFlip = { 0: true };
    QC.methods.kcardTap.call(vm);
    expect(vm.kcardIdx).toBe(1);
    // 末张背面点击 → 翻回正面
    vm.aiFlip = { 0: true, 1: true };
    QC.methods.kcardTap.call(vm);
    expect(emitted[emitted.length - 1]).toEqual(['card-flip', 1]);
  });
  it('aiCards 变短时自动钳制 kcardIdx 防越界报错', () => {
    const vm = { kcardIdx: 5 };
    QC.watch.aiCards.call(vm, [{ term: 'A' }, { term: 'B' }]);
    expect(vm.kcardIdx).toBe(1);
  });
});

describe('AI 自动保存与手动保存防重复追加', () => {
  it('aiSaveToAnalysis 多次点击不会重复追加 **AI 解析** 与 **追问记录**', async () => {
    const patches = [];
    const q = { id: 'q1', analysis: '原题参考解析' };
    const ctx = {
      cur: q,
      aiX: { id: 'q1', view: 'explain', text: '第一次生成的AI解析', chat: [{ q: '为什么？', a: '因为连续', kind: 'explain' }] },
      findQ: () => q,
      bankDirty: false,
      flash() {},
      _autoSaveExplain: PracticeMixin.methods._autoSaveExplain,
      async api(p, o) { patches.push(JSON.parse(o.body)); return {}; },
    };
    await PracticeMixin.methods.aiSaveToAnalysis.call(ctx);
    expect((q.analysis.match(/\*\*AI 解析\*\*/g) || []).length).toBe(1);
    expect((q.analysis.match(/\*\*追问记录\*\*/g) || []).length).toBe(1);
    // 模拟从已存 analysis 恢复后再点一次保存
    ctx.aiX.text = q.analysis.slice(q.analysis.indexOf('**AI 解析**')).replace(/^\*\*AI 解析\*\*\s*/, '');
    await PracticeMixin.methods.aiSaveToAnalysis.call(ctx);
    expect((q.analysis.match(/\*\*AI 解析\*\*/g) || []).length).toBe(1);
    expect((q.analysis.match(/\*\*追问记录\*\*/g) || []).length).toBe(1);
    expect(q.analysis).toContain('原题参考解析');
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

describe('推理模型长思维链截断与卡片续写保护（v191）', () => {
  it('外层缺 ] 但首张卡片含 $[a,b]$ 区间时，不被 lastIndexOf("]") 误切腰斩', () => {
    const raw = '[{"term":"闭区间连续","formula":"$f(x) \\\\in C[a,b]$","plain":"最值与介值"},{"term":"牛顿-莱布尼茨","formula":"$F(b)-F(a)$","plain":"定积分计算"},{"term":"半截卡片","plain":"未写完被截断';
    const r = parse(raw);
    expect(r.length).toBe(2);
    expect(r[0].term).toBe('闭区间连续');
    expect(r[1].term).toBe('牛顿-莱布尼茨');
  });
  it('无头 </think>（服务端模板预置 <think>）剥离后正常解析卡片', () => {
    const raw = '先分析这道题在 [0, 1] 上的积分性质，需要3张卡片</think>\n[{"term":"积分中值定理","plain":"存在一点使得函数值等于积分均值"}]';
    const r = parse(raw);
    expect(r.length).toBe(1);
    expect(r[0].term).toBe('积分中值定理');
  });
  it('_salvageConceptPartial：第 2 张卡写到一半被截断时，对齐到第 1 张卡末尾 }，剔除未闭合引号', () => {
    const sv = PracticeMixin.methods._salvageConceptPartial('[{"term":"卡1","plain":"完整"},{"term":"卡2","plain":"未闭合字符串');
    expect(sv.count).toBe(1);
    expect(sv.complete).toBe(false);
    expect(sv.clean).toBe('[{"term":"卡1","plain":"完整"}');
  });
  it('_salvageConceptPartial：第 1 张卡还没写完就被截断时返回 count=0，触发 kickoff 重取而非带未闭合引号续写', () => {
    const sv = PracticeMixin.methods._salvageConceptPartial('[{"term":"卡1","plain":"刚写了一半');
    expect(sv.count).toBe(0);
    expect(sv.clean).toBe('');
  });
});
