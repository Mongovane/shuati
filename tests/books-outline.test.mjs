// Books 内联目录：parseBookOutline 解析 + bookGotoBookPage 就近跳转（js/views/books.js）
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const Books = new Function(fs.readFileSync(path.join(ROOT, 'js/views/books.js'), 'utf8') + ';return BooksMixin;')();

describe('parseBookOutline 目录页解析', () => {
  const P = Books.methods.parseBookOutline;
  it('解析「标题 …… 页码」为 {title,page,level}', () => {
    const toc = '第八章 向量代数与空间解析几何 …… 3 习题8-1 向量及其线性运算 …… 3 习题8-2 数量积 …… 8 总习题八 …… 28';
    const out = P.call({}, toc);
    expect(out.length).toBe(4);
    expect(out[0]).toEqual({ title: '第八章 向量代数与空间解析几何', page: 3, level: 0 });
    expect(out[1].title).toBe('习题8-1 向量及其线性运算');
    expect(out[1].level).toBe(1);   // 习题缩进一级
    expect(out[3]).toEqual({ title: '总习题八', page: 28, level: 1 });
  });
  it('识别"第X节"为二级（缩进到章下）', () => {
    const toc = '第一章　函数与极限 …… 1 第一节　映射与函数 …… 1 第二节　数列的极限 …… 18 总习题一 …… 68 第二章　导数与微分 …… 71 第一节　导数概念 …… 71';
    const out = P.call({}, toc);
    const byTitle = (t) => out.find((o) => o.title.includes(t));
    expect(byTitle('第一章').level).toBe(0);
    expect(byTitle('第一节　映射').level).toBe(1);
    expect(byTitle('第二节　数列').level).toBe(1);
    expect(byTitle('总习题一').level).toBe(1);
    expect(byTitle('第二章').level).toBe(0);
  });
  it('多页目录拼接后，后半部分章节不丢（模拟目录跨页）', () => {
    const tocPage1 = '第1章 绪论 …… 1 1.1 概述 …… 3 第2章 算法 …… 15 3.2 数据 …… 39';
    const tocPage2 = '第4章 循环结构 …… 41 4.1 while 语句 …… 42 第10章 文件 …… 380';
    const out = P.call({}, tocPage1 + '\n' + tocPage2);
    const titles = out.map((o) => o.title);
    expect(titles.some((t) => t.startsWith('第4章'))).toBe(true);
    expect(titles.some((t) => t.startsWith('第10章'))).toBe(true);
    expect(out[out.length - 1].page).toBe(380);
  });
  it('多级层级：章=0，"1 xx"=1，"2.2 xx"=2，习题=1', () => {
    const toc = '第2章 算法 …… 15 1 什么是算法 …… 16 2.2 数据的表现形式 …… 39 习题 …… 35';
    const out = P.call({}, toc);
    const byTitle = (t) => out.find((o) => o.title.startsWith(t));
    expect(byTitle('第2章').level).toBe(0);
    expect(byTitle('1 什么是算法').level).toBe(1);
    expect(byTitle('2.2').level).toBe(2);
    expect(byTitle('习题').level).toBe(1);
  });
  it('兼容英文点号引导 .... 与全角省略号 ……', () => {
    expect(P.call({}, 'Chapter 1 .... 5').length).toBe(1);
    expect(P.call({}, '第一章 绪论 …… 1')[0].page).toBe(1);
  });
  it('空文本 / 无页码 → 空数组', () => {
    expect(P.call({}, '')).toEqual([]);
    expect(P.call({}, '这是一段没有目录结构的正文内容')).toEqual([]);
  });
  it('最多 400 条，防超长目录卡顿', () => {
    const toc = Array.from({ length: 500 }, (_, i) => `条目${i} …… ${i + 1}`).join(' ');
    expect(P.call({}, toc).length).toBe(400);
  });
});

