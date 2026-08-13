// 整本抽题看起来「卡死」：点完按钮很久没反应，用户不知道进行到哪一步。
//
// 排查结果：进度其实一直在设，但摆错了地方 ——
//  · 载入正文（273 页 / 6.76MB，最慢的一步）的进度条渲染在【书架顶部】的 matProg，
//    而「整本抽题入库」按钮在页面【底栏】，点完往往已经滚不到顶部了；
//    底栏那句又是静态的「正在载入正文 273 页…」，不带计数，看着就像卡住。
//  · 各阶段的提示没有编号，用户不知道总共几步、还剩几步。
//
// 顺带确认：预览渲染不是瓶颈（每页 40 条分页渲染，见 extractPageItems）。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const Books = new Function(read('js/views/books.js') + ';return BooksMixin;')();

describe('载入正文的进度镜像到底栏', () => {
  // 门控必须是 phase==='load'，不能只看 busy。
  // _setProg 还被书架加载（loadMaterials）和任意翻页取正文（_runMatFill）调用，
  // 只看 busy 会造成两个线上实测到的问题：
  //   · 「本页抽题」被贴上「①/④ 正在载入正文」这种整本流程的标签
  //   · 抽题途中切到别的书，新书的正文加载继续往底栏写抽题进度，
  //     每本书底下都显示同一句，看着像卡住
  const mk = (phase) => ({ bookExtract: { busy: !!phase, phase: phase || '', prog: '', done: 0, total: 0 }, matProg: {} });
  it('载入阶段：底栏显示实时页数和百分比', () => {
    const c = mk('load');
    Books.methods._setProg.call(c, 120, 273, '页');
    expect(c.bookExtract.prog).toBe('①/④ 正在载入正文 120 / 273 页（44%）…');
  });
  it('同时喂给底栏的进度条', () => {
    const c = mk('load');
    Books.methods._setProg.call(c, 120, 273, '页');
    expect(c.bookExtract.done).toBe(120);
    expect(c.bookExtract.total).toBe(273);
  });
  it('本页抽题（phase=page）不蹭整本的标签', () => {
    const c = mk('page');
    c.bookExtract.prog = '正在准备正文…';
    Books.methods._setProg.call(c, 120, 273, '页');
    expect(c.bookExtract.prog).toBe('正在准备正文…');
  });
  it('解析阶段之后不再被载入进度改写', () => {
    const c = mk('parse');
    c.bookExtract.prog = '②/④ 正在解析全书 273 页…';
    Books.methods._setProg.call(c, 5, 10, '页');
    expect(c.bookExtract.prog).toBe('②/④ 正在解析全书 273 页…');
  });
  it('不在抽题时不污染底栏（书架自己加载也会调 _setProg）', () => {
    const c = mk('');
    Books.methods._setProg.call(c, 50, 100, '页');
    expect(c.bookExtract.prog).toBe('');
  });
  it('busy 为真但 phase 已清空时也不写（切书后的残留场景）', () => {
    const c = { bookExtract: { busy: true, phase: '', prog: '', done: 0, total: 0 }, matProg: {} };
    Books.methods._setProg.call(c, 50, 100, '页');
    expect(c.bookExtract.prog).toBe('');
  });
  it('总数为 0 时不写（避免出现「0 / 0」）', () => {
    const c = mk('load');
    Books.methods._setProg.call(c, 0, 0, '页');
    expect(c.bookExtract.prog).toBe('');
  });
  it('matProg 本身照常更新，顶部进度条不受影响', () => {
    const c = mk('load');
    Books.methods._setProg.call(c, 120, 273, '页');
    expect(c.matProg).toMatchObject({ cur: 120, total: 273, pct: 44, unit: '页' });
  });
});

