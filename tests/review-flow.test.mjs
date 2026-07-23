// 复习流关键行为（js/views/practice.js、js/views/mock-stats.js 的方法）
// 这两个文件是 Vue mixin 的对象字面量，用 new Function 取出后以 fake this 调用，
// 断言「移出复习」不会误删题库、「错题回顾」建立独立会话。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

function loadMixin(file, name) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return new Function('AUTO', 'OBJECTIVE', 'TYPES', 'SUBJECTS', src + `;return ${name};`)([], [], [], []);
}
const Practice = loadMixin('js/views/practice.js', 'PracticeMixin');
const Mock = loadMixin('js/views/mock-stats.js', 'MockStatsMixin');

describe('掌握率口径 rateQ（按题，非按次）', () => {
  it('做对题数 / 已作答题数；反复答同题不重复累计', () => {
    // right_sum/wrong_sum 是「作答次数」（同题答 5 次记 5），right_q/seen 是「题数」
    expect(Mock.methods.rateQ({ right_q: 1, seen: 2 })).toBe(50);   // 2 道做过、1 道当前做对 → 50%
    expect(Mock.methods.rateQ({ right_q: 0, seen: 0 })).toBe(0);    // 没做过 → 0，不除零
    expect(Mock.methods.rateQ({ right_q: 7, seen: 9 })).toBe(78);
  });
});

describe('删除模考记录（deleteMock）', () => {
  it('确认后 DELETE 并从 stats.mocks 本地移除，不碰题库/进度', async () => {
    global.confirm = () => true;
    const calls = [];
    const ctx = { token: 't', stats: { mocks: [{ id: 5 }, { id: 6 }] }, flash() {},
      async api(url, opt) { calls.push({ url, method: opt && opt.method }); return { ok: true }; } };
    await Mock.methods.deleteMock.call(ctx, { id: 5 });
    const del = calls.find((c) => c.method === 'DELETE');
    expect(del.url).toContain('mock_id=5');
    expect(ctx.stats.mocks.map((m) => m.id)).toEqual([6]);
    expect(calls.some((c) => /\/api\/questions/.test(c.url)), '不应触碰题库').toBe(false);
  });
  it('取消确认 → 不发请求', async () => {
    global.confirm = () => false;
    const calls = [];
    const ctx = { token: 't', stats: { mocks: [{ id: 5 }] }, flash() {}, async api(u, o) { calls.push({ u }); return {}; } };
    await Mock.methods.deleteMock.call(ctx, { id: 5 });
    expect(calls.length).toBe(0);
  });
});

// 记录所有 api 调用的 fake this
function fakeCtx(over = {}) {
  const calls = [];
  return Object.assign({
    calls,
    token: 't',
    async api(url, opt) { calls.push({ url, method: (opt && opt.method) || 'GET', body: opt && opt.body ? JSON.parse(opt.body) : null }); return { ok: true, items: [] }; },
    flash() {},
    subjName: (x) => x,
    fmtTime: () => '',
    loadMeta() {}, startSession() {},
    queue: [], qi: 0, mock: {}, sessionAns: {},
  }, over);
}

describe('移出复习（dropFromReview）', () => {
  it('走 progress master 标记，绝不调用 DELETE /api/questions', async () => {
    const q = { id: 'q1', mastered: false };
    const ctx = fakeCtx({ cur: q, queue: [q, { id: 'q2' }], qi: 0 });
    // cur 是 computed，测试里用 getter 模拟
    Object.defineProperty(ctx, 'cur', { get() { return this.queue[this.qi] || null; }, configurable: true });
    await Practice.methods.dropFromReview.call(ctx);
    const del = ctx.calls.find((c) => c.method === 'DELETE');
    expect(del, '不应发出任何 DELETE 请求').toBeUndefined();
    const master = ctx.calls.find((c) => c.body && c.body.action === 'master' && c.body.value === 1);
    expect(master, '应发出 master=1').toBeTruthy();
    expect(q.mastered).toBe(true);
    expect(ctx.queue.length).toBe(1);   // 从当前队列移除
  });

  it('移出后会后台刷新 stats（顶栏徽标即时同步，不停在旧值）', async () => {
    const q = { id: 'a' };
    let refetched = false;
    const ctx = fakeCtx({ queue: [q, { id: 'b' }], qi: 0, reviewSession: null, sessionAns: {},
      async api(url, opt) { this.calls.push({ url, method: (opt && opt.method) || 'GET' });
        if (url === '/api/progress' && (!opt || !opt.method)) { refetched = true; return { bySubject: [] }; }
        return { ok: true }; } });
    Object.defineProperty(ctx, 'cur', { get() { return this.queue[this.qi] || null; }, configurable: true });
    await Practice.methods.dropFromReview.call(ctx);
    expect(refetched, '应在移出后 GET /api/progress 刷新统计').toBe(true);
  });
});