describe('bookGotoBookPage 就近跳转', () => {
  it('跳到「书内页码 ≤ 目标」的最大页那一篇', () => {
    let gotoIdx = -1;
    const ctx = {
      currentBook: { pages: [{ page: 1 }, { page: 3 }, { page: 8 }, { page: 12 }] },
      bookGoto(i) { gotoIdx = i; }, bookTocOpen: true,
    };
    Books.methods.bookGotoBookPage.call(ctx, 5);   // 页码 5 落在第 3 页(idx1)和第 8 页(idx2)之间 → 取 ≤5 的最大 = 第3页
    expect(gotoIdx).toBe(1);
    Books.methods.bookGotoBookPage.call(ctx, 8);
    expect(gotoIdx).toBe(2);
    expect(ctx.bookTocOpen).toBe(false);
  });
  it('目标小于所有页码 → 落到第一篇', () => {
    let gotoIdx = -1;
    const ctx = { currentBook: { pages: [{ page: 3 }, { page: 8 }] }, bookGoto(i) { gotoIdx = i; } };
    Books.methods.bookGotoBookPage.call(ctx, 1);
    expect(gotoIdx).toBe(0);
  });
});

describe('pageLabel 标题清理（HTML 标签不泄漏）', () => {
  const P = Books.methods.pageLabel;
  const ctx = { _mineruJunk: () => false };
  it('跳过 <figure>/<img> 等标签行，取后面的真实标题', () => {
    expect(P.call(ctx, { content_md: '<figure class="fig"><img src="x"></figure>\n第七章 微分方程', page: 130 }))
      .toBe('第七章 微分方程 · 第130页');
  });
  it('整页只有 HTML 标签时回退到页码', () => {
    expect(P.call(ctx, { content_md: '<figure><img></figure>', page: 5, title: 'x' })).toBe('第5页');
  });
  it('剥离行内 HTML 标签', () => {
    expect(P.call(ctx, { content_md: '<span>正文</span>标题内容', page: 3 })).toContain('第3页');
  });
  it('正常中文标题不受影响', () => {
    expect(P.call(ctx, { content_md: '第八章 向量代数', page: 10 })).toBe('第八章 向量代数 · 第10页');
  });
});

describe('deleteBook 删除指定书', () => {
  it('删除时若是当前打开的书则退出阅读，并清本地阅读位置', async () => {
    global.confirm = () => true;
    const removed = [];
    global.localStorage = { removeItem: (k) => removed.push(k) };
    const calls = [];
    const ctx = { token: 't', currentBookId: 'k1', bookIdx: 5,
      async api(url, opt) { calls.push({ url, method: opt.method, body: JSON.parse(opt.body) }); return { deleted: 2 }; },
      async loadMaterials() {}, flash() {} };
    const book = { key: 'k1', title: '高数', pages: [{ id: 'a' }, { id: 'b' }] };
    await Books.methods.deleteBook.call(ctx, book);
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].body.ids).toEqual(['a', 'b']);
    expect(ctx.currentBookId).toBe('');
    expect(removed).toContain('zb_readpos:k1');
  });
  it('删非当前书时不退出当前阅读', async () => {
    global.confirm = () => true;
    global.localStorage = { removeItem() {} };
    const ctx = { token: 't', currentBookId: 'other', bookIdx: 3,
      async api() { return { deleted: 1 }; }, async loadMaterials() {}, flash() {} };
    await Books.methods.deleteBook.call(ctx, { key: 'k9', title: 'x', pages: [{ id: 'z' }] });
    expect(ctx.currentBookId).toBe('other');
  });
  it('用户取消确认则不删除', async () => {
    global.confirm = () => false;
    const calls = [];
    const ctx = { token: 't', async api(u, o) { calls.push(o.method); return {}; }, async loadMaterials() {}, flash() {} };
    await Books.methods.deleteBook.call(ctx, { key: 'k', title: 'x', pages: [{ id: 'a' }] });
    expect(calls.length).toBe(0);
  });
});

