// 长阅读材料折叠。
// 背景：一篇 1600+ 字符的阅读理解材料会占满整屏，题干和选项被顶到折叠线以下，
// 用户得先滚很久才知道题目在问什么。超长默认收起 + 「展开全文」。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const QC = new Function('RichText', read('js/constants.js') + '\n' + read('js/components/question-card.js') + '\nreturn QuestionCard;')({});

const card = (q) => {
  const self = { q, passageOpen: false };
  for (const k of Object.keys(QC.computed)) {
    Object.defineProperty(self, k, { get() { return QC.computed[k].call(self); }, configurable: true });
  }
  for (const k of Object.keys(QC.methods)) self[k] = QC.methods[k].bind(self);
  return self;
};

const LONG_EN = 'A recent survey by China Youth Daily shows that 85.5 percent of young Chinese are willing to take up side jobs. '.repeat(6);
const SHORT_EN = 'People in Greece bake a special cake with a coin hidden inside it.';
const LONG_CN = '本文主要讨论了年轻人从事副业的意愿与态度，并给出了若干建议。'.repeat(12);

describe('折叠阈值', () => {
  it('长材料判定为需要折叠', () => {
    expect(card({ passage: LONG_EN }).passageLong).toBe(true);
  });
  it('短材料不折叠，不该平白多出一个「展开全文」', () => {
    expect(card({ passage: SHORT_EN }).passageLong).toBe(false);
  });
  it('没有材料时不报错', () => {
    expect(card({}).passageLong).toBe(false);
    expect(card({ passage: null }).passageWords).toBe('0 字');
  });
});

describe('完形填空不能折叠', () => {
  it('材料里的空就是题目本身，折起来就没法做了', () => {
    const c = card({ passage: LONG_EN + ' \uFF3F\uFF3F21\uFF3F\uFF3F ', stem: '（完形填空 第 21 空）' });
    expect(c.clozeNo).toBe(21);
    expect(c.passageLong).toBe(false);
  });
  it('普通阅读题材料照常折叠', () => {
    expect(card({ passage: LONG_EN, stem: 'What is the best title?' }).passageLong).toBe(true);
  });
});

describe('中英文分别排版', () => {
  it('英文材料走西文排版', () => {
    expect(card({ passage: LONG_EN }).passageEnglish).toBe(true);
  });
  it('中文材料不被西文字体接管', () => {
    expect(card({ passage: LONG_CN }).passageEnglish).toBe(false);
  });
  it('中英混排且中文占比高时按中文处理', () => {
    expect(card({ passage: '这段材料讨论 side jobs 的社会意义，并引用了若干调查数据加以说明。' }).passageEnglish).toBe(false);
  });
  it('计数单位跟着语种走', () => {
    expect(card({ passage: LONG_EN }).passageWords).toMatch(/ words$/);
    expect(card({ passage: LONG_CN }).passageWords).toMatch(/ 字$/);
  });
});

describe('切题要收回折叠状态', () => {
  it('reset() 把 passageOpen 归零，否则上一题展开过下一题就直接是展开的', () => {
    const self = card({ passage: LONG_EN, note: '', type: 'single_choice' });
    self.passageOpen = true;
    self.reset();
    expect(self.passageOpen).toBe(false);
  });
});

describe('知识卡片的 formula 字段', () => {
  const c = card({});
  it('英语句型结构标记为纯文本', () => {
    expect(c.isTextFormula('not only + 倒装 + ... but also ...')).toBe(true);
  });
  it('LaTeX 公式不标记（走原来的 KaTeX 胶囊）', () => {
    expect(c.isTextFormula('$f(x)=x^2$')).toBe(false);
  });
  it('空值不标记', () => {
    expect(c.isTextFormula('')).toBe(false);
    expect(c.isTextFormula(undefined)).toBe(false);
  });
});

describe('模板确实用上了这些状态', () => {
  const tpl = QC.template;
  it('渲染折叠类与展开按钮', () => {
    expect(tpl).toContain('folded: passageLong && !passageOpen');
    expect(tpl).toContain('展开全文');
  });
  it('材料区带标签和长度提示', () => {
    expect(tpl).toContain('passage-tag');
    expect(tpl).toContain('passageWords');
  });
});