describe('切书要清掉抽题进度残留', () => {
  const app = read('js/app.js');
  const ing = read('js/views/ingest.js');
  it('currentBookId 的 watcher 里重置（含收起状态）', () => {
    expect(app).toContain("this.bookExtract.phase=''");
    expect(app).toContain('this.bookExtract.hidden=false;');
  });
  it('phase / hidden 字段都有声明', () => {
    expect(app).toContain("bookExtract:{ busy:false, prog:'', done:0, total:0, phase:'', hidden:false }");
  });
  it('两个抽题入口的 finally 都清 phase 和进度条', () => {
    const fins = ing.match(/finally \{ this\.bookExtract\.busy=false;[^}]*\}/g) || [];
    expect(fins).toHaveLength(2);
    for (const f of fins) {
      expect(f).toContain("phase=''");
      expect(f).toContain('done=0');
      expect(f).toContain('total=0');
    }
  });
  it('整本流程按阶段推进 phase', () => {
    expect(ing).toContain("this.bookExtract.phase='load';");
    expect(ing).toContain("this.bookExtract.phase='parse';");
    expect(ing).toContain("this.bookExtract.phase='page';");
  });
});

describe('四个阶段都有编号，用户知道还剩几步', () => {
  const src = read('js/views/ingest.js');
  it('①载入 ②解析 ③转存插图 ④生成预览', () => {
    expect(read('js/views/books.js')).toContain('①/④ 正在载入正文');
    expect(src).toContain('①/④ 正文已就绪');
    expect(src).toContain('②/④ 正在解析全书');
    expect(src).toContain('③/④ 正在转存插图');
    expect(src).toContain('④/④ 正在生成预览');
  });
  it('转存插图那步也带进度条（343 张图是最慢的一段）', () => {
    // 这一段从串行改成了 3 路并发，进度由共享计数器 done 驱动（不再是循环下标 i）
    expect(src).toContain("this.bookExtract.done=done; this.bookExtract.total=seen.size;");
    expect(src).toContain("'③/④ 正在转存插图 '+done+' / '+seen.size+'…'");
  });
  it('进入预览前清掉进度条，避免残留', () => {
    expect(src).toContain("this.bookExtract.done=0; this.bookExtract.total=0;\n      this.bookExtract.phase='preview';");
  });
  it('导入阶段的提示带单位', () => {
    expect(src).toMatch(/正在导入 .+ 题…/);
  });
});

describe('底栏把进度摆在按钮旁边', () => {
  const tpl = read('js/tpl/view-books.js');
  const css = read('css/style.css');
  it('有转圈、文字和进度条三件套', () => {
    expect(tpl).toContain('bk-extract-prog');
    expect(tpl).toContain('bk-extract-txt');
    expect(tpl).toContain('bk-extract-bar');
  });
  it('优先用 bookExtract 的计数，没有就回落到 matProg', () => {
    expect(tpl).toContain('v-if="bookExtract.total"');
    expect(tpl).toContain('v-else-if="matProg.total"');
  });
  it('进度条宽度钳到 100%', () => {
    expect(tpl).toContain('Math.min(100,');
  });
  it('窄屏下进度条独占一行并撑满', () => {
    expect(css).toContain('.bk-extract-prog{flex-basis:100%');
    expect(css).toContain('.bk-extract-bar{flex:1;width:auto}');
  });
  it('长文案省略而不是把导航按钮挤走', () => {
    expect(css).toContain('.bk-extract-txt{white-space:nowrap;overflow:hidden;text-overflow:ellipsis');
  });
});

describe('预览渲染不是瓶颈', () => {
  const src = read('js/views/ingest.js');
  it('分页渲染，默认每页 40 条', () => {
    expect(src).toContain('extractPageItems()');
    expect(src).toContain('p.pageSize||40');
  });
  it('勾选状态跨页保留（不是只在当前页有效）', () => {
    expect(read('js/tpl/shell-close.js')).toContain('勾选状态跨页保留');
  });
});

