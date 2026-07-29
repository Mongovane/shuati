// 整本抽题入库的优化回归（P0 预览分页 / P1 批大小 / P2 push / P3 预警）
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const src = fs.readFileSync(path.join(ROOT, 'js/views/ingest.js'), 'utf8');
const Ingest = new Function(src + ';return IngestMixin;')();
const M = Ingest.methods;

// 造 n 道题
const mkQ = (n) => Array.from({ length: n }, (_, i) => ({ stem: '题目' + i, type: 'single_choice', answer: ['A'] }));

// fake this：_openPreview 只依赖 this.extractPreview
function ctx() {
  return Object.assign(Object.create(M), { extractPreview: {}, flash() {} });
}

describe('P0 预览分页（防大题量全量渲染卡死）', () => {
  it('_openPreview 初始化分页状态，每项带稳定 key', () => {
    const c = ctx();
    M._openPreview.call(c, mkQ(100), 't', 'math', 's');
    expect(c.extractPreview.page).toBe(1);
    expect(c.extractPreview.pageSize).toBe(40);
    expect(c.extractPreview.items.length).toBe(100);
    expect(c.extractPreview.items[0]._k).toBe(0);
    expect(c.extractPreview.items[99]._k).toBe(99);
  });

  it('extractPages 按 pageSize 正确算总页数', () => {
    const c = ctx();
    M._openPreview.call(c, mkQ(100), 't', 'math', 's');
    expect(M.extractPages.call(c)).toBe(3);          // ceil(100/40)
    M._openPreview.call(c, mkQ(40), 't', 'math', 's');
    expect(M.extractPages.call(c)).toBe(1);          // 正好一页
    M._openPreview.call(c, mkQ(41), 't', 'math', 's');
    expect(M.extractPages.call(c)).toBe(2);
  });

  it('extractPageItems 只返回当前页，且切页返回不同批', () => {
    const c = ctx();
    M._openPreview.call(c, mkQ(100), 't', 'math', 's');
    const p1 = M.extractPageItems.call(c);
    expect(p1.length).toBe(40);
    expect(p1[0].stem).toBe('题目0');
    M.extractGoPage.call(c, 3);
    const p3 = M.extractPageItems.call(c);
    expect(p3.length).toBe(20);                      // 最后一页只剩 20
    expect(p3[0].stem).toBe('题目80');
  });

  it('extractGoPage 越界会夹到合法范围', () => {
    const c = ctx();
    M._openPreview.call(c, mkQ(100), 't', 'math', 's');
    M.extractGoPage.call(c, 999); expect(c.extractPreview.page).toBe(3);
    M.extractGoPage.call(c, -5); expect(c.extractPreview.page).toBe(1);
    M.extractGoPage.call(c, 'abc'); expect(c.extractPreview.page).toBe(1);
  });

  it('勾选状态跨页保留（改的是 items 上的对象）', () => {
    const c = ctx();
    M._openPreview.call(c, mkQ(100), 't', 'math', 's');
    M.extractPageItems.call(c)[0]._use = false;      // 取消第 1 页第 1 题
    M.extractGoPage.call(c, 2);
    M.extractGoPage.call(c, 1);
    expect(M.extractPageItems.call(c)[0]._use).toBe(false);   // 切回来仍是取消态
    expect(M.extractUseCount.call(c)).toBe(99);
  });

  it('空列表不炸：至少 1 页', () => {
    const c = ctx();
    M._openPreview.call(c, [], 't', 'math', 's');
    expect(M.extractPages.call(c)).toBe(1);
    expect(M.extractPageItems.call(c)).toEqual([]);
  });
});

describe('P1/P2 源码层面守卫', () => {
  it('导入批大小为 80（与后端 batchChunked 对齐，请求数砍半）', () => {
    // 两条题目导入路径（预览导入 / _postQuestions）都应对齐后端的 80
    expect((src.match(/const CH=80/g) || []).length).toBe(2);
    expect(src).not.toMatch(/const CH=40/);
  });
  it('整本抽题不再用 concat 累积（避免 O(n²) 重建数组）', () => {
    const body = src.match(/async localExtractBook\(\)[\s\S]*?_openPreview\(all[^\n]*/)[0];
    expect(body).not.toMatch(/all=all\.concat/);
    expect(body).toMatch(/all\.push\(q\)/);
  });
  it('P3：整本抽题对大题量有 confirm 预警', () => {
    const body = src.match(/async localExtractBook\(\)[\s\S]*?_openPreview\(all[^\n]*/)[0];
    expect(body).toMatch(/all\.length>800/);
    expect(body).toMatch(/confirm\(/);
  });
});

describe('批内去重仍然有效（原有能力不回退）', () => {
  it('相同题干只保留一条并计入 dup', () => {
    const c = ctx();
    M._openPreview.call(c, [
      { stem: '同一题', answer: ['A'] },
      { stem: '同一题', answer: ['A'] },
      { stem: ' 同一题 ', answer: ['A'] },   // 空白归一后也算重复
      { stem: '另一题', answer: ['B'] },
    ], 't', 'math', 's');
    expect(c.extractPreview.items.length).toBe(2);
    expect(c.extractPreview.dup).toBe(2);
  });
});
