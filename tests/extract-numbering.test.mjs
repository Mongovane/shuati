// 双书回归基线：高数《习题全解指导》用「1. 」编号且题解同页，
// 数据结构《C语言版》用「（1）」编号、选项挤在同一行、且有目录页会被误判成习题。
// 这两本对解析器的要求是相反的，任何一边的改动都必须两边同时不退。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const Ingest = new Function(fs.readFileSync(path.join(ROOT, 'js/views/ingest.js'), 'utf8') + ';return IngestMixin;')();
const M = Ingest.methods;
const ctx = () => Object.assign(Object.create(M), { extractPreview: {}, flash() {} });
const parse = (md) => M.mdToQuestions.call(ctx(), md, { subject: 'x', source: 's', page: 1 });

describe('目录页识别（数据结构那本第 6/7/8 页被当成 149 道习题）', () => {
  const c = ctx();
  // 这本书的目录没有点线 leader，只用空格分隔标题和页码
  const spaceToc = ['1.1 数据结构的研究内容 1', '1.2 数据结构的基本概念和术语 3', '1.2.1 数据、数据元素、数据项和数据对象 3',
    '1.3 抽象数据类型的表示与实现 9', '1.4 算法和算法分析 12', '1.4.1 算法的定义及特性 12', '1.4.2 评价算法优劣的基本标准 13',
    '1.5 小结 15', '习题 16', '2.1 线性表的定义和特点 18'].join('  \n');

  it('空格式目录（无点线）也能认出来', () => {
    expect(M._looksLikeTocPage.call(c, spaceToc)).toBe(true);
  });
  it('带「## 目录」标题的页直接认', () => {
    expect(M._looksLikeTocPage.call(c, '## 目录\n\n习题 81\n\n## 第4章 串、数组和广义表 84')).toBe(true);
  });
  it('点线式目录也认（高数那本）', () => {
    const dots = Array.from({ length: 9 }, (_, i) => `习题1-${i + 1} 某小节 ......... ${i * 5 + 3}`).join('\n');
    expect(M._looksLikeTocPage.call(c, dots)).toBe(true);
  });
  it('真习题页不能被误判成目录', () => {
    const real = ['## 习题', '1. 简述下列概念：数据、数据元素、数据项、数据对象。', '2. 试举一个数据结构的例子，叙述其逻辑结构和存储结构。',
      '3. 简述逻辑结构的4种基本结构并画出它们的关系图。', '4. 存储结构由哪两种基本的存储方法实现?',
      '5. 选择题', '（1）在数据结构中，从逻辑上可以把数据结构分成（）。A. 动态结构 B. 紧凑结构 C. 线性结构 D. 内部结构',
      '（2）与数据元素本身无关的是数据的（ ）。A. 存储结构 B. 存储实现 C. 逻辑结构 D. 运算实现',
      '（3）通常要求同一逻辑结构中所有元素具有相同特性（）。A. 甲 B. 乙 C. 丙 D. 丁'].join('\n\n');
    expect(M._looksLikeTocPage.call(c, real)).toBe(false);
  });
  it('短页不当目录（避免误伤零碎页）', () => {
    expect(M._looksLikeTocPage.call(c, '1.1 甲 1\n1.2 乙 2')).toBe(false);
  });
});

describe('行内选项拆分（MinerU 把整道选择题压成一行）', () => {
  const c = ctx();
  it('A./B./C./D. 在同一行也能拆出四个选项', () => {
    const r = M._splitInlineOptions.call(c, '从逻辑上可以把数据结构分成（）。A. 动态结构和静态结构 B. 紧凑结构 C. 线性结构和非线性结构 D. 内部结构');
    expect(r).toBeTruthy();
    expect(r.stem).toBe('从逻辑上可以把数据结构分成（）。');
    expect(r.options.map((o) => o.key)).toEqual(['A', 'B', 'C', 'D']);
    expect(r.options[2].text).toBe('线性结构和非线性结构');
  });
  it('只有 A/B 两个不认（防止正文里偶然出现的「A.」被误判）', () => {
    expect(M._splitInlineOptions.call(c, '设点 A. 与点 B. 重合')).toBe(null);
  });
  it('乱序或跳号不认', () => {
    expect(M._splitInlineOptions.call(c, '甲 C. 丙 A. 甲 B. 乙')).toBe(null);
  });
  it('A 前面没有题干不认', () => {
    expect(M._splitInlineOptions.call(c, 'A. 甲 B. 乙 C. 丙')).toBe(null);
  });
  it('数学式子里的字母不会被误当选项', () => {
    expect(M._splitInlineOptions.call(c, '求 $\\lim_{x\\to0}\\frac{\\sin x}{x}$ 的值.')).toBe(null);
  });
});

