// 真实教材格式的门禁。片段取自三本实际 PDF（数据结构 严蔚敏 / C程序设计 谭浩强 /
// 毛概 2023 版）的 pdftotext 抽取结果，只保留结构特征，不含成段正文。
//
// 这些格式踩到的坑：
//  1. 选项一行放两个（A 和 B 同行，C 和 D 同行）。逐行的 optRe 用 `(.+)$` 收尾，
//     会把 B 整个塞进 A 的文本里 —— 只剩 2 个选项且内容是错的，比丢掉更难发现。
//  2. 「5．选择题」把 exLabel 置成 choice 之后没人复位，于是「6．试分析…」下面的
//     (1)…(6) 代码段全被当成独立题目，父题干丢失。
//  3. 书脊竖排标题（「双色版」「C言版）（第 版」）在 PDF 里落在页面中部，混进题干。
//     它们只印在单侧页面，频次天然只有 ~50%。
//  4. 教材正文的小节标题会被 numRe 当成编号题（「4.4 算法的空间复杂度」「5 小结」）。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const M = new Function(fs.readFileSync(path.join(ROOT, 'js/views/ingest.js'), 'utf8') + ';return IngestMixin;')().methods;
const ctx = () => Object.assign(Object.create(M), { extractPreview: {}, extractSkippedToc: 0, flash() {} });
const parse = (md, over) => M.mdToQuestions.call(ctx(), md, Object.assign({ subject: 'computer', source: 't', page: 1 }, over));
const book = (pages, over) => M._extractWholeBook.call(ctx(), Object.assign({ subject: 'computer', title: 't' }, over, {
  pages: pages.map((content_md, i) => ({ page: i + 1, content_md })),
}));

// —— 数据结构 p25 的选择题：选项双列 ——
const DS_CHOICE = `# 习题

5．选择题
（1）在数据结构中，从逻辑上可以把数据结构分成（        ）。
A．动态结构和静态结构                 B．紧凑结构和非紧凑结构
C．线性结构和非线性结构                D．内部结构和外部结构
（2）与数据元素本身的形式、内容、相对位置、个数无关的是数据的（      ）。
A．存储结构                      B．存储实现
C．逻辑结构                      D．运算实现
`;

describe('选项一行放两个（数据结构 p25 实测格式）', () => {
  const qs = parse(DS_CHOICE);
  it('两道题都抽出来了', () => {
    expect(qs).toHaveLength(2);
  });
  it('四个选项齐全，不是只剩 A 和 C', () => {
    for (const q of qs) expect(q.options.map((o) => o.key)).toEqual(['A', 'B', 'C', 'D']);
  });
  it('B 的内容不能被塞进 A 里', () => {
    expect(qs[0].options[0].text).toBe('动态结构和静态结构');
    expect(qs[0].options[1].text).toBe('紧凑结构和非紧凑结构');
    expect(qs[0].options[0].text).not.toContain('紧凑');
  });
  it('行内的大段空白被压掉', () => {
    for (const q of qs) for (const o of q.options) expect(o.text).not.toMatch(/\s{2,}/);
  });
  it('题型判成单选', () => {
    for (const q of qs) expect(q.type).toBe('single_choice');
  });
});

describe('四个选项挤在同一行', () => {
  const qs = parse(`# 习题\n\n5．选择题\n（6）以下数据结构中，（   ）是非线性数据结构。\nA．树           B．字符串         C．队列          D．栈\n`);
  it('照样拆成四个', () => {
    expect(qs[0].options.map((o) => o.text)).toEqual(['树', '字符串', '队列', '栈']);
  });
});

describe('选项残缺时退回逐行，不能整题丢内容', () => {
  const qs = parse(`# 习题\n\n5．选择题\n（1）以下说法正确的是（   ）。\nB．只有 B 和 D\nD．跨页断了\n`);
  it('拆不出 A→B→C 的严格序列，但内容还在', () => {
    const all = JSON.stringify(qs);
    expect(all).toContain('只有 B 和 D');
    expect(all).toContain('跨页断了');
  });
});

describe('「5．选择题」之后的编号题要复位 exLabel', () => {
  const qs = parse(`# 习题

5．选择题
（1）在数据结构中，从逻辑上可以把数据结构分成（    ）。
A．动态结构和静态结构                 B．紧凑结构和非紧凑结构
C．线性结构和非线性结构                D．内部结构和外部结构
6．试分析下列各算法的时间复杂度。
（1）x=90; y=100;
while(y>0)
（2）for(i=0; i<n; i++)
a[i][j]=0;
`);
  it('选择题的 (1) 是独立题，代码题的 (1)(2) 是子项', () => {
    expect(qs).toHaveLength(2);
    expect(qs[0].type).toBe('single_choice');
  });
  it('代码子项保住了父题干，不是一堆没头没尾的片段', () => {
    const code = qs[1];
    expect(code.stem).toContain('试分析下列各算法的时间复杂度');
    expect(code.stem).toContain('x=90');
    expect(code.stem).toContain('for(i=0');
  });
});

