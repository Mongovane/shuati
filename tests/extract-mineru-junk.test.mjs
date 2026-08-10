// 广东专升本英语真题（MinerU vlm 输出）暴露的四个抽题缺陷的回归基线。
// 这份卷子和高数/数据结构那两本的区别在于：
//   · 每页顶部和底部都有网站水印，MinerU 会把它当正文吐出来
//   · 卷末「参考答案与名家精析」被输出成普通正文行，不是 # 标题
//   · 完形填空的选项独占一行、行首就是 A.，前面没有题干
//   · 阅读短文内部有 Spain / Denmark / Germany 这类国家小标题
// 线上实测后果：46 题里混进大量「题干=【精析】…」的假题，真题全部无答案。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const Ingest = new Function(fs.readFileSync(path.join(ROOT, 'js/views/ingest.js'), 'utf8') + ';return IngestMixin;')();
const M = Ingest.methods;
const ctx = () => Object.assign(Object.create(M), { extractPreview: {}, extractSkippedToc: 0, flash() {} });
// 直接喂 Markdown：用来验证「即使水印没洗掉」解析器自身也不能崩
const parse = (md) => M.mdToQuestions.call(ctx(), md, { subject: 'english', source: '2022广东专升本英语', page: 1 });
// 走真实整本链路：_extractWholeBook 会先剥页眉页脚再拼流，线上就是这条路
const parseBook = (pages) => M._extractWholeBook.call(ctx(), {
  subject: 'english', title: '2022广东专升本英语',
  pages: pages.map((content_md, i) => ({ page: i + 1, content_md })),
});

const WM = '广东专插本考试信息网(广东普通专升本考试信息网): www.gzzkgk.cn 电话: 15374053589';

// —— 真题结构的最小复刻（页 1 阅读 / 页 4 完形 / 页 6 答案区）——
const PAGE1 = `${WM}

# 第一部分 阅读（阅读理解，满分40分）

# 第一节 （共10小题；每小题2分，满分20分）

阅读下列短文，从每题所给的 A、B、C、D 四个选项中选出最佳选项。

# A

If you are considering businesses in foreign markets, it is necessary to know the customs and traditions of the locals when it comes to New Year's Day celebrations.

# Greece

People in Greece bake a special St. Basil's Cake with a coin hidden inside it. Whoever finds the coin in his or her piece will be lucky throughout the coming year.

${WM}
1`;

const PAGE2 = `${WM}

# Germany

Every year, millions of people flock to Berlin to see one of the most wonderful firework shows in the world. Some people drop melted lead into cold water and read the shape it forms.

1. What might Greeks find in St. Basil's Cake on New Year's Day?
A. A grape.
B. A ring.
C. A coin.
D. A tooth.

2. What does a pig shape of melted lead indicate in Germany?
A. Someone will marry soon.
B. Someone will strike the clock.
C. Someone will have sufficient food.
D. Someone will jump off the chair.

${WM}
2`;

const PAGE3 = `${WM}

# 第二节 （共5小题；每小题2分，满分10分）

Mary was a busy student who spent most of her free time on 21 rather than 22 . Her roommates found her 23 at first, but after she 24 a novel from the library everything changed.

21. A. cooking B. cleaning C. jobs D. exercise
22. A. housework B. experiments C. assignments D. research
23. A. communicative B. boring C. happy D. aggressive
24. A. published B. selected C. borrowed D. bought

${WM}
3`;

// 注意：「参考答案与名家精析」是普通正文行，不是 # 标题——MinerU 的真实输出就是这样
const PAGE4 = `${WM}

参考答案与名家精析

1. 【精析】C 由 Greece 段 "a coin hidden inside it" 可知，故选 C。

${WM}

2. 【精析】C 由 Germany 段可知猪的形状代表食物充足。故选 C。

${WM}
4`;

const PAGE5 = `${WM}

21. 【精析】B 空前提到"第一部有声电影《爵士歌王》于1927年上映"，所以B项承接上文，符合语境。故选B。

${WM}

22. [考点] 词义辨析题
${WM}
【精析】D 句意：在过去的五十年，心理学家让我们相信，男女之间的差异主要是由我们被养育的方式造成的。根据句意可知，选 D。

${WM}
5`;

const PAGES = [PAGE1, PAGE2, PAGE3, PAGE4, PAGE5];
const FULL = PAGES.join('\n\n');

describe('页眉页脚水印（跨页重复行）', () => {
  it('每页首尾重复出现的水印会被整本剥掉', () => {
    const c = ctx();
    const cleaned = M._stripPageFurniture.call(c, PAGES);
    expect(cleaned.join('\n')).not.toContain('gzzkgk.cn');
  });
  it('只出现一两次的正文行不会被误删', () => {
    const c = ctx();
    const pages = ['独有的一行正文\n公共页脚', '公共页脚\n别的正文', '公共页脚', '公共页脚', '公共页脚'];
    const cleaned = M._stripPageFurniture.call(c, pages);
    expect(cleaned.join('\n')).toContain('独有的一行正文');
    expect(cleaned.join('\n')).not.toContain('公共页脚');
  });
  it('页数太少时不做剥离（样本不足，容易误伤）', () => {
    const c = ctx();
    expect(M._stripPageFurniture.call(c, ['a\nb', 'a\nc'])).toEqual(['a\nb', 'a\nc']);
  });
});

