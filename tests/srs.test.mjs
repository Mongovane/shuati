// SRS 间隔重复（functions/api/progress.js 的 nextSrs）
import { describe, it, expect } from 'vitest';
import { nextSrs } from '../functions/api/progress.js';

const now = () => Math.floor(Date.now() / 1000);

describe('nextSrs 间隔演进', () => {
  it('新题答对：1 天后到期，ease 2.5 → 2.55', () => {
    const r = nextSrs(null, true);
    expect(r.interval).toBe(1);
    expect(r.ease).toBe(2.55);
    expect(Math.abs(r.dueAt - (now() + 86400))).toBeLessThanOrEqual(5);
  });
  it('连续答对：间隔 1 → 3 → 3×ease', () => {
    let cur = null;
    let r = nextSrs(cur, true);
    expect(r.interval).toBe(1);
    cur = { interval_days: r.interval, ease: r.ease };
    r = nextSrs(cur, true);
    expect(r.interval).toBe(3);
    expect(r.ease).toBe(2.6);
    cur = { interval_days: r.interval, ease: r.ease };
    r = nextSrs(cur, true);
    expect(r.interval).toBeCloseTo(7.8, 6);   // 3 × 2.60
    expect(r.ease).toBe(2.65);
  });
  it('答错：间隔清零、约 10 分钟后回炉、ease 降 0.2', () => {
    const r = nextSrs({ interval_days: 30, ease: 2.5 }, false);
    expect(r.interval).toBe(0);
    expect(r.ease).toBe(2.3);
    expect(Math.abs(r.dueAt - (now() + 600))).toBeLessThanOrEqual(5);
  });
  it('ease 下限 1.3、上限 3.0', () => {
    expect(nextSrs({ interval_days: 0, ease: 1.35 }, false).ease).toBe(1.3);
    expect(nextSrs({ interval_days: 0, ease: 1.3 }, false).ease).toBe(1.3);
    const up = nextSrs({ interval_days: 10, ease: 3.0 }, true);
    expect(up.ease).toBe(3.0);
    expect(up.interval).toBe(30);   // 10 × 3.0，未触顶
  });
  it('间隔封顶 365 天', () => {
    expect(nextSrs({ interval_days: 200, ease: 2.5 }, true).interval).toBe(365);
  });
  it('hard：小步前进（×1.2 且至少 +1 天），ease −0.05', () => {
    const r = nextSrs({ interval_days: 10, ease: 2.5 }, true, 'hard');
    expect(r.interval).toBe(12);
    expect(r.ease).toBe(2.45);
    expect(nextSrs({ interval_days: 1, ease: 2.5 }, true, 'hard').interval).toBe(2);   // max(1+1, 1.2)
    expect(nextSrs(null, true, 'hard').interval).toBe(1);
  });
  it('easy：新题 2 天起步 → 5 → ×ease×1.3，ease +0.1（封顶 3.0）', () => {
    expect(nextSrs(null, true, 'easy').interval).toBe(2);
    expect(nextSrs({ interval_days: 2, ease: 2.5 }, true, 'easy').interval).toBe(5);
    const r = nextSrs({ interval_days: 10, ease: 2.5 }, true, 'easy');
    expect(r.interval).toBeCloseTo(32.5, 6);
    expect(r.ease).toBe(2.6);
    expect(nextSrs({ interval_days: 1, ease: 3.0 }, true, 'easy').ease).toBe(3.0);
  });
  it('不传 grade 与旧二元行为一致；again/good 分别等价「错/对」', () => {
    const w1 = nextSrs({ interval_days: 30, ease: 2.5 }, false), w2 = nextSrs({ interval_days: 30, ease: 2.5 }, false, 'again');
    expect([w2.interval, w2.ease]).toEqual([w1.interval, w1.ease]);
    const g1 = nextSrs({ interval_days: 3, ease: 2.6 }, true), g2 = nextSrs({ interval_days: 3, ease: 2.6 }, true, 'good');
    expect([g2.interval, g2.ease]).toEqual([g1.interval, g1.ease]);
  });
  it('grade 优先于 is_correct（again + correct=true 仍按错处理）', () => {
    const r = nextSrs({ interval_days: 9, ease: 2.5 }, true, 'again');
    expect(r.interval).toBe(0);
    expect(r.ease).toBe(2.3);
  });
  it('脏数据（缺字段）按新题处理', () => {
    const r = nextSrs({}, true);
    expect(r.interval).toBe(1);
    expect(r.ease).toBe(2.55);
  });
});
