// AI 补答案的过程面板。
// 改造前只有一个「6 / 50」的计数：跑完既不知道哪些题被跳过，也不知道为什么 ——
// 而后端每条本来就带 skip 原因和 warn（answerfill.js 里 items.push({id,answer,analysis,skip/warn})），
// 前端把它们全丢了。现在逐题记进 log，面板实时显示。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const Bank = new Function(read('js/views/bank.js') + ';return BankMixin;')();

const makeCtx = (items, reply, patchReply) => {
  const calls = [];
  return {
    calls,
    token: 't', offline: false,
    bank: { items, sel: [] },
    bankAiFill: { busy: false, prog: '', log: [] },
    bankDirty: false, statsDirty: false,
    aiOv: () => ({}),
    flash(m) { this.flashes.push(m); },
    flashes: [],
    async api(p, o) {
      const body = JSON.parse((o && o.body) || '{}');
      calls.push({ p, body });
      if (p === '/api/answerfill') return reply(body);
      if (p.startsWith('/api/questions')) return patchReply ? patchReply(body) : { ok: true };
      return { ok: true };
    },
  };
};
const run = (ctx) => Bank.methods.bankAiFillAnswers.call(ctx);
const qs = (n) => Array.from({ length: n }, (_, i) => ({ id: 'q' + i, type: 'single_choice', stem: '第' + (i + 1) + '题：以下说法正确的是（）。', answer: [] }));

beforeEach(() => { global.confirm = () => true; });