// ===== 插图转存并发化 =====
// 343 张图串行上传，整本抽题前要干等好几分钟。改成 3 路并发。
// 这一段有三条不能破的不变量：
//   ① 上传失败必须【保留内嵌】—— 图不能丢，宁可题目偏大
//   ② ≤32KB 的小图不上传，只计入 inlined
//   ③ map 以 dataURL 为键，完成顺序不影响替换结果
describe('插图转存：并发但行为不变', () => {
  const Ing = new Function(read('js/views/ingest.js') + ';return IngestMixin;')().methods;
  const big = (n) => 'data:image/png;base64,' + 'A'.repeat(n);
  const mkQs = (n, size = 40000) => Array.from({ length: n }, (_, i) => ({ stem: '题 <img src="' + big(size + i) + '">', options: [], answer: [] }));

  const run = async (fetchImpl, qs) => {
    const prevFD = global.FormData, prevFetch = global.fetch;
    global.FormData = class { append() {} };
    global.fetch = fetchImpl;
    try {
      const ctx = Object.assign(Object.create(Ing), {
        token: 't', bookExtract: { busy: true, prog: '', done: 0, total: 0 },
        _dataUrlToBlob: (u) => (u.startsWith('data:image/png;base64,BAD') ? null : { type: 'image/png' }),
      });
      const stat = await Ing._hoistImages.call(ctx, qs);
      return { stat, qs, ctx };
    } finally { global.FormData = prevFD; global.fetch = prevFetch; }
  };
  const okFetch = () => async () => ({ ok: true, status: 200, json: async () => ({ url: 'https://r2/ok.png' }) });

  it('正常路径：全部换成 R2 链接', async () => {
    const { stat, qs } = await run(okFetch(), mkQs(5));
    expect(stat).toMatchObject({ total: 5, uploaded: 5, failed: 0 });
    expect(qs.every((q) => /https:\/\/r2\//.test(q.stem))).toBe(true);
    expect(qs.some((q) => /;base64,/.test(q.stem))).toBe(false);
  });
  it('小图不上传，只计 inlined（≤32KB）', async () => {
    let calls = 0;
    const { stat, qs } = await run(async () => { calls++; return { ok: true, json: async () => ({ url: 'x' }) }; }, mkQs(4, 1000));
    expect(stat).toMatchObject({ total: 4, inlined: 4, uploaded: 0 });
    expect(calls).toBe(0);
    expect(qs.every((q) => /;base64,/.test(q.stem))).toBe(true);   // 保持内嵌
  });
  it('上传失败必须保留内嵌 —— 图不能丢', async () => {
    const { stat, qs } = await run(async () => ({ ok: false, status: 500, json: async () => ({ error: 'boom' }) }), mkQs(5));
    expect(stat).toMatchObject({ uploaded: 0, failed: 5 });
    expect(qs.every((q) => /;base64,/.test(q.stem))).toBe(true);
  });
  it('拿不到 blob 的记失败，也保留内嵌', async () => {
    const qs = [{ stem: 'x <img src="data:image/png;base64,BAD' + 'A'.repeat(40000) + '">', options: [], answer: [] }];
    const { stat } = await run(okFetch(), qs);
    expect(stat).toMatchObject({ total: 1, failed: 1, uploaded: 0 });
    expect(/;base64,/.test(qs[0].stem)).toBe(true);
  });
  it('限流会重试一次并救回来', async () => {
    let n = 0;
    const { stat } = await run(async () => {
      n++;
      if (n <= 3) return { ok: false, status: 429, json: async () => ({ error: '429 rate limit' }) };
      return { ok: true, json: async () => ({ url: 'https://r2/ok.png' }) };
    }, mkQs(3));
    expect(stat).toMatchObject({ uploaded: 3, failed: 0 });
    expect(n).toBe(6);          // 3 次失败 + 3 次重试成功
  });
  it('不可重试的错误（413 图太大）不浪费重试', async () => {
    let n = 0;
    const { stat } = await run(async () => { n++; return { ok: false, status: 413, json: async () => ({ error: 'file too large' }) }; }, mkQs(4));
    expect(n).toBe(4);
    expect(stat.failed).toBe(4);
  });
  it('并发上限是 3，不会一口气全打出去', async () => {
    let live = 0, peak = 0;
    await run(async () => {
      live++; peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 5));
      live--;
      return { ok: true, json: async () => ({ url: 'https://r2/ok.png' }) };
    }, mkQs(12));
    expect(peak).toBe(3);
  });
  it('进度计数走到满，且不超过总数', async () => {
    const { ctx, stat } = await run(okFetch(), [...mkQs(6), ...mkQs(3, 1000)]);
    expect(ctx.bookExtract.done).toBe(stat.total);
    expect(ctx.bookExtract.total).toBe(stat.total);
    expect(ctx.bookExtract.prog).toContain('9 / 9');
  });
  it('没有图时不发请求，stat 全零', async () => {
    const { stat } = await run(async () => { throw new Error('不该被调用'); }, [{ stem: '纯文字题干', options: [], answer: [] }]);
    expect(stat).toEqual({ total: 0, uploaded: 0, inlined: 0, failed: 0 });
  });
  it('同一张图在多道题里只上传一次（按 URL 去重）', async () => {
    let n = 0;
    const url = big(40000);
    const qs = [1, 2, 3].map(() => ({ stem: 'x <img src="' + url + '">', options: [], answer: [] }));
    const { stat } = await run(async () => { n++; return { ok: true, json: async () => ({ url: 'https://r2/one.png' }) }; }, qs);
    expect(n).toBe(1);
    expect(stat.total).toBe(1);
    expect(qs.every((q) => q.stem.includes('https://r2/one.png'))).toBe(true);
  });
  it('替换覆盖 stem / passage / analysis / options / answer 五处', async () => {
    const url = big(40000);
    const qs = [{ stem: 'S <img src="' + url + '">', passage: 'P <img src="' + url + '">',
      analysis: 'A <img src="' + url + '">',
      options: [{ key: 'A', text: 'O <img src="' + url + '">' }],
      answer: ['R <img src="' + url + '">'] }];
    await run(okFetch(), qs);
    const q = qs[0];
    for (const t of [q.stem, q.passage, q.analysis, q.options[0].text, q.answer[0]]) {
      expect(t).toContain('https://r2/ok.png');
      expect(t).not.toContain('base64');
    }
  });
});