describe('括号题号：选择题小节要拆，多问题不能拆', () => {
  it('数据结构式：「N. 选择题」下的（1）（2）各自成题，选项归位', () => {
    const md = ['## 习题', '5. 选择题',
      '（1）在数据结构中，从逻辑上可以把数据结构分成（）。A. 动态结构 B. 紧凑结构 C. 线性结构 D. 内部结构',
      '（2）与数据元素本身无关的是数据的（ ）。A. 存储结构 B. 存储实现 C. 逻辑结构 D. 运算实现'].join('\n\n');
    const qs = parse(md);
    expect(qs.length).toBe(2);
    expect(qs.every((q) => q.type === 'single_choice')).toBe(true);
    expect(qs.every((q) => q.options.length === 4)).toBe(true);
    expect(qs[0].stem).toBe('在数据结构中，从逻辑上可以把数据结构分成（）。');
    expect(qs.some((q) => /选择题/.test(q.stem))).toBe(false);      // 小标题本身不该成题
  });

  it('数据结构式：「## 1. 选择题」是标题时同样生效', () => {
    const md = ['## 习题', '## 1. 选择题',
      '（1）顺序表中第一个元素的存储地址是100，则第5个元素的地址是（ ）。A. 110 B. 108 C. 100 D. 120',
      '（2）在含n个节点的顺序表中，时间复杂度是 $O(1)$ 的操作是（）。A. 访问 B. 插入 C. 删除 D. 排序'].join('\n\n');
    const qs = parse(md);
    expect(qs.length).toBe(2);
    expect(qs[1].options.map((o) => o.key)).toEqual(['A', 'B', 'C', 'D']);
  });

  it('高数式：「N. 主题干：」下的 (1)(2) 是子项，必须留在同一道题里', () => {
    const md = ['## 习题1-3 函数的极限', '1. 根据函数极限的定义证明：',
      '(1) $\\lim_{x\\to\\infty}\\frac{1+x^3}{2x^3}=\\frac12$ ;', '(2) $\\lim_{x\\to0}x\\sin\\frac1x=0$ .',
      '解 (1) 略. (2) 略.'].join('\n\n');
    const qs = parse(md);
    expect(qs.length).toBe(1);                       // 不能拆成 2 道
    expect(qs[0].stem).toContain('(1)');
    expect(qs[0].stem).toContain('(2)');
    expect(qs[0].answer.length).toBe(1);             // 共享的「解」还挂着
  });

  it('「填空：(1)(2)」不拆——拆了会让 N-1 项丢答案、解答全压最后一项', () => {
    const md = ['## 习题', '3. 填空：', '(1) $\\int x^3e^xdx=$ \\_\\_\\_\\_；', '(2) $\\int\\frac{x+5}{x^2}dx=$ \\_\\_\\_\\_.',
      '解 (1) 见下. (2) 见下.'].join('\n\n');
    const qs = parse(md);
    expect(qs.length).toBe(1);
    expect(qs[0].answer.length).toBe(1);
  });

  it('习题区之外的括号列表不算题（正文里的算法步骤）', () => {
    const md = ['## 4.3.3 串的模式匹配算法', '算法步骤如下：',
      '（1）初始化 i=1, j=1。', '（2）比较 S[i] 与 T[j]。', '（3）若相等则继续。'].join('\n\n');
    expect(parse(md).length).toBe(0);
  });

  it('章标题会关掉习题区，之后的括号列表不再成题', () => {
    const md = ['## 习题', '1. 选择题', '（1）甲（）。A. a B. b C. c D. d',
      '## 第5章 树和二叉树', '算法步骤：', '（1）初始化。', '（2）遍历。'].join('\n\n');
    const qs = parse(md);
    expect(qs.length).toBe(1);
    expect(qs[0].stem).toBe('甲（）。');
  });
});

describe('_isChoiceLabel / _isSectionLabel 边界', () => {
  const c = ctx();
  it('选择/判断算 choice，填空/简答不算', () => {
    for (const t of ['选择题', '1. 选择题', '单项选择题', '（一）判断题', '判断']) expect(M._isChoiceLabel.call(c, t)).toBe(true);
    for (const t of ['填空题', '填空：', '简答题', '计算题', '根据定义证明：']) expect(M._isChoiceLabel.call(c, t)).toBe(false);
  });
  it('小标题类都算 sectionLabel（用于丢掉「只是标题」的空题）', () => {
    for (const t of ['选择题', '填空题', '判断题', '二、简答题', '名词解释']) expect(M._isSectionLabel.call(c, t)).toBe(true);
    for (const t of ['根据定义证明：', '设 $f(x)$ 连续', '求下列极限']) expect(M._isSectionLabel.call(c, t)).toBe(false);
  });
});