describe('错题回顾会话是封闭集（next 到末题不续拉普通题）', () => {
  it('会话内末题点 next → 结束会话，不调用 startSession', () => {
    let started = false, exited = false;
    const ctx = { qi: 0, queue: [{ id: 'a' }], reviewSession: { count: 1 }, flash() {},
      startSession() { started = true; }, exitReviewSession() { exited = true; } };
    Practice.methods.next.call(ctx);
    expect(started).toBe(false);
    expect(exited).toBe(true);
  });
  it('常规 wrong 末题点 next → 照常换一批（startSession）', () => {
    let started = false;
    const ctx = { qi: 0, queue: [{ id: 'a' }], reviewSession: null, flash() {},
      startSession() { started = true; }, exitReviewSession() {} };
    Practice.methods.next.call(ctx);
    expect(started).toBe(true);
  });
  it('非末题点 next → 只前进不触发任何会话逻辑', () => {
    let started = false, exited = false;
    const ctx = { qi: 0, queue: [{ id: 'a' }, { id: 'b' }], reviewSession: { count: 2 },
      startSession() { started = true; }, exitReviewSession() { exited = true; } };
    Practice.methods.next.call(ctx);
    expect(ctx.qi).toBe(1);
    expect(started).toBe(false);
    expect(exited).toBe(false);
  });
});

describe('删除本题（deleteCurrentQuestion）确属物理删除，措辞已警示', () => {
  it('确认后调用 DELETE /api/questions', async () => {
    const q = { id: 'q1' };
    const ctx = fakeCtx({ cur: q, queue: [q], qi: 0 });
    global.confirm = () => true;
    await Practice.methods.deleteCurrentQuestion.call(ctx);
    expect(ctx.calls.some((c) => c.method === 'DELETE' && c.url.startsWith('/api/questions'))).toBe(true);
  });
  it('用户取消确认则什么都不做', async () => {
    const q = { id: 'q1' };
    const ctx = fakeCtx({ cur: q, queue: [q], qi: 0 });
    global.confirm = () => false;
    await Practice.methods.deleteCurrentQuestion.call(ctx);
    expect(ctx.calls.length).toBe(0);
  });
});

describe('错题回顾（reviewMock）建立独立会话', () => {
  it('拉错题 → 进 wrong 视图 + 设 reviewSession + 锁筛选', async () => {
    const wrongIds = ['a', 'b', 'c'];
    const ctx = fakeCtx({
      view: 'stats', reviewSession: null, filterLock: false,
      async api(url) {
        this.calls.push({ url });
        if (url.includes('/api/progress?mock_id=')) return { items: wrongIds.map((id) => ({ question_id: id, is_correct: 0 })) };
        if (url.includes('/api/questions?ids=')) return { items: wrongIds.map((id) => ({ id })) };
        return {};
      },
    });
    await Mock.methods.reviewMock.call(ctx, { id: 5, subject: 'politics', taken_at: 1700000000 });
    expect(ctx.view).toBe('wrong');
    expect(ctx.sessionView).toBe('wrong');
    expect(ctx.reviewSession).toBeTruthy();
    expect(ctx.reviewSession.count).toBe(3);
    expect(ctx.filterLock).toBe(true);
    expect(ctx.queue.length).toBe(3);
  });

  it('只取 is_correct<1 的题（半分 0.5 也算错题回顾范围）', async () => {
    let idsParam = '';
    const ctx = fakeCtx({
      view: 'stats',
      async api(url) {
        if (url.includes('mock_id=')) return { items: [
          { question_id: 'a', is_correct: 0 }, { question_id: 'b', is_correct: 0.5 },
          { question_id: 'c', is_correct: 1 }, { question_id: 'd', is_correct: null },
        ] };
        if (url.includes('ids=')) { idsParam = decodeURIComponent(url.split('ids=')[1].split('&')[0]); return { items: [{ id: 'a' }, { id: 'b' }] }; }
        return {};
      },
    });
    await Mock.methods.reviewMock.call(ctx, { id: 1, subject: 'math', taken_at: 0 });
    expect(idsParam.split(',').sort()).toEqual(['a', 'b']);   // 0 与 0.5 入选，1 与 null 排除
  });
});

describe('错题页复习范围 reviewScope → qs 的 mode/order', () => {
  const qs = (ctx) => new URLSearchParams(Practice.methods.qs.call(ctx, {}));
  const base = { f: { subject: 'all', chapter: '', type: '', tag: '', order: 'random' } };
  it('今日到期(due)：mode=due，order=due（最早到期优先）', () => {
    const p = qs({ ...base, sessionMode: 'due' });
    expect(p.get('mode')).toBe('due');
    expect(p.get('order')).toBe('due');
  });
  it('全部错题(wrong)：mode=wrong，order=weak（最不熟优先）', () => {
    const p = qs({ ...base, sessionMode: 'wrong' });
    expect(p.get('mode')).toBe('wrong');
    expect(p.get('order')).toBe('weak');
  });
  it('普通练习：order 用用户所选（random）', () => {
    const p = qs({ ...base, sessionMode: 'all' });
    expect(p.get('mode')).toBe('all');
    expect(p.get('order')).toBe('random');
  });
});
