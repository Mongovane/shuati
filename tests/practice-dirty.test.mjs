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

describe('AI 自动保存（autoSaveAi）', () => {
  it('_autoSaveExplain 把解析 PATCH 到题目并标记已存', async () => {
    const patches = [];
    const q = { id: 'q1', analysis: '' };
    const ctx = { findQ: () => q, bankDirty: false, async api(p, o) { patches.push({ p, body: JSON.parse(o.body) }); return {}; } };
    await M._autoSaveExplain.call(ctx, 'q1', 'AI给出的解析内容', []);
    expect(patches.length).toBe(1);
    expect(patches[0].body.analysis).toContain('AI 解析');
    expect(patches[0].body.analysis).toContain('AI给出的解析内容');
    expect(q._aiSaved).toBe(true);
    expect(ctx.bankDirty).toBe(true);
  });
  it('_autoSaveExplain 已保存过则不重复 PATCH', async () => {
    const patches = [];
    const q = { id: 'q1', analysis: 'x', _aiSaved: true };
    const ctx = { findQ: () => q, async api(p, o) { patches.push(1); return {}; } };
    await M._autoSaveExplain.call(ctx, 'q1', 'text', []);
    expect(patches.length).toBe(0);
  });
  it('_autoSaveConcept 把卡片转 markdown 存入', async () => {
    const patches = [];
    const q = { id: 'q2', analysis: '' };
    const ctx = { findQ: () => q, bankDirty: false, async api(p, o) { patches.push(JSON.parse(o.body)); return {}; } };
    const cards = [{ term: '导数', formula: 'f\'(x)', plain: '变化率', example: '速度' }];
    await M._autoSaveConcept.call(ctx, 'q2', cards);
    expect(patches.length).toBe(1);
    expect(patches[0].analysis).toContain('知识点卡片');
    expect(patches[0].analysis).toContain('导数');
    expect(q._conceptSaved).toBe(true);
  });
});