describe('参考书目条目过滤（政治理论那本 64 道里 35 道是书目）', () => {
  const c = ctx();
  const R = (t) => M._isRefEntry.call(c, t);

  it('典型「作者：《书名》，出版社，年版。」被认成书目', () => {
    expect(R('邓小平：《对起草〈关于建国以来党的若干历史问题的决议〉的意见》，《三中全会以来重要文献选编》上，中央文献出版社2011年版。')).toBe(true);
    expect(R('习近平：《在纪念毛泽东同志诞辰120周年座谈会上的讲话》，人民出版社2013年版。')).toBe(true);
    expect(R('《中国共产党中央委员会关于建国以来党的若干历史问题的决议》，《三中全会以来重要文献选编》下，中央文献出版社2011年版。')).toBe(true);
  });

  it('书名里带问号也要认（必须先剥书名号再判设问）', () => {
    // 《人的正确思想是从哪里来的？》——问号在书名里，不代表这是道题
    expect(R('毛泽东：《人的正确思想是从哪里来的？》，《毛泽东文集》第八卷，人民出版社1999年版。')).toBe(true);
  });

  it('真思考题不能被误删', () => {
    for (const t of [
      '毛泽东思想形成和发展的社会历史条件是什么？',
      '如何科学认识毛泽东思想的历史地位？',
      '什么是新民主主义革命的总路线？',
      '试述《矛盾论》中关于主要矛盾的基本观点。',            // 引了书名但是道题
      '结合《实践论》谈谈你对认识过程的理解。',
    ]) expect(R(t)).toBe(false);
  });

  it('没有书名号、或没有出版信息的都不算书目', () => {
    expect(R('人民出版社2013年版')).toBe(false);              // 无书名号
    expect(R('《矛盾论》第三节')).toBe(false);                 // 无出版信息
  });

  it('过长的段落不判（避免把正文误删）', () => {
    expect(R('《邓小平文选》第二卷，人民出版社1994年版。' + '正文'.repeat(120))).toBe(false);
  });

  it('mdToQuestions 会把书目条目从结果里剔掉', () => {
    const md = ['## 思考题', '1. 毛泽东思想形成和发展的社会历史条件是什么？', '2. 如何把握毛泽东思想的主要内容和活的灵魂？',
      '## 阅读文献', '1. 邓小平：《对起草〈决议〉的意见》，《三中全会以来重要文献选编》上，中央文献出版社2011年版。',
      '2. 习近平：《在纪念毛泽东同志诞辰120周年座谈会上的讲话》，人民出版社2013年版。'].join('\n\n');
    const qs = parse(md);
    expect(qs.length).toBe(2);
    expect(qs.every((q) => /？$/.test(q.stem))).toBe(true);
  });
});

describe('抽题按钮的忙碌态（原来只在导入时置位，抽题阶段按钮可点 → 用户连点）', () => {
  function busyCtx(overrides) {
    return Object.assign(Object.create(M), {
      token: 't', bookExtract: { busy: false, prog: '', done: 0, total: 0 },
      extractPreview: {}, flash() {}, matMissingCount: () => 0,
      _yieldToPaint: () => Promise.resolve(),
      currentBook: { title: 'b', subject: 'x', pages: [{ page: 1, content_md: '1. 求下列极限.\n\n解 略.' }] },
      currentPageMat: { page: 1, subject: 'x', content_md: '1. 求下列极限.\n\n解 略.', title: 'p1' },
      async ensureBookContent() { await new Promise((r) => setTimeout(r, 5)); },
    }, overrides || {});
  }

  it('localExtractBook 全程置 busy，结束后复位', async () => {
    const c = busyCtx();
    const p = M.localExtractBook.call(c);
    expect(c.bookExtract.busy).toBe(true);              // 同步就要置上，否则这一帧按钮还是可点的
    await p;
    expect(c.bookExtract.busy).toBe(false);
    expect(c.bookExtract.prog).toBe('');
  });

  it('busy 期间重复点击直接返回，不会并发跑第二遍', async () => {
    const c = busyCtx();
    let calls = 0;
    c.ensureBookContent = async () => { calls++; await new Promise((r) => setTimeout(r, 5)); };
    const a = M.localExtractBook.call(c);
    const b = M.localExtractBook.call(c);               // 连点
    const d = M.localExtractBook.call(c);
    await Promise.all([a, b, d]);
    expect(calls).toBe(1);
  });

  it('localExtractPage 同样有忙碌态与防重入', async () => {
    const c = busyCtx();
    let calls = 0;
    c.ensureBookContent = async () => { calls++; await new Promise((r) => setTimeout(r, 5)); };
    const a = M.localExtractPage.call(c);
    expect(c.bookExtract.busy).toBe(true);
    await Promise.all([a, M.localExtractPage.call(c)]);
    expect(calls).toBe(1);
    expect(c.bookExtract.busy).toBe(false);
  });

  it('抛异常也要复位 busy，不能把按钮永久锁死', async () => {
    const c = busyCtx({ ensureBookContent: async () => { throw new Error('boom'); } });
    await M.localExtractBook.call(c).catch(() => {});
    expect(c.bookExtract.busy).toBe(false);
  });

  it('进重活之前会让出一帧，好让 spinner 画出来', async () => {
    const order = [];
    const c = busyCtx({ _yieldToPaint: () => { order.push('yield'); return Promise.resolve(); } });
    c.mdToQuestions = function (...a) { order.push('parse'); return M.mdToQuestions.apply(this, a); };
    await M.localExtractPage.call(c);
    expect(order[0]).toBe('yield');
    expect(order.indexOf('parse')).toBeGreaterThan(0);
  });
});
