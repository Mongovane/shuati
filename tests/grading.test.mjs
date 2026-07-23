// 判分引擎（js/components/question-card.js 的 autoCorrect / finalCorrect）
import { describe, it, expect } from 'vitest';
import { loadQuestionCard, cardCtx } from './helpers.mjs';

const { QuestionCard: QC, AUTO, OBJECTIVE } = loadQuestionCard();
const ac = (ctx) => QC.computed.autoCorrect.call(ctx);
const fc = (ctx) => QC.computed.finalCorrect.call(ctx);

describe('autoCorrect 自动判分', () => {
  it('单选：选对 / 选错 / 未选', () => {
    const q = { type: 'single_choice', answer: ['B'] };
    expect(ac(cardCtx(QC, q, { sel: ['B'] }))).toBe(true);
    expect(ac(cardCtx(QC, q, { sel: ['A'] }))).toBe(false);
    expect(ac(cardCtx(QC, q, { sel: [] }))).toBe(false);
  });
  it('单选：答案大小写不敏感（answerKeys 统一大写）', () => {
    const q = { type: 'single_choice', answer: ['b'] };
    expect(ac(cardCtx(QC, q, { sel: ['B'] }))).toBe(true);
  });
  it('多选：全对才算对，顺序无关；多选/少选都算错', () => {
    const q = { type: 'multiple_choice', answer: ['A', 'C'] };
    expect(ac(cardCtx(QC, q, { sel: ['C', 'A'] }))).toBe(true);
    expect(ac(cardCtx(QC, q, { sel: ['A'] }))).toBe(false);
    expect(ac(cardCtx(QC, q, { sel: ['A', 'C', 'D'] }))).toBe(false);
  });
  it('判断题', () => {
    const q = { type: 'true_false', answer: ['T'] };
    expect(ac(cardCtx(QC, q, { sel: ['T'] }))).toBe(true);
    expect(ac(cardCtx(QC, q, { sel: ['F'] }))).toBe(false);
  });
  it('填空：忽略大小写与所有空白；接受任一备选答案；空输入不算对', () => {
    const q = { type: 'fill_blank', answer: ['Hello World', '你好'] };
    expect(ac(cardCtx(QC, q, { blanks: ' hello   world ' }))).toBe(true);
    expect(ac(cardCtx(QC, q, { blanks: '你 好' }))).toBe(true);
    expect(ac(cardCtx(QC, q, { blanks: '' }))).toBe(false);
    expect(ac(cardCtx(QC, q, { blanks: 'nope' }))).toBe(false);
  });
});

describe('填空进阶：全半角归一 / 多空', () => {
  it('全角字母数字括号与全角空格归一（ＡＢ１２（） ≙ ab12()）', () => {
    const q = { type: 'fill_blank', answer: ['AB12()'] };
    expect(ac(cardCtx(QC, q, { blanks: 'ＡＢ　１２（）' }))).toBe(true);
  });
  it('多空（答案用 || 分隔各空）：逐空比对、支持多套备选、缺一空不算对、顺序敏感', () => {
    const q = { type: 'fill_blank', answer: ['栈||队列', 'stack||queue'] };
    expect(ac(cardCtx(QC, q, { blanksArr: ['栈', '队列'] }))).toBe(true);
    expect(ac(cardCtx(QC, q, { blanksArr: ['Stack', ' QUEUE '] }))).toBe(true);
    expect(ac(cardCtx(QC, q, { blanksArr: ['队列', '栈'] }))).toBe(false);
    expect(ac(cardCtx(QC, q, { blanksArr: ['栈', ''] }))).toBe(false);
  });
  it('blankCount / isMultiBlank 按答案里的 || 识别', () => {
    expect(cardCtx(QC, { type: 'fill_blank', answer: ['a||b||c'] }).blankCount).toBe(3);
    expect(cardCtx(QC, { type: 'fill_blank', answer: ['a||b||c'] }).isMultiBlank).toBe(true);
    expect(cardCtx(QC, { type: 'fill_blank', answer: ['单空'] }).blankCount).toBe(1);
  });
  it('ansDisplay：|| 转分隔符展示、多备选用「或」连接', () => {
    expect(cardCtx(QC, { type: 'fill_blank', answer: ['栈||队列', '堆栈||FIFO'] }).ansDisplay).toBe('栈 ⁄ 队列　或　堆栈 ⁄ FIFO');
  });
});

