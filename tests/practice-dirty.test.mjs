// 刷题操作后是否正确标记各视图的 dirty（切过去能看到最新数据）
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const PracticeMixin = new Function(fs.readFileSync(path.join(ROOT, 'js/views/practice.js'), 'utf8') + '\nreturn PracticeMixin;')();
const M = PracticeMixin.methods;

// 造一个最小 fake this
function ctx(over = {}) {
  return {
    sessionAns: {}, streak: 0, bestStreak: 0, statsDirty: false, bankDirty: false, favDirty: false,
    dailyNewLimit: 0, token: 't',
    flash() {}, countNewToday() {}, findQ() { return null; },
    async api() { return {}; },
    ...over,
  };
}

describe('刷题操作标记 dirty', () => {
  it('答题 onAnswered → statsDirty=true（报表能反映最新做题）', async () => {
    const c = ctx();
    await M.onAnswered.call(c, { id: 'q1', correct: true });
    expect(c.statsDirty).toBe(true);
  });
  it('标记掌握 onMaster → statsDirty + favDirty', async () => {
    const c = ctx();
    await M.onMaster.call(c, { id: 'q1', value: true });
    expect(c.statsDirty).toBe(true);
    expect(c.favDirty).toBe(true);
  });
  it('收藏 onFav → favDirty（不必标 statsDirty，收藏不影响统计数字）', async () => {
    const c = ctx();
    await M.onFav.call(c, { id: 'q1', value: true });
    expect(c.favDirty).toBe(true);
  });
});
