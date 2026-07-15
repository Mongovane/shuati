// 科目自动判定：
//  1) 后端 guessSubjectFromText 的行为
//  2) 前端 classifySubject 与后端结果一致 —— README 承认这套规则前后端各一份需手工同步，
//     这条测试把「忘了同步」变成 CI 红灯
//  3) 测试用的科目种子与 functions/api/subjects.js 里的种子一字不差
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { guessSubjectFromText, structuralSubject } from '../functions/api/process.js';
import { loadSettingsMixin, SEED_SUBJECTS, ROOT } from './helpers.mjs';

const SM = loadSettingsMixin();
const feSubjects = SEED_SUBJECTS.map((s) => ({ v: s.code, keywords: s.keywords }));
const fe = (t) => SM.methods.classifySubject.call({ subjects: feSubjects }, t);
const be = (t) => guessSubjectFromText(t, SEED_SUBJECTS);

// [文本, 期望科目]；'' = 特征不明确、保持默认不乱动
const CASES = [
  ['#include <stdio.h>\nint main(){ printf("hi"); return 0; }', 'computer'],
  ['cout << x << endl; 输出什么', 'computer'],
  ['链表的插入与删除操作，时间复杂度是多少', 'computer'],
  ['求 \\int x^2 \\, dx 的值', 'math'],
  ['求函数的导数与微分', 'math'],
  ['The quick brown fox jumps over the lazy dog and runs into the forest.', 'english'],
  ['马克思主义基本原理概论第一章', 'politics'],
  ['坚持中国共产党的领导是根本保证', 'politics'],
  ['下列说法正确的是', ''],
  ['x + y = 1', ''],
];

describe('后端 guessSubjectFromText', () => {
  it('强特征命中才返回，特征不明确返回空串', () => {
    for (const [text, want] of CASES) expect(be(text), text).toBe(want);
  });
  it('结构特征优先于关键词（含政治词的代码题判 computer）', () => {
    const t = '以下 C 程序输出什么：#include <stdio.h>\nint main(){ printf("社会主义"); }';
    expect(structuralSubject(t)).toBe('computer');
    expect(be(t)).toBe('computer');
  });
});

describe('前后端判定一致（防规则漂移）', () => {
  it('同一批文本前后端结论一致', () => {
    const extra = ['英语阅读理解训练', '矩阵的特征值', '', '设 f(x) 在区间上有定积分', '递归调用栈'];
    for (const [text] of CASES) expect(fe(text), text).toBe(be(text));
    for (const t of extra) expect(fe(t), t).toBe(be(t));
  });
});

describe('科目种子未漂移', () => {
  it('tests/helpers.mjs 的 SEED_SUBJECTS 与 functions/api/subjects.js 种子一字不差', () => {
    const src = fs.readFileSync(path.join(ROOT, 'functions/api/subjects.js'), 'utf8');
    for (const s of SEED_SUBJECTS) {
      expect(src.includes(`'${s.code}'`), s.code).toBe(true);
      expect(src.includes(s.keywords), s.code + ' 的 keywords').toBe(true);
    }
  });
});
