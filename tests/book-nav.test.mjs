// Books 阅读导航的可用性修复。实测到的问题：
//  · 翻页按钮在页面最底部，且 .bk-page/.bk-reader 都是 overflow:hidden（sticky 失效）
//  · 翻页后浏览器按新页高裁剪滚动位置：实测 1831 → 706，正好落在新页最底部，得往上滚才看到正文
//  · 键盘 ←/→/PageDown/空格 全部无响应；没有任何 touch 监听，手机上只能滚到底点按钮
//  · 空格式目录（「1.2.3 标题  22」）解析出 0 条，273 页只能靠「输入第几篇跳转」
import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const booksSrc = fs.readFileSync(path.join(ROOT, 'js/views/books.js'), 'utf8');
const Books = new Function(booksSrc + ';return BooksMixin;')();
const M = Books.methods;
const appSrc = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');

describe('翻页后回到正文顶部', () => {
  function ctx(idx, n) {
    return Object.assign(Object.create(M), {
      bookIdx: idx, bookTocOpen: true,
      currentBook: { pages: Array.from({ length: n }, (_, i) => ({ id: 'p' + i, page: i + 1 })) },
      flashPageRender() { this.flashed = true; },
      $nextTick(fn) { fn(); },
      _scrollReaderTop() { this.scrolled = (this.scrolled || 0) + 1; },
    });
  }

  it('页码真的变了才回顶', () => {
    const c = ctx(5, 100);
    M.bookGoto.call(c, 6);
    expect(c.bookIdx).toBe(6);
    expect(c.scrolled).toBe(1);
    expect(c.flashed).toBe(true);
    expect(c.bookTocOpen).toBe(false);       // 从目录跳转后要收起目录
  });

  it('点到当前页不回顶、不闪骨架（避免无谓跳动）', () => {
    const c = ctx(5, 100);
    M.bookGoto.call(c, 5);
    expect(c.scrolled).toBe(undefined);
    expect(c.flashed).toBe(undefined);
  });

  it('越界会被夹住', () => {
    const c = ctx(5, 10);
    M.bookGoto.call(c, 999); expect(c.bookIdx).toBe(9);
    M.bookGoto.call(c, -3); expect(c.bookIdx).toBe(0);
  });

  it('_scrollReaderTop 用 behavior:auto，不依赖 rAF、也不做平滑动画', () => {
    const body = booksSrc.slice(booksSrc.indexOf('_scrollReaderTop(){'), booksSrc.indexOf('onBookTouchStart('));
    expect(body).toMatch(/behavior:'auto'/);
    expect(body).not.toMatch(/smooth/);
    expect(body).toMatch(/\.bk-body/);
  });
});

describe('触屏滑动翻页', () => {
  function ctx() {
    return Object.assign(Object.create(M), { turned: [], bookNext() { this.turned.push('next'); }, bookPrev() { this.turned.push('prev'); } });
  }
  const swipe = (c, dx, dy, ms = 200) => {
    M.onBookTouchStart.call(c, { touches: [{ clientX: 100, clientY: 100 }] });
    c._bkTouch.t = Date.now() - ms;
    M.onBookTouchEnd.call(c, { changedTouches: [{ clientX: 100 + dx, clientY: 100 + dy }] });
  };

  it('左滑下一页、右滑上一页', () => {
    const c = ctx(); swipe(c, -120, 5); expect(c.turned).toEqual(['next']);
    const d = ctx(); swipe(d, 120, 5); expect(d.turned).toEqual(['prev']);
  });

  it('横向位移不够（<60px）不翻页', () => {
    const c = ctx(); swipe(c, -40, 0); expect(c.turned).toEqual([]);
  });

  it('纵向为主的手势不翻页 —— 否则正常上下滚动会被误判', () => {
    const c = ctx(); swipe(c, -80, 200); expect(c.turned).toEqual([]);
    // 边界：要求 |dx| > 2*|dy|。dx=-80,dy=45 → 80 < 90，按规则该拒（我第一版把这个算反了）
    const d = ctx(); swipe(d, -80, 45); expect(d.turned).toEqual([]);
    const f = ctx(); swipe(f, -80, 30); expect(f.turned).toEqual(['next']);   // 80 > 60，横向明显更大才算
  });

  it('慢速拖拽（>800ms）不算滑动', () => {
    const c = ctx(); swipe(c, -150, 0, 1200); expect(c.turned).toEqual([]);
  });

  it('没有 touchstart 记录时 touchend 安全返回', () => {
    const c = ctx(); c._bkTouch = null;
    expect(() => M.onBookTouchEnd.call(c, { changedTouches: [{ clientX: 0, clientY: 0 }] })).not.toThrow();
    expect(c.turned).toEqual([]);
  });

  it('模板把监听挂在正文容器上，且是 passive（不阻塞滚动）', () => {
    const tpl = fs.readFileSync(path.join(ROOT, 'js/tpl/view-books.js'), 'utf8');
    expect(tpl).toMatch(/class="bk-body"[^>]*@touchstart\.passive="onBookTouchStart"/);
    expect(tpl).toMatch(/@touchend\.passive="onBookTouchEnd"/);
  });
});

