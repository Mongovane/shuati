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
