// 两个线上现象，同一个根因：max_tokens 用完了没有续写机制。
//
//  ① 推理模型（deepseek-v4-flash）把整个预算花在 reasoning_content 上，正文一个字都没吐，
//     finish_reason=length。旧代码走到 `if(!st.text) throw '模型没有返回内容，可换个模型再试'`，
//     报错中断，连用户刚看完的一大段思维链一起丢掉。换模型也解决不了——问题不在模型坏，
//     在于它需要更多预算才能写到正文。
//  ② 正文写到一半被截断，只提示「可追问请继续」，要用户手动打字。
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const Practice = new Function(read('js/views/practice.js') + ';return PracticeMixin;')();

// 每次 aiFetch 按脚本吐一段流；记录收到的 body 便于断言续写参数
const makeCtx = (script) => {
  const bodies = [];
  const st = { text: '', chat: [], model: '', cards: [] };
  const ctx = {
    bodies, flashes: [],
    cur: { id: 'q1', stem: '求公共部分面积', options: [], answer: [], type: 'short_answer', subject: 'math' },
    aiX: { id: 'q1', view: 'explain', text: '', reasoning: '', cards: [], chat: [], busy: false, reasonOpen: true, flip: {} },
    aiStates: { q1: st },
    _aiJobs: {}, explainCfg: {}, autoSaveAi: false,
    flash(m) { this.flashes.push(String(m)); },
    go() {}, token: 't',
    async aiFetch(body, signal, onDelta) {
      bodies.push(body);
      const step = script[bodies.length - 1];
      if (!step) return { ok: true, res: { status: 200 }, text: '' };
      let acc = '';
      for (const r of (step.reasoning || [])) onDelta({ reasoning: r });
      for (const t of (step.text || [])) { acc += t; onDelta({ text: t, acc }); }
      if (step.finish) onDelta({ finish_reason: step.finish });
      return { ok: true, res: { status: 200 }, text: acc };
    },
    _parseConceptCards: () => [],
    _autoSaveExplain: async () => {}, _autoSaveConcept: async () => {},
  };
  return ctx;
};
const run = (ctx) => Practice.methods.aiExplain.call(ctx, 'explain', true);

beforeEach(() => { global.AbortController = AbortController; });

describe('情况①：推理占满预算，正文为空', () => {
  it('不再报「模型没有返回内容」，而是自动再要一轮正文', async () => {
    const c = makeCtx([
      { reasoning: ['先设极坐标…', '再比较两个圆…'], finish: 'length' },   // 全是思维链，正文空
      { text: ['公共部分面积为 ', '(3π/4 - 1/2)a²。'], finish: 'stop' },
    ]);
    await run(c);
    expect(c.aiStates.q1.text).toContain('公共部分面积为');
    expect(c.flashes.join(' ')).not.toContain('没有返回内容');
  });
  it('第二轮请求带 continue_kickoff，让模型跳过再思考', async () => {
    const c = makeCtx([
      { reasoning: ['想很久'], finish: 'length' },
      { text: ['结论'], finish: 'stop' },
    ]);
    await run(c);
    expect(c.bodies).toHaveLength(2);
    expect(c.bodies[1].continue_kickoff).toBe(1);
    expect(c.bodies[1].continue_from).toBeUndefined();
  });
  // 文案刻意保持中性：正文为空 + finish_reason=length 只能说明撞了某个输出上限，
  // 至于是 reasoning 吃掉了 completion 额度、还是中转站截流，没有 usage 数据无法断言。
  // 早先写的是「推理占满了 token 预算」，那是推测冒充结论。
  it('提示只陈述可观测事实，不断言原因', async () => {
    const c = makeCtx([
      { reasoning: ['想'], finish: 'length' },
      { text: ['答'], finish: 'stop' },
    ]);
    await run(c);
    const msg = c.flashes.join(' ');
    expect(msg).toMatch(/正文为空/);
    expect(msg).toMatch(/输出上限/);
    expect(msg).not.toMatch(/推理占满/);
  });
  it('思维链保住了，不会跟着报错一起丢', async () => {
    const c = makeCtx([
      { reasoning: ['关键的推导过程'], finish: 'length' },
      { text: ['答'], finish: 'stop' },
    ]);
    await run(c);
    expect(c.aiX.reasoning).toContain('关键的推导过程');
  });
  it('续满 3 轮仍然没有正文才算失败，且提示换非推理模型', async () => {
    const c = makeCtx(Array.from({ length: 6 }, () => ({ reasoning: ['还在想'], finish: 'length' })));
    await run(c);
    const msg = c.flashes.join(' ');
    expect(msg).toMatch(/只有推理、没有正文/);
    expect(msg).toMatch(/非推理模型/);
  });
});