// 本页抽题原来调 ensureBookContent()，把整本都拉下来 —— 388 页那本要干等十几秒，
// 用户看到的就是按钮一直转。它全程只读 currentPageMat.content_md，一页都不需要别的。
describe('本页抽题只载入当前页', () => {
  const Books2 = new Function(read('js/views/books.js') + ';return BooksMixin;')();
  const mk = () => {
    const filled = [];
    return Object.assign(Object.create(Books2.methods), {
      filled,
      currentBook: { title: '高数上', pages: Array.from({ length: 388 }, (_, i) => ({ id: 'm' + i, page: i + 1 })) },
      _fillMatContent: async (ids) => { filled.push(...ids); },
    });
  };
  it('只拉当前这一页，不是整本', async () => {
    const c = mk();
    await c.ensurePagesContent(c.currentBook.pages[15]);
    expect(c.filled).toEqual(['m15']);
  });
  it('正文已在本地就不发请求', async () => {
    const c = mk();
    await c.ensurePagesContent({ id: 'm3', content_md: '已有正文' });
    expect(c.filled).toEqual([]);
  });
  it('空输入 / null 不炸', async () => {
    const c = mk();
    await c.ensurePagesContent(null);
    await c.ensurePagesContent([]);
    await c.ensurePagesContent([null, undefined]);
    expect(c.filled).toEqual([]);
  });
  it('可以一次补多页（跨页题目将来会用到）', async () => {
    const c = mk();
    await c.ensurePagesContent([c.currentBook.pages[0], c.currentBook.pages[1]]);
    expect(c.filled).toEqual(['m0', 'm1']);
  });
  it('localExtractPage 改用 ensurePagesContent，并保留旧方法作兜底', () => {
    const ing = read('js/views/ingest.js');
    expect(ing).toContain('if(this.ensurePagesContent)await this.ensurePagesContent(m0);');
    expect(ing).toContain('else if(this.ensureBookContent)await this.ensureBookContent();');
  });
  it('正文没载入成功要报错，不能拿 undefined 去解析', () => {
    expect(read('js/views/ingest.js')).toContain("if(m.content_md===undefined){ this.flash('这一页正文没载入成功，请重试',true); return; }");
  });
  it('整本抽题仍然用 ensureBookContent（它确实需要全书）', () => {
    expect(read('js/views/ingest.js')).toContain('if(this.ensureBookContent)await this.ensureBookContent();   // 同上：整本抽题依赖每页 content_md');
  });
});

