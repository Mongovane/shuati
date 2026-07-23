// 答案规范化/校验（functions/api/process.js 的 normalizeAnswer）——所有导入路径的答案守门员
import { describe, it, expect } from 'vitest';
import { normalizeAnswer } from '../functions/api/process.js';

const opts = (keys) => keys.map((k) => ({ key: k, text: k + '选项' }));

describe('单选题', () => {
  it('大写归一、取第一个多余答案并告警', () => {
    const r = normalizeAnswer('single_choice', ['b'], opts(['A', 'B', 'C']));
    expect(r.answer).toEqual(['B']);
    expect(r.warn).toBe(null);
    const m = normalizeAnswer('single_choice', ['A', 'C'], opts(['A', 'B', 'C']));
    expect(m.answer).toEqual(['A']);
    expect(m.warn).toMatch(/单选题有多个答案/);
  });
  it('答案不在选项内 → 告警（保留原值供人工检查）', () => {
    const r = normalizeAnswer('single_choice', ['E'], opts(['A', 'B', 'C', 'D']));
    expect(r.warn).toMatch(/不在选项内/);
  });
  it('缺答案 → 告警', () => {
    expect(normalizeAnswer('single_choice', [], opts(['A', 'B'])).warn).toMatch(/缺少答案/);
  });
});

describe('多选题', () => {
  it('去重 + 大写 + 排除非法项', () => {
    const r = normalizeAnswer('multiple_choice', ['a', 'A', 'c'], opts(['A', 'B', 'C']));
    expect(r.answer).toEqual(['A', 'C']);
    expect(r.warn).toBe(null);
  });
  it('只有一个答案 → 告警', () => {
    const r = normalizeAnswer('multiple_choice', ['A'], opts(['A', 'B', 'C']));
    expect(r.warn).toMatch(/多选题只有一个答案/);
  });
  it('含选项外字母 → 过滤合法项并告警', () => {
    const r = normalizeAnswer('multiple_choice', ['A', 'C', 'Z'], opts(['A', 'B', 'C']));
    expect(r.answer).toEqual(['A', 'C']);
    expect(r.warn).toMatch(/Z 不在选项内/);
  });
  it('无选项信息时不强行过滤（AI 导入可能 key 非 ABCD）', () => {
    const r = normalizeAnswer('multiple_choice', ['甲', '乙'], []);
    expect(r.answer).toEqual(['甲', '乙']);
  });
});

describe('判断题归一', () => {
  it('各种写法都归到 T/F', () => {
    for (const v of ['对', '正确', 'true', 'T', '√', '是', '1']) expect(normalizeAnswer('true_false', [v]).answer).toEqual(['T']);
    for (const v of ['错', '错误', 'false', 'F', '×', '否', '0']) expect(normalizeAnswer('true_false', [v]).answer).toEqual(['F']);
  });
  it('空 → 缺答案告警', () => {
    expect(normalizeAnswer('true_false', []).warn).toMatch(/缺少答案/);
  });
});

describe('填空/主观', () => {
  it('去掉空白与空项，不强改内容', () => {
    const r = normalizeAnswer('fill_blank', [' 栈 ', '', '队列']);
    expect(r.answer).toEqual(['栈', '队列']);
  });
  it('主观题缺参考答案 → 告警', () => {
    expect(normalizeAnswer('short_answer', []).warn).toMatch(/缺少参考答案/);
  });
});