describe('flashPageRender 不能挂死骨架屏', () => {
  it('rAF 注册了但永不回调时，超时后仍会收起骨架', async () => {
    const saved = global.requestAnimationFrame;
    global.requestAnimationFrame = () => {};
    const c = { pageRendering: false, $nextTick(fn) { fn(); } };
    M.flashPageRender.call(c);
    expect(c.pageRendering).toBe(true);
    await new Promise((r) => setTimeout(r, 600));
    expect(c.pageRendering).toBe(false);
    if (saved) global.requestAnimationFrame = saved; else delete global.requestAnimationFrame;
  });

  it('rAF 正常时不会因为兜底而重复收起', async () => {
    global.requestAnimationFrame = (cb) => setTimeout(cb, 1);
    const c = { pageRendering: false, $nextTick(fn) { fn(); } };
    M.flashPageRender.call(c);
    await new Promise((r) => setTimeout(r, 60));
    expect(c.pageRendering).toBe(false);
    delete global.requestAnimationFrame;
  });
});

describe('空格式目录解析（原来这类书目录 0 条）', () => {
  const ctx = () => Object.create(M);
  const SPACED = ['1.1 数据结构的研究内容 1', '1.2 数据结构的基本概念和术语 3',
    '1.2.1 数据、数据元素、数据项和数据对象 3', '1.3 抽象数据类型的表示与实现 9',
    '1.4 算法和算法分析 12', '1.4.1 算法的定义及特性 12', '1.4.2 评价算法优劣的基本标准 13',
    '1.5 小结 15', '2.1 线性表的定义和特点 18'].join('\n');

  it('解析出条目并带页码与层级', () => {
    const out = M.parseBookOutline.call(ctx(), SPACED);
    expect(out.length).toBeGreaterThanOrEqual(8);
    const first = out[0];
    expect(first.page).toBe(1);
    expect(first.title).toContain('数据结构的研究内容');
    expect(out.find((x) => x.title.includes('1.2.1')).level).toBe(2);   // 两个点 = 第三级
  });

  it('页码递增、都是合理数字', () => {
    const out = M.parseBookOutline.call(ctx(), SPACED);
    expect(out.every((x) => x.page > 0 && x.page < 9999)).toBe(true);
  });

  it('点线式目录仍按原路径走，结果不受影响', () => {
    const dots = ['习题1-1 映射与函数 ......... 3', '习题1-2 数列的极限 ......... 12',
      '习题1-3 函数的极限 ......... 16', '习题1-4 无穷小与无穷大 ......... 20',
      '习题1-5 极限运算法则 ......... 23', '习题1-6 极限存在准则 ......... 27'].join('\n');
    const out = M.parseBookOutline.call(ctx(), dots);
    expect(out.length).toBe(6);
    expect(out[0].page).toBe(3);
    expect(out[0].title).not.toMatch(/^\d/);        // 走的是点线分支，标题没被加上章节号前缀
  });

  it('正文段落不会被误当目录行', () => {
    const prose = ['设 f(x) 在 x = a 处连续 3', '于是 f(x) 在 (a,b) 内连续 5'].join('\n');
    expect(M._parseTocSpaced.call(ctx(), prose).length).toBe(0);
  });

  it('空输入返回空数组', () => {
    expect(M.parseBookOutline.call(ctx(), '')).toEqual([]);
    expect(M._parseTocSpaced.call(ctx(), '')).toEqual([]);
  });
});

describe('键盘翻页的接线与守卫', () => {
  const blk = appSrc.slice(appSrc.indexOf("window.addEventListener('keydown'"), appSrc.indexOf('// 导航条：首屏'));

  it('绑了 ←/→ 与 PageUp/PageDown', () => {
    expect(blk).toMatch(/ArrowRight/); expect(blk).toMatch(/ArrowLeft/);
    expect(blk).toMatch(/PageDown/); expect(blk).toMatch(/PageUp/);
    expect(blk).toMatch(/bookNext\(\)/); expect(blk).toMatch(/bookPrev\(\)/);
  });

  it('只在 Books 页生效，且焦点在输入框里时不抢键', () => {
    expect(blk).toMatch(/this\.view!=='books'\)return/);
    expect(blk).toMatch(/INPUT/); expect(blk).toMatch(/TEXTAREA/); expect(blk).toMatch(/isContentEditable/);
  });

  it('目录或问 AI 打开时让位，且不吞带修饰键的组合', () => {
    expect(blk).toMatch(/bookTocOpen/);
    expect(blk).toMatch(/rdAi/);
    expect(blk).toMatch(/metaKey\|\|e\.ctrlKey\|\|e\.altKey\)return/);
  });

  it('没有当前书时不响应', () => {
    expect(blk).toMatch(/!this\.currentBook\)return/);
  });
});