describe('情况②：正文写一半被截断', () => {
  it('自动续写并把两段接起来', async () => {
    const c = makeCtx([
      { text: ['第一步：设 ', 'ρ ≤ a sinθ，'], finish: 'length' },
      { text: ['第二步：积分得到结果。'], finish: 'stop' },
    ]);
    await run(c);
    expect(c.aiStates.q1.text).toBe('第一步：设 ρ ≤ a sinθ，第二步：积分得到结果。');
  });
  it('续写请求带 continue_from（已写部分），不是重新开头', async () => {
    const c = makeCtx([
      { text: ['已经写好的前半段'], finish: 'length' },
      { text: ['后半段'], finish: 'stop' },
    ]);
    await run(c);
    expect(c.bodies[1].continue_from).toBe('已经写好的前半段');
    expect(c.bodies[1].continue_kickoff).toBeUndefined();
  });
  it('不再让用户手动追问「请继续」', async () => {
    const c = makeCtx([
      { text: ['半截'], finish: 'length' },
      { text: ['补完'], finish: 'stop' },
    ]);
    await run(c);
    expect(c.flashes.join(' ')).not.toContain('请继续');
    expect(c.flashes.some((f) => /自动续写/.test(f))).toBe(true);
  });
  it('连续截断最多续 3 轮，不会无限烧额度', async () => {
    const c = makeCtx(Array.from({ length: 8 }, (_, i) => ({ text: ['段' + i], finish: 'length' })));
    await run(c);
    expect(c.bodies.length).toBe(4);            // 首轮 + 3 次续写
  });
  it('一轮就写完时不会多发请求', async () => {
    const c = makeCtx([{ text: ['一次写完'], finish: 'stop' }]);
    await run(c);
    expect(c.bodies).toHaveLength(1);
    expect(c.flashes.some((f) => /续写/.test(f))).toBe(false);
  });
});

describe('服务端续写入口', () => {
  const src = read('functions/api/explain.js');
  it('continue_from 回填成 assistant 轮，并要求不要重复', () => {
    expect(src).toContain("b.continue_from");
    expect(src).toContain('不要重复已经写过的部分');
  });
  it('continue_kickoff 让模型跳过再思考直接给正文', () => {
    expect(src).toContain('b.continue_kickoff');
    expect(src).toContain('不要再展开思考过程了');
  });
  it('追问路径也能续写（不能被 !ask 挡住）', () => {
    const askBlock = src.slice(src.indexOf('if (ask) {'));
    expect(askBlock).toContain('contFrom');
  });
  it('续写轮的预算不能太小，否则要续很多次', () => {
    expect(src).toMatch(/continue_kickoff\) \? 6000 : 8192/);
  });
  it('continue_from 有长度上限，避免把整篇塞回去', () => {
    expect(src).toContain("slice(-6000)");
  });
});

describe('追问也自动续写', () => {
  const src = read('js/views/practice.js');
  it('截断后接着写，不再提示「可追问请继续」', () => {
    expect(src).toContain('askTruncated');
    expect(src).not.toContain('可追问「请继续」');
  });
  it('续写时把已写部分作为前缀累加，不覆盖', () => {
    expect(src).toContain('entry.a=base+d.acc;');
  });
  it('追问续写上限 2 轮', () => {
    expect(src).toContain('ASK_MAX_CONT=2');
  });
  it('用户中断时立刻停止续写', () => {
    expect(src).toContain('!ctrl.signal.aborted');
  });
});