describe('逐题记录结果', () => {
  it('成功的记下答案', async () => {
    const c = makeCtx(qs(2), (b) => ({ items: b.questions.map((q) => ({ id: q.id, answer: ['A', 'C'], analysis: 'x' })) }));
    await run(c);
    expect(c.bankAiFill.log).toHaveLength(2);
    expect(c.bankAiFill.log[0].state).toBe('ok');
    expect(c.bankAiFill.log[0].text).toBe('A、C');
  });
  it('跳过的要带上后端给的原因，不能只说「跳过」', async () => {
    const c = makeCtx(qs(1), (b) => ({ items: b.questions.map((q) => ({ id: q.id, answer: [], skip: '题干依赖插图，无法作答' })) }));
    await run(c);
    expect(c.bankAiFill.log[0].state).toBe('skip');
    expect(c.bankAiFill.log[0].text).toBe('题干依赖插图，无法作答');
  });
  it('后端没给原因时有兜底文案', async () => {
    const c = makeCtx(qs(1), (b) => ({ items: b.questions.map((q) => ({ id: q.id, answer: [] })) }));
    await run(c);
    expect(c.bankAiFill.log[0].text).toBe('未给出答案');
  });
  it('AI 把握不大（warn）单独标出来，不混在成功里', async () => {
    const c = makeCtx(qs(1), (b) => ({ items: b.questions.map((q) => ({ id: q.id, answer: ['B'], warn: '把握不大' })) }));
    await run(c);
    expect(c.bankAiFill.log[0].state).toBe('warn');
    expect(c.bankAiFill.log[0].text).toContain('把握不大');
    expect(c.bankAiFill.filled).toBe(1);          // 仍然算补上了
  });
  it('AI 整个漏掉的题记为跳过', async () => {
    const c = makeCtx(qs(2), (b) => ({ items: [{ id: b.questions[0].id, answer: ['A'] }], missing: [b.questions[1].id] }));
    await run(c);
    expect(c.bankAiFill.log.some((r) => r.state === 'skip' && /没有返回/.test(r.text))).toBe(true);
  });
  it('请求整块失败时每道题都留痕，不是静默丢掉', async () => {
    // 用不可重试的错误，避免真的等满退避（限流重试另有用例覆盖）
    const c = makeCtx(qs(3), () => { throw new Error('400 参数错误'); });
    await run(c);
    expect(c.bankAiFill.log).toHaveLength(3);
    expect(c.bankAiFill.log.every((r) => r.state === 'fail')).toBe(true);
    expect(c.bankAiFill.log[0].text).toContain('400');
  });

  it('限流（429）自动退避重试，救回本来会失败的那批', async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const c = makeCtx(qs(2), (b) => {
        if (++n === 1) throw new Error('AI 中转站返回 429');
        return { items: b.questions.map((q) => ({ id: q.id, answer: ['A'] })) };
      });
      const p = run(c);
      await vi.runAllTimersAsync();
      await p;
      expect(n).toBe(2);
      expect(c.bankAiFill.filled).toBe(2);
      expect(c.bankAiFill.failed).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('不可重试的错误不浪费退避时间', async () => {
    let n = 0;
    const c = makeCtx(qs(2), () => { n++; throw new Error('400 参数错误'); });
    await run(c);
    expect(n).toBe(1);
  });

  it('最多重试 3 次就放弃，不会无限重试', async () => {
    vi.useFakeTimers();
    try {
      let n = 0;
      const c = makeCtx(qs(2), () => { n++; throw new Error('429 too many requests'); });
      const p = run(c);
      await vi.runAllTimersAsync();
      await p;
      expect(n).toBe(3);
      expect(c.bankAiFill.failed).toBe(2);
    } finally { vi.useRealTimers(); }
  });
  it('写库失败也逐题留痕', async () => {
    const c = makeCtx(qs(2), (b) => ({ items: b.questions.map((q) => ({ id: q.id, answer: ['A'] })) }),
      () => { throw new Error('D1 超时'); });
    await run(c);
    expect(c.bankAiFill.log.every((r) => r.state === 'fail')).toBe(true);
    expect(c.bankAiFill.log[0].text).toContain('D1 超时');
  });
  it('题目已被删掉的记为失败而不是成功', async () => {
    const c = makeCtx(qs(2), (b) => ({ items: b.questions.map((q) => ({ id: q.id, answer: ['A'] })) }),
      (b) => ({ ok: true, missing: [b.items[0].id] }));
    await run(c);
    expect(c.bankAiFill.failed).toBe(1);
    expect(c.bankAiFill.log.some((r) => r.state === 'fail' && /已不存在/.test(r.text))).toBe(true);
  });
  it('最新的在最上面（面板从上往下读）', async () => {
    const c = makeCtx(qs(3), (b) => ({ items: b.questions.map((q) => ({ id: q.id, answer: [q.id] })) }));
    await run(c);
    expect(c.bankAiFill.log[0].text).toBe('q2');
    expect(c.bankAiFill.log[2].text).toBe('q0');
  });
  it('题干截断到 60 字并压掉换行，面板一行放得下', async () => {
    const long = [{ id: 'x', type: 'short_answer', stem: '甲\n乙'.repeat(80), answer: [] }];
    const c = makeCtx(long, (b) => ({ items: b.questions.map((q) => ({ id: q.id, answer: ['A'] })) }));
    await run(c);
    expect(c.bankAiFill.log[0].stem.length).toBeLessThanOrEqual(60);
    expect(c.bankAiFill.log[0].stem).not.toContain('\n');
  });
});

describe('进度不能超出总数', () => {
  it('服务端在多个分块里重复报同一个 missing 也不会出现「16 / 14」', async () => {
    // 这是模拟时实测到的：done 单独自增会和总数对不上，所以改成由三个计数推导
    const c = makeCtx(qs(14), (b) => ({ items: b.questions.map((q) => ({ id: q.id, answer: ['A'] })), missing: ['ghost'] }));
    await run(c);
    const f = c.bankAiFill;
    expect(f.filled + f.skipped + f.failed).toBeGreaterThan(0);
    expect(f.log.length).toBe(f.filled + f.skipped + f.failed);
  });
  it('不再维护独立的 done 字段（避免和计数打架）', () => {
    expect(read('js/views/bank.js')).not.toContain('bankAiFill.done++');
  });
});

describe('面板本身', () => {
  const tpl = read('js/tpl/view-bank.js');
  it('生成中和跑完都显示，可手动关闭', () => {
    expect(tpl).toContain('bankAiFill.panel && (bankAiFill.busy || bankAiFill.log.length)');
    expect(tpl).toContain('bankAiFillClose');
  });
  it('进度条宽度钳到 100%', () => {
    expect(tpl).toContain('Math.min(100,');
  });
  it('分类计数用不同颜色的标签', () => {
    for (const k of ['fill-tag ok', 'fill-tag skip', 'fill-tag fail']) expect(tpl).toContain(k);
  });
  it('长列表截断显示，不把几百条全渲染出来', () => {
    expect(tpl).toContain('bankAiFill.log.slice(0,60)');
    expect(tpl).toContain('另有');
  });
  it('跑完提示要复核', () => {
    expect(tpl).toContain('待审');
  });
  it('关闭按钮只在跑完后出现', () => {
    expect(tpl).toContain('v-if="!bankAiFill.busy" @click="bankAiFillClose"');
  });
  it('样式里四种状态各有颜色', () => {
    const css = read('css/style.css');
    for (const k of ['.fill-row.ok', '.fill-row.warn', '.fill-row.fail', '.fill-row.skip']) expect(css).toContain(k);
  });
});

describe('选中态的视觉引导', () => {
  const tpl = read('js/tpl/view-bank.js');
  const css = read('css/style.css');
  it('「取消选择」不再是一颗和别人一样的 subtle 按钮', () => {
    expect(tpl).toContain('class="btn sel-clear"');
    expect(tpl).toContain('取消选择');
    expect(css).toContain('.btn.sel-clear');
  });
  it('已选数量选中时高亮成实心标签', () => {
    expect(tpl).toContain('class="sel-count" :class="{on:bank.sel.length}"');
    expect(css).toContain('.sel-count.on{background:var(--accent)');
  });
  it('整条工具栏在有选中时带强调边', () => {
    expect(tpl).toContain(":class=\"{'has-sel':bank.sel.length}\"");
    expect(css).toContain('.bank-toolbar.has-sel');
  });
});

describe('面板位置', () => {
  const tpl = read('js/tpl/view-bank.js');
  it('面板在工具栏之外，不会把「智能归类/刷新/查重」挤到自己里面', () => {
    const tb = tpl.indexOf('bankDupScan');
    const panel = tpl.indexOf('class="fill-panel"');
    expect(tb).toBeGreaterThan(0);
    expect(panel).toBeGreaterThan(tb);        // 查重按钮在前，面板在后
  });
  it('移动端把进度条换行、日志允许折行', () => {
    const css = read('css/style.css');
    expect(css).toContain('.fill-bar{order:5;flex-basis:100%');
    expect(css).toContain('.fill-stem{flex-basis:100%;white-space:normal');
  });
});
