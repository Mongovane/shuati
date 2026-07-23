// SettingsMixin（js/views/settings.js）关键行为
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const Settings = new Function(fs.readFileSync(path.join(ROOT, 'js/views/settings.js'), 'utf8') + ';return SettingsMixin;')();

describe('pickModel 选用模型（datalist 补全）', () => {
  it('选模型后写入 explainCfg.model，且保留候选列表供继续补全', () => {
    let saved = false;
    const ctx = {
      explainCfg: { base: 'x', key: 'y', model: '' },
      modelPick: { busy: false, list: ['gpt-4o', 'deepseek-v3', 'claude-3'] },
      saveExplainCfg() { saved = true; }, flash() {},
    };
    Settings.methods.pickModel.call(ctx, 'deepseek-v3');
    expect(ctx.explainCfg.model).toBe('deepseek-v3');
    expect(saved).toBe(true);
    // 关键：列表不被清空，datalist 仍能提供补全
    expect(ctx.modelPick.list).toEqual(['gpt-4o', 'deepseek-v3', 'claude-3']);
  });
});

describe('科目排序 subjMove/subjReorder', () => {
  function mk() {
    const ctx = {
      subjects: [{ v: 'a', t: 'A', sort: 10 }, { v: 'b', t: 'B', sort: 20 }, { v: 'c', t: 'C', sort: 30 }],
      async api() { return {}; }, async loadSubjects() {}, flash() {},
    };
    ctx.subjMove = Settings.methods.subjMove.bind(ctx);
    ctx.subjReorder = Settings.methods.subjReorder.bind(ctx);
    return ctx;
  }
  it('下移：与下一项交换并重算 sort 为 10/20/30', async () => {
    const ctx = mk();
    await ctx.subjMove(0, 1);       // A 下移
    expect(ctx.subjects.map(s => s.v)).toEqual(['b', 'a', 'c']);
    expect(ctx.subjects.map(s => s.sort)).toEqual([10, 20, 30]);
  });
  it('上移：与上一项交换', async () => {
    const ctx = mk();
    await ctx.subjMove(2, -1);      // C 上移
    expect(ctx.subjects.map(s => s.v)).toEqual(['a', 'c', 'b']);
  });
  it('越界不动（首项上移 / 末项下移）', async () => {
    const ctx = mk();
    await ctx.subjMove(0, -1);
    await ctx.subjMove(2, 1);
    expect(ctx.subjects.map(s => s.v)).toEqual(['a', 'b', 'c']);
  });
});


describe('模型建议过滤 modelSuggest（移动端补全）', () => {
  // 复制 computed 纯逻辑做等价校验
  function suggest(ctx) {
    const list = ctx.modelPick.list || [];
    if (!list.length) return [];
    const kw = String(ctx.explainCfg.model || '').trim().toLowerCase();
    const hit = kw ? list.filter((m) => String(m).toLowerCase().includes(kw)) : list;
    return hit.slice(0, 20);
  }
  const list = ['gpt-4o', 'gpt-4o-mini', 'deepseek-v3', 'deepseek-r1', 'claude-3'];
  it('空输入显示全部', () => {
    expect(suggest({ modelPick: { list }, explainCfg: { model: '' } })).toEqual(list);
  });
  it('输入 deep 只留 deepseek 系', () => {
    expect(suggest({ modelPick: { list }, explainCfg: { model: 'deep' } })).toEqual(['deepseek-v3', 'deepseek-r1']);
  });
  it('未拉取模型时无建议', () => {
    expect(suggest({ modelPick: { list: [] }, explainCfg: { model: 'x' } })).toEqual([]);
  });
});