describe('答案区识别', () => {
  it('「参考答案与名家精析」是普通正文行时也要切进答案区', () => {
    const qs = parseBook(PAGES);
    const leaked = qs.filter((q) => /【\s*精\s*析\s*】|\[\s*考\s*点\s*\]/.test(q.stem));
    expect(leaked).toEqual([]);
  });
  it('水印夹在两条【精析】之间也不能打断连续性判定（无标题兜底）', () => {
    const noHead = FULL.replace('参考答案与名家精析\n', '');
    const qs = parse(noHead);
    expect(qs.filter((q) => /【\s*精\s*析\s*】/.test(q.stem))).toEqual([]);
  });
  it('解析按题号回填到对应题目', () => {
    const qs = parse(FULL);
    const q1 = qs.find((q) => /St. Basil's Cake/.test(q.stem));
    expect(q1).toBeTruthy();
    expect(q1.answer).toEqual(['C']);
    expect(q1.analysis).toContain('Greece');
  });
  it('教材里偶发一条【精析】不会把后文全吞掉', () => {
    const md = '1. 求极限。\n\n【精析】用洛必达法则。\n\n2. 求导数。\n\n3. 求积分。';
    const qs = parse(md);
    expect(qs.length).toBeGreaterThanOrEqual(2);
    expect(qs.some((q) => /求导数/.test(q.stem))).toBe(true);
  });
});

describe('完形填空（行首即 A. 的孤儿选项行）', () => {
  it('不再退化成「题干=A. cooking B. cleaning…」的废简答题', () => {
    const qs = parseBook(PAGES);
    const junk = qs.filter((q) => q.type === 'short_answer' && /^A\s*[.．]\s*\S/.test(q.stem));
    expect(junk).toEqual([]);
  });
  it('挂得上短文时重建成带选项的单选', () => {
    const qs = parseBook(PAGES);
    const c21 = qs.find((q) => /第\s*21\s*空/.test(q.stem));
    expect(c21).toBeTruthy();
    expect(c21.type).toBe('single_choice');
    expect(c21.options.map((o) => o.key)).toEqual(['A', 'B', 'C', 'D']);
    expect(c21.options[0].text).toBe('cooking');
    expect(c21.passage).toContain('Mary was a busy student');
    expect(c21.answer).toEqual(['B']);
    expect(c21.page).toBe(3); // 合成题干也要能定位回原页
  });
  it('挂不上短文的孤儿选项行直接丢弃，不污染题库', () => {
    const qs = parse('# 第二节\n\n31. A. cooking B. cleaning C. jobs D. exercise\n');
    expect(qs).toEqual([]);
  });
});

describe('完形填空空位标记', () => {
  const U = '\uFF3F';
  it('短文里属于空的数字被标出来，正文里的真实数字不动', () => {
    const qs = parseBook(PAGES);
    const p = qs.find((q) => /第\s*21\s*空/.test(q.stem)).passage;
    expect(p).toContain(U + U + '21' + U + U);
    expect(p).toContain(U + U + '24' + U + U);
  });
  it('同一段短文下所有题共享同一份标记好的材料', () => {
    const qs = parseBook(PAGES).filter((q) => /完形填空/.test(q.stem));
    expect(new Set(qs.map((q) => q.passage)).size).toBe(1);
  });
  it('正文里的真实数字不会被当成空', () => {
    const c = ctx();
    const qs = [{ stem: '（完形填空 第 2 空）', passage: '影片于 1927 年上映，票价 25 元，第 2 幕最精彩。' }];
    M._markClozeBlanks.call(c, qs);
    expect(qs[0].passage).toContain('1927');
    expect(qs[0].passage).not.toContain(U + U + '19');
    expect(qs[0].passage).toContain(U + U + '2' + U + U + ' 幕');
  });
  it('标记用全角下划线，避免被 marked 当成粗体吃掉', () => {
    const qs = parseBook(PAGES);
    const p = qs.find((q) => /第\s*21\s*空/.test(q.stem)).passage;
    expect(p).not.toMatch(/__\d+__/); // ASCII 下划线会被 marked 解析成 <strong>
  });
  it('非完形填空的题不受影响', () => {
    const qs = parseBook(PAGES);
    const q1 = qs.find((q) => /St. Basil's Cake/.test(q.stem));
    expect(q1.passage).not.toContain(U);
  });
});

describe('阅读材料关联', () => {
  it('国家小标题不再清空 passage —— 问希腊的题挂的是希腊那段', () => {
    const qs = parseBook(PAGES);
    const q1 = qs.find((q) => /St. Basil's Cake/.test(q.stem));
    expect(q1.passage).toContain('Greece');
    expect(q1.passage).toContain('coin hidden inside');
  });
  it('「第X节」这类真正的分篇标记仍然重置 passage', () => {
    const qs = parseBook(PAGES);
    const c21 = qs.find((q) => /第\s*21\s*空/.test(q.stem));
    expect(c21.passage).not.toContain('St. Basil');
  });
});

describe('整卷汇总', () => {
  it('抽出来的每一道题都有答案、且没有一道是垃圾', () => {
    const qs = parseBook(PAGES);
    expect(qs.length).toBe(6); // 阅读 2 + 完形 4
    expect(qs.filter((q) => !(q.answer && q.answer.length)).length).toBe(2); // 23/24 题解析缺失，属实
    expect(qs.every((q) => q.stem && !/gzzkgk/.test(q.stem))).toBe(true);
  });
});