describe('pickBookSubject 弹窗选分类（含自定义）', () => {
  it('选四科之一：应用并关弹窗', async () => {
    let applied = null;
    const ctx = { bookSubjPick: { open: true, book: { key: 'k', subject: 'politics' }, custom: '' },
      async _setBookSubjectPages(b, s) { applied = { key: b.key, s }; }, flash() {} };
    await Books.methods.pickBookSubject.call(ctx, 'math');
    expect(ctx.bookSubjPick.open).toBe(false);
    expect(applied).toEqual({ key: 'k', s: 'math' });
  });
  it('自定义分类：trim 后应用', async () => {
    let applied = null;
    const ctx = { bookSubjPick: { open: true, book: { key: 'k', subject: 'math' }, custom: '  说明书 ' },
      async _setBookSubjectPages(b, s) { applied = s; }, flash() {} };
    await Books.methods.pickBookSubject.call(ctx, '  说明书 ');
    expect(applied).toBe('说明书');
    expect(ctx.bookSubjPick.custom).toBe('');
  });
  it('选相同分类：只关弹窗、不改', async () => {
    let called = false;
    const ctx = { bookSubjPick: { open: true, book: { key: 'k', subject: 'math' }, custom: '' },
      async _setBookSubjectPages() { called = true; }, flash() {} };
    await Books.methods.pickBookSubject.call(ctx, 'math');
    expect(called).toBe(false);
  });
  it('空值：提示且不应用', async () => {
    let called = false, flashed = false;
    const ctx = { bookSubjPick: { open: true, book: { key: 'k', subject: 'math' }, custom: '' },
      async _setBookSubjectPages() { called = true; }, flash() { flashed = true; } };
    await Books.methods.pickBookSubject.call(ctx, '   ');
    expect(called).toBe(false);
    expect(flashed).toBe(true);
  });
});

describe('bookReadPct 阅读进度（当前书用实时 bookIdx）', () => {
  // bookReadPct 在 app.js，这里复制其纯逻辑做等价校验（防回归参考）
  function pct(ctx, b) {
    let i;
    if (ctx.currentBookId === b.key) i = ctx.bookIdx;
    else { const s = ctx.store['zb_readpos:' + b.key]; if (s == null) return ''; i = parseInt(s, 10) || 0; }
    if (!b.pages || !b.pages.length || i <= 0) return '';
    const p = Math.min(100, Math.round((i + 1) / b.pages.length * 100));
    return p >= 100 ? '读完' : ('读到 ' + p + '%');
  }
  it('正在读的书用实时 bookIdx，不受 localStorage 滞后影响', () => {
    const ctx = { currentBookId: 'k', bookIdx: 9, store: { 'zb_readpos:k': '0' } };
    const b = { key: 'k', pages: new Array(100) };
    expect(pct(ctx, b)).toBe('读到 10%');   // (9+1)/100，用实时 idx 而非 store 里的 0
  });
  it('非当前书用 localStorage 快照', () => {
    const ctx = { currentBookId: 'other', bookIdx: 0, store: { 'zb_readpos:k': '49' } };
    const b = { key: 'k', pages: new Array(100) };
    expect(pct(ctx, b)).toBe('读到 50%');
  });
  it('无记录返回空', () => {
    const ctx = { currentBookId: 'other', bookIdx: 0, store: {} };
    expect(pct(ctx, { key: 'k', pages: new Array(10) })).toBe('');
  });
});

describe('PDF 目录页码偏移校正（扫描版书签粗时回退）', () => {
  it('偏移 = 书签首章PDF页 - 目录文本首章书内页，应用到所有条目', () => {
    // 模拟：书签里"第一章"在 PDF 第18页；目录文本里"第一章"书内页1、"第一节"书内页1、"第二节"18
    const bookmarks = [{ title: '第1章 函数与极限', page: 18, level: 0 }];
    const textItems = [
      { title: '第一章　函数与极限', page: 1, level: 0 },
      { title: '第一节　映射与函数', page: 1, level: 1 },
      { title: '第二节　数列的极限', page: 18, level: 1 },
    ];
    // 复刻 pdfvOutlineFromText 的偏移算法
    const bm1 = bookmarks.find((b) => /^第[一二三四五六七八九十百零\d]+\s*[章篇]/.test(b.title));
    const tx1 = textItems.find((o) => o.level === 0);
    const offset = (bm1 && tx1) ? bm1.page - tx1.page : 0;
    expect(offset).toBe(17);
    const mapped = textItems.map((o) => ({ ...o, page: o.page + offset }));
    expect(mapped[0].page).toBe(18);   // 第一章 → PDF 18
    expect(mapped[1].page).toBe(18);   // 第一节 → PDF 18
    expect(mapped[2].page).toBe(35);   // 第二节 书内18 → PDF 35
  });
});