// 底栏那行文字一滚就看不见了，而整本抽题动辄几分钟（载入 273 页 + 转存 343 张图）。
// 加一个居中面板，四步进度一目了然，可「收起」去做别的。
describe('整本抽题的居中进度面板', () => {
  const Ing = new Function(read('js/views/ingest.js') + ';return IngestMixin;')().methods;
  const mk = (phase, extra = {}) => Object.assign(Object.create(Ing), {
    bookExtract: Object.assign({ busy: !!phase, phase: phase || '', prog: '', done: 0, total: 0, hidden: false }, extra),
  });

  it('四步的顺序和当前步高亮', () => {
    const steps = mk('img').extractSteps();
    expect(steps.map((s) => s.k)).toEqual(['load', 'parse', 'img', 'preview']);
    expect(steps.map((s) => s.state)).toEqual(['done', 'done', 'run', 'wait']);
  });
  it('第一步进行中时后面三步都是等待', () => {
    expect(mk('load').extractSteps().map((s) => s.state)).toEqual(['run', 'wait', 'wait', 'wait']);
  });
  it('最后一步进行中时前三步都已完成', () => {
    expect(mk('preview').extractSteps().map((s) => s.state)).toEqual(['done', 'done', 'done', 'run']);
  });
  it('没在跑时全部是等待，不会误标完成', () => {
    expect(mk('').extractSteps().every((s) => s.state === 'wait')).toBe(true);
  });

  it('只在整本抽题的四个阶段弹出', () => {
    for (const p of ['load', 'parse', 'img', 'preview']) expect(mk(p).extractPanelOpen()).toBe(true);
  });
  it('本页抽题不弹（现在只拉一页，快得没必要打断视线）', () => {
    expect(mk('page').extractPanelOpen()).toBe(false);
  });
  it('没在跑时不弹', () => {
    expect(mk('').extractPanelOpen()).toBe(false);
    expect(mk('load', { busy: false }).extractPanelOpen()).toBe(false);
  });
  it('收起后不再弹，但抽题继续（busy 仍为真）', () => {
    const c = mk('load');
    c.extractPanelHide();
    expect(c.bookExtract.hidden).toBe(true);
    expect(c.bookExtract.busy).toBe(true);
    expect(c.extractPanelOpen()).toBe(false);
  });
  it('每次开始整本抽题都重新展开（上次收起过也不影响）', () => {
    expect(read('js/views/ingest.js')).toContain('this.bookExtract.busy=true; this.bookExtract.hidden=false;');
  });

  const tpl = read('js/tpl/view-books.js');
  const css = read('css/style.css');
  it('模板渲染四步、当前提示和进度条', () => {
    expect(tpl).toContain('v-for="(s,i) in extractSteps()"');
    expect(tpl).toContain('bookExtract.prog');
    expect(tpl).toContain('exdlg-bar');
  });
  it('总数未知的阶段用不定长滑动条，而不是假装 0%', () => {
    expect(tpl).toContain('exdlg-bar indet');
    expect(css).toContain('.exdlg-bar.indet i{width:38%;animation:exslide');
  });
  it('居中显示', () => {
    expect(css).toContain('.exdlg-mask{position:fixed;inset:0');
    expect(css).toContain('align-items:center;justify-content:center');
  });
  it('有「收起」而不是「取消」——目前没有中止抽题的能力，不能给假按钮', () => {
    expect(tpl).toContain('extractPanelHide');
    expect(tpl).toContain('收起');
    expect(tpl).not.toMatch(/exdlg[\s\S]{0,400}取消/);
  });
  it('减少动效偏好下不跑动画', () => {
    expect(css).toContain('@media(prefers-reduced-motion:reduce){.exdlg-bar.indet i{animation:none');
  });
});
