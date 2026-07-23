// 会话持久化 persistSession/restoreSession 核心逻辑
import { describe, it, expect, beforeEach } from 'vitest';

// 内存版 localStorage
let store = {};
global.localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
};

// persistSession 的等价逻辑
function persist(ctx) {
  if (!['practice', 'wrong', 'favorite'].includes(ctx.view) || !ctx.queue.length) return;
  const snap = { v: ctx.view, sv: ctx.sessionView, q: ctx.queue, i: ctx.qi, t: ctx.queueTotal, a: ctx.sessionAns, bo: ctx.batchDone, lo: ctx.loadedOnce, rs: ctx.reviewSession, qs: ctx.qStates, ai: ctx.aiStates, ts: Date.now() };
  let s = JSON.stringify(snap);
  if (s.length > 4_000_000) { s = JSON.stringify({ ...snap, ai: {} }); }
  if (s.length > 4_500_000) return;
  localStorage.setItem('zb_session', s);
}
function restore(ctx) {
  const raw = localStorage.getItem('zb_session'); if (!raw) return false;
  const snap = JSON.parse(raw); if (!snap || !Array.isArray(snap.q) || !snap.q.length) return false;
  if (snap.ts && Date.now() - snap.ts > 12 * 3600 * 1000) { localStorage.removeItem('zb_session'); return false; }
  if (!['practice', 'wrong', 'favorite'].includes(snap.v)) return false;
  ctx.queue = snap.q; ctx.qi = snap.i || 0; ctx.aiStates = snap.ai || {}; ctx.sessionAns = snap.a || {}; ctx.view = snap.v;
  return true;
}

describe('会话持久化', () => {
  beforeEach(() => { store = {}; });
  it('存了队列+进度+AI内容，能完整恢复', () => {
    const ctx = { view: 'practice', sessionView: 'practice', queue: [{ id: 'q1' }, { id: 'q2' }], qi: 1, queueTotal: 2, sessionAns: { q1: true }, batchDone: false, loadedOnce: true, reviewSession: null, qStates: {}, aiStates: { q1: { text: '解析' } } };
    persist(ctx);
    const ctx2 = {};
    expect(restore(ctx2)).toBe(true);
    expect(ctx2.queue.length).toBe(2);
    expect(ctx2.qi).toBe(1);
    expect(ctx2.sessionAns.q1).toBe(true);
    expect(ctx2.aiStates.q1.text).toBe('解析');
    expect(ctx2.view).toBe('practice');
  });
  it('空队列不持久化', () => {
    persist({ view: 'practice', queue: [] });
    expect(localStorage.getItem('zb_session')).toBeNull();
  });
  it('非做题视图不持久化', () => {
    persist({ view: 'settings', queue: [{ id: 'x' }] });
    expect(localStorage.getItem('zb_session')).toBeNull();
  });
  it('12小时前的旧会话不恢复且清除', () => {
    store['zb_session'] = JSON.stringify({ v: 'practice', q: [{ id: 'q1' }], ts: Date.now() - 13 * 3600 * 1000 });
    expect(restore({})).toBe(false);
    expect(localStorage.getItem('zb_session')).toBeNull();
  });
  it('无快照时恢复返回 false', () => {
    expect(restore({})).toBe(false);
  });
});