// —— 书脊竖排标题：只印单侧页面，频次 ~50% ——
describe('页面中部的书脊竖排文字', () => {
  const spine = '双色版';
  const pages = [];
  for (let i = 0; i < 10; i++) {
    const body = `## 小节 ${i}\n\n这是一段足够长的正文，用来占位并确保这一页有实际内容参与频次统计，不至于被当成空页跳过。`;
    // 只在偶数页出现，模拟 recto/verso 交替
    pages.push(i % 2 === 0 ? `${body}\n${spine}\n` : body);
  }
  pages.push(`# 习题\n\n1．简述下列概念：数据、数据元素、数据项、数据对象、数据结构、逻辑结构、存储结\n${spine}\n构、抽象数据类型。\n`);
  const qs = book(pages);
  it('频次只有一半也要剥掉（短行阈值放宽到 40%）', () => {
    expect(qs.length).toBeGreaterThanOrEqual(1);
    expect(qs.some((q) => q.stem.includes(spine))).toBe(false);
  });
  it('被竖排文字截断的句子重新接上', () => {
    expect(qs[0].stem.replace(/\s+/g, '')).toContain('存储结构、抽象数据类型');
  });
});

describe('孤立的页码 / 单字 / 破折号行', () => {
  // 这类剥离在 _stripPageFurniture 里，是「整本」路径的页级预处理，
  // 直接调 mdToQuestions 不经过它 —— 所以必须走 book()，且页数要够（<4 页不做剥离）
  const filler = (i) => `## 小节 ${i}\n\n这是一段足够长的正文，用来让这一页有实际内容参与统计，不至于被当成空页跳过。`;
  const qs = book([
    filler(1), filler(2), filler(3),
    `# 习题\n\n1．试分析下列算法的时间复杂度。\nx=90; y=100;\n17\nwhile(y>0)\n第\n1\n章\n——\nx++;\n`,
  ]);
  it('全都不进题干', () => {
    const s = qs[0].stem;
    expect(s).toContain('x=90');
    expect(s).toContain('x++');
    expect(s.split('\n').map((x) => x.trim())).not.toContain('17');
    expect(s.split('\n').map((x) => x.trim())).not.toContain('第');
    expect(s.split('\n').map((x) => x.trim())).not.toContain('——');
  });
});

// —— 教材：只在习题区抽题；试卷不受影响 ——
describe('习题分区约束', () => {
  const textbook = `# 第1章 绪论

## 数据结构的研究内容

1.1 这里是正文的小节编号，不该被当成题目
4.4 算法的空间复杂度
5 小结

# 习题

1．简述下列概念：数据、数据元素。
2．试举一个数据结构的例子。
`;
  it('正文小节标题不再被当成编号题', () => {
    const qs = parse(textbook);
    expect(qs).toHaveLength(2);
    expect(qs.map((q) => q.stem)).toEqual(['简述下列概念：数据、数据元素。', '试举一个数据结构的例子。']);
  });
  it('习题区被非习题标题关闭，后面的正文不再算题', () => {
    const qs = parse(textbook + '\n## 下一节的标题\n\n7.2 又是一个小节编号\n8 又一个小结\n');
    expect(qs).toHaveLength(2);
  });
  it('习题区内的「选择题」这类小节标签不会误关闭分区', () => {
    const qs = parse('# 习题\n\n1．简述概念。\n\n## 选择题\n\n（1）以下正确的是（  ）。\nA．甲   B．乙\nC．丙   D．丁\n');
    expect(qs).toHaveLength(2);
    expect(qs[1].options).toHaveLength(4);
  });
  it('试卷（全篇是题、没有习题分区）保持原行为：全文抽', () => {
    const paper = `# 广东省 2022 年普通高等学校专升本考试\n\n# 第一部分\n\n1. What might Greeks find in the cake?\nA. A grape.\nB. A ring.\nC. A coin.\nD. A tooth.\n\n2. 下列说法正确的是（  ）。\nA．甲   B．乙\nC．丙   D．丁\n`;
    const qs = parse(paper, { subject: 'english' });
    expect(qs).toHaveLength(2);
    expect(qs.every((q) => q.options.length === 4)).toBe(true);
  });
});

// —— 毛概 / C程序设计的编号形态 ——
describe('其它两本的编号形态', () => {
  it('毛概：「1   .题干」——数字、空格、句点、紧跟文字', () => {
    const qs = parse('# 思考题\n1   .毛泽东思想形成和发展的社会历史条件是什么？\n2   .如何把握毛泽东思想的主要内容和活的灵魂？\n', { subject: 'politics' });
    expect(qs).toHaveLength(2);
    expect(qs[0].stem).toBe('毛泽东思想形成和发展的社会历史条件是什么？');
  });
  it('毛概：思考题后面的「阅读书目」条目不算题', () => {
    const qs = parse('# 思考题\n1   .如何科学认识毛泽东思想的历史地位？\n\n阅读书目\n1．毛泽东：《论人民民主专政》，《毛泽东选集》第四卷，人民出版社 1991 年版。\n', { subject: 'politics' });
    expect(qs).toHaveLength(1);
  });
  it('C程序设计：OCR 把 (1) 认成 Cl) 也不影响父题成立', () => {
    const qs = parse('# 习题\n3. 正确理解以下名词及其含义：\nCl) 源程序，目标程序，可执行程序。\n(2) 程序编辑，程序编译，程序连接。\n');
    expect(qs).toHaveLength(1);
    expect(qs[0].stem).toContain('正确理解以下名词');
    expect(qs[0].stem).toContain('程序编辑');
  });
});