describe('多选少选半分 mcPartial', () => {
  const q = { type: 'multiple_choice', answer: ['A', 'C', 'D'] };
  it('所选都对但不全 → 半分；含错选 / 全对 / 空选 → 否', () => {
    expect(cardCtx(QC, q, { sel: ['A', 'C'] }).mcPartial).toBe(true);
    expect(cardCtx(QC, q, { sel: ['A', 'B'] }).mcPartial).toBe(false);
    expect(cardCtx(QC, q, { sel: ['A', 'C', 'D'] }).mcPartial).toBe(false);
    expect(cardCtx(QC, q, { sel: [] }).mcPartial).toBe(false);
  });
  it('单选不产生半分', () => {
    expect(cardCtx(QC, { type: 'single_choice', answer: ['A', 'B'] }, { sel: ['A'] }).mcPartial).toBe(false);
  });
});

describe('finalCorrect 最终判定', () => {
  it('客观题（AUTO）直接用自动判分', () => {
    const q = { type: 'single_choice', answer: ['A'] };
    expect(fc(cardCtx(QC, q, { sel: ['A'] }))).toBe(true);
    expect(fc(cardCtx(QC, q, { sel: ['B'] }))).toBe(false);
  });
  it('填空：自评可覆盖自动判分，未自评回落自动判分', () => {
    const q = { type: 'fill_blank', answer: ['答案'] };
    expect(fc(cardCtx(QC, q, { blanks: '不一样', self: true }))).toBe(true);   // 机器判错、人说对（同义写法）
    expect(fc(cardCtx(QC, q, { blanks: '答案', self: false }))).toBe(false);   // 机器判对、人说错
    expect(fc(cardCtx(QC, q, { blanks: '答案', self: null }))).toBe(true);     // 未自评 → 自动
  });
  it('主观题只认自评，未自评视为未得分', () => {
    const q = { type: 'short_answer', answer: ['要点'] };
    expect(fc(cardCtx(QC, q, { self: true }))).toBe(true);
    expect(fc(cardCtx(QC, q, { self: false }))).toBe(false);
    expect(fc(cardCtx(QC, q, { self: null }))).toBe(false);
  });
});

describe('constants 判分常量', () => {
  it('AUTO / OBJECTIVE 覆盖预期题型', () => {
    expect(AUTO).toEqual(['single_choice', 'multiple_choice', 'true_false']);
    expect(OBJECTIVE).toEqual(['single_choice', 'multiple_choice', 'true_false', 'fill_blank']);
  });
});

describe('选段模式 seg-mode 通知父组件（修回顶按钮遮挡）', () => {
  it('segMode watch 触发 $emit(seg-mode)', () => {
    const emits = [];
    const ctx = { $emit: (name, v) => emits.push([name, v]) };
    QC.watch.segMode.call(ctx, true);
    expect(emits).toContainEqual(['seg-mode', true]);
    QC.watch.segMode.call(ctx, false);
    expect(emits).toContainEqual(['seg-mode', false]);
  });
  it('切题 reset 会退出选段模式（避免 segActive 残留）', () => {
    const ctx = { q: { note: '' }, blankCount: 0, segMode: true, segCount: 3, sel: [], blanksArr: [] };
    QC.methods.reset.call(ctx);
    expect(ctx.segMode).toBe(false);
    expect(ctx.segCount).toBe(0);
  });
});
