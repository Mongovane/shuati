// 回归守卫：书架被 500 行硬上限截断，导致「教材阅读只有 2 本、新导入的把旧书替换掉」。
// 症状根因：GET /api/materials 把 limit 夹到 500 且没有 offset，按 created_at DESC 排序时
// 388 页 + 112 页正好占满 500 行窗口，新导入的书把旧书顶出窗口。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FakeDB, authedReq, makeEnv, ROOT } from './helpers.mjs';
import { onRequestGet as materialsGet } from '../functions/api/materials.js';

// 造 n 行教材（带正文）
const rows = (n, from = 0) =>
  Array.from({ length: n }, (_, i) => ({
    id: 'mat-math-' + (from + i), subject: 'math', title: 'T' + (from + i),
    source: '书A', page: from + i + 1, summary: '', tags: '[]', created_at: 1700000000,
    content_md: '正文' + (from + i), page_image: '',
  }));

const lastSelect = (db) => db.stmts(/SELECT .* FROM materials/)[db.stmts(/SELECT .* FROM materials/).length - 1];

describe('GET /api/materials 分页（修 500 行硬上限）', () => {
  it('支持 offset：SQL 带 LIMIT ? OFFSET ?，且 offset 值被绑定进去', async () => {
    const db = new FakeDB([{ match: /SELECT .* FROM materials/, value: rows(3) }]);
    const res = await materialsGet({ request: authedReq('http://x/api/materials?limit=500&offset=1000'), env: makeEnv(db) });
    const body = await res.json();
    expect(res.status).toBe(200);
    const st = lastSelect(db);
    expect(st.sql).toMatch(/LIMIT \? OFFSET \?/);
    expect(st.binds.slice(-2)).toEqual([500, 1000]);
    expect(body.offset).toBe(1000);
  });

  it('排序末尾补 id 做 tiebreaker（整本导入 created_at 同秒，否则翻页会漏行+重复行）', async () => {
    const db = new FakeDB([{ match: /SELECT .* FROM materials/, value: [] }]);
    await materialsGet({ request: authedReq('http://x/api/materials'), env: makeEnv(db) });
    expect(lastSelect(db).sql).toMatch(/ORDER BY created_at DESC, source, page, id/);
  });

  it('meta=1：不查正文列，limit 可以远超 500（书架要一次拉全）', async () => {
    const db = new FakeDB([{ match: /SELECT .* FROM materials/, value: [] }]);
    await materialsGet({ request: authedReq('http://x/api/materials?meta=1&limit=2000'), env: makeEnv(db) });
    const st = lastSelect(db);
    expect(st.sql).not.toMatch(/content_md/);
    expect(st.sql).not.toMatch(/SELECT \* FROM materials/);
    expect(st.binds.slice(-2)).toEqual([2000, 0]);   // 没被夹到 500
  });

  it('meta=1 的返回项不含 content_md 键（前端靠 undefined 判断"还没载入"，不能给空串）', async () => {
    const db = new FakeDB([{ match: /SELECT .* FROM materials/, value: rows(2) }]);
    const res = await materialsGet({ request: authedReq('http://x/api/materials?meta=1'), env: makeEnv(db) });
    const body = await res.json();
    expect(body.items.length).toBe(2);
    expect('content_md' in body.items[0]).toBe(false);
    expect('page_image' in body.items[0]).toBe(false);
    expect(body.items[0].title).toBe('T0');          // 元信息照常返回
    expect(body.items[0].page).toBe(1);
  });

  it('带正文时仍返回 content_md，且 limit 上限仍是 500（正文可能内嵌 base64 图，不能放开）', async () => {
    const db = new FakeDB([{ match: /SELECT .* FROM materials/, value: rows(1) }]);
    const res = await materialsGet({ request: authedReq('http://x/api/materials?limit=9999'), env: makeEnv(db) });
    const body = await res.json();
    expect(body.items[0].content_md).toBe('正文0');
    expect(lastSelect(db).binds.slice(-2)).toEqual([500, 0]);
  });

  it('ids= 按 id 精确取正文（切书时按需补齐），最多 200 个', async () => {
    const db = new FakeDB([{ match: /SELECT .* FROM materials/, value: rows(2) }]);
    await materialsGet({ request: authedReq('http://x/api/materials?ids=a,b,c'), env: makeEnv(db) });
    const st = lastSelect(db);
    expect(st.sql).toMatch(/id IN \(\?,\?,\?\)/);
    expect(st.binds.slice(0, 3)).toEqual(['a', 'b', 'c']);

    const db2 = new FakeDB([{ match: /SELECT .* FROM materials/, value: [] }]);
    const many = Array.from({ length: 300 }, (_, i) => 'id' + i).join(',');
    await materialsGet({ request: authedReq('http://x/api/materials?ids=' + many), env: makeEnv(db2) });
    expect((lastSelect(db2).sql.match(/\?/g) || []).length).toBe(200 + 2);   // 200 个 id + LIMIT + OFFSET
  });

  it('count=1 才额外跑 COUNT（默认不跑，省 D1 读）', async () => {
    const db = new FakeDB([
      { match: /COUNT\(\*\) AS n/, value: { n: 1234 } },
      { match: /SELECT .* FROM materials/, value: [] },
    ]);
    await materialsGet({ request: authedReq('http://x/api/materials'), env: makeEnv(db) });
    expect(db.ran(/COUNT\(\*\) AS n/)).toBe(false);

    const db2 = new FakeDB([
      { match: /COUNT\(\*\) AS n/, value: { n: 1234 } },
      { match: /SELECT .* FROM materials/, value: [] },
    ]);
    const res = await materialsGet({ request: authedReq('http://x/api/materials?count=1'), env: makeEnv(db2) });
    expect((await res.json()).total).toBe(1234);
  });
});

describe('前端：书架翻页拉全 + 按书补正文', () => {
  const load = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const Books = new Function(load('js/views/books.js') + ';return BooksMixin;')();
  const M = Books.methods;

  // fake this：记录每次请求路径，按 offset 返回对应批次
  function ctx(total, pageSize) {
    const calls = [];
    return Object.assign(Object.create(M), {
      calls,
      token: 't', materials: { items: [], loading: false, loaded: false }, loadProgMsg: '',
      matProg: { cur: 0, total: 0, pct: 0, unit: '段' },
      currentBookId: '', currentBook: null, materialBooks: [],
      flash() {},
      async ensureBookContent() {},
      async api(path) {
        calls.push(path);
        const off = Number((path.match(/offset=(\d+)/) || [])[1] || 0);
        const n = Math.max(0, Math.min(pageSize, total - off));
        return { items: Array.from({ length: n }, (_, i) => ({ id: 'm' + (off + i), source: '书A', page: off + i + 1 })) };
      },
    });
  }

  it('loadMaterials 一直翻到拿不满一页为止（500 行不再是天花板）', async () => {
    const c = ctx(5200, 2000);
    await M.loadMaterials.call(c);
    expect(c.materials.items.length).toBe(5200);
    expect(c.calls.map((p) => (p.match(/offset=(\d+)/) || [])[1])).toEqual(['0', '2000', '4000']);
    expect(c.calls.every((p) => p.includes('meta=1'))).toBe(true);
  });

  it('正好整页边界：再多请求一次确认到底，不会少一页', async () => {
    const c = ctx(4000, 2000);
    await M.loadMaterials.call(c);
    expect(c.materials.items.length).toBe(4000);
    expect(c.calls.length).toBe(3);   // 2000 + 2000 + 0
  });

  it('ensureBookContent 只补缺正文的页，分块请求且不重复拉已有的', async () => {
    const pages = Array.from({ length: 45 }, (_, i) => ({ id: 'm' + i, page: i + 1 }));
    pages[0].content_md = '已有';                       // 这页不该再被请求
    const got = [];
    const c = Object.assign(Object.create(M), {
      token: 't', materials: { items: pages, loading: false }, loadProgMsg: '', flash() {},
      matProg: { cur: 0, total: 0, pct: 0, unit: '段' },
      currentBook: { title: '书A', pages },
      async api(path) {
        const ids = decodeURIComponent((path.match(/ids=([^&]+)/) || [])[1] || '').split(',');
        got.push(ids);
        return { items: ids.map((id) => ({ id, content_md: '正文' + id })) };
      },
    });
    await M.ensureBookContent.call(c);
    expect(got.length).toBe(3);                          // 44 页 / 每批 20
    expect(got.flat()).not.toContain('m0');
    expect(pages[0].content_md).toBe('已有');            // 原有正文没被覆盖
    expect(pages[1].content_md).toBe('正文m1');
    expect(pages[44].content_md).toBe('正文m44');

    got.length = 0;
    await M.ensureBookContent.call(c);                   // 再来一次：全都有了，不该发请求
    expect(got.length).toBe(0);
  });

  it('离线合成的响应一次给全量、不认 offset，拿到 _offline 就停（否则会反复拿同一批）', async () => {
    const c = ctx(9999, 2000);
    const realApi = c.api;
    c.api = async (p) => { const d = await realApi(p); d._offline = true; return d; };
    await M.loadMaterials.call(c);
    expect(c.calls.length).toBe(1);
    expect(c.materials.items.length).toBe(2000);
  });

  it('两处入口并发补同一本书时，同一页不会被下载两次', async () => {
    const pages = Array.from({ length: 30 }, (_, i) => ({ id: 'm' + i, page: i + 1 }));
    const got = [];
    const c = Object.assign(Object.create(M), {
      token: 't', materials: { items: pages, loading: false }, loadProgMsg: '', flash() {},
      matProg: { cur: 0, total: 0, pct: 0, unit: '段' },
      currentBook: { title: '书A', pages },
      async api(path) {
        const ids = decodeURIComponent((path.match(/ids=([^&]+)/) || [])[1] || '').split(',');
        got.push(...ids);
        await new Promise((r) => setTimeout(r, 0));
        return { items: ids.map((id) => ({ id, content_md: '正文' + id })) };
      },
    });
    // loadMaterials 结尾补一次、currentBookId 的 watcher 又补一次——模拟这两个入口同时进来
    await Promise.all([M.ensureBookContent.call(c), M.ensureBookContent.call(c)]);
    expect(got.length).toBe(30);                         // 30 页各下一次，没有重复
    expect(new Set(got).size).toBe(30);
  });
});

describe('抽题预览：选项必须走 rich-text（否则 LaTeX 裸奔）', () => {
  const tpl = fs.readFileSync(path.join(ROOT, 'js/tpl/shell-close.js'), 'utf8');
  const line = tpl.split('\n').find((l) => l.includes('class="prev-opts"'));

  it('预览选项文本用 rich-text 渲染，而不是 {{ o.text }} 纯插值', () => {
    expect(line).toBeTruthy();
    expect(line).toMatch(/<rich-text :content="o\.text"/);
    expect(line).not.toMatch(/\{\{\s*o\.text\s*\}\}/);
  });

  it('样式里给 .prev-opt .rich 兜住了行内布局（rich-text 是块级 div）', () => {
    const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
    expect(css).toMatch(/\.prev-opt \.rich\{/);
    expect(css).toMatch(/\.prev-opt\{display:flex/);
  });

  it('选项那种行内 $…$ 公式确实会被 rich-text 交给 KaTeX 行内渲染', () => {
    const seen = [];
    const win = { katex: { renderToString: (tex, o) => { seen.push({ tex, display: o.displayMode }); return '<span class="katex"></span>'; } } };
    const marked = { parse: (s) => '<p>' + s + '</p>' };
    const RichText = new Function('marked', 'window', fs.readFileSync(path.join(ROOT, 'js/components/rich-text.js'), 'utf8') + ';return RichText;')(marked, win);
    // 截图里 A 选项的原文
    const opt = String.raw`$\lim_{h\to +\infty}h\left[f\left(a + \frac{1}{h}\right) - f(a)\right]$ 存在`;
    const out = RichText.computed.html.call({ content: opt });
    expect(seen.length).toBe(1);
    expect(seen[0].display).toBe(false);                      // 行内，不是独占一行的 display 公式
    expect(seen[0].tex).toContain('\\lim_{h\\to +\\infty}');
    expect(out).toContain('katex');
    expect(out).not.toContain('\\left[f\\left(a');            // 不再有裸 LaTeX 漏出
  });
});

describe('离线包：教材也要翻页拉全', () => {
  it('settings 里下载教材带 offset 循环，而不是单发一个 limit=2000', () => {
    const s = fs.readFileSync(path.join(ROOT, 'js/views/settings.js'), 'utf8');
    expect(s).toMatch(/\/api\/materials\?limit=500&offset='\+moff/);
    expect(s).not.toMatch(/\/api\/materials\?limit=2000'/);
  });
});

describe('版本号单一来源（界面显示过 v4.4 而实际是 v167）', () => {
  it('app.js 不再自带第二个版本常量，appVer 直接用 constants.js 的 APP_VERSION', () => {
    const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
    expect(app).toMatch(/appVer\(\)\{ return APP_VERSION; \}/);
    expect(app).not.toMatch(/const APP_VER\s*=/);       // bump 不会同步它，必然冻住
  });

  it('constants.js 的 APP_VERSION 与 sw.js 的 VERSION、index.html 的 ?v= 一致', () => {
    const ver = (fs.readFileSync(path.join(ROOT, 'js/constants.js'), 'utf8').match(/APP_VERSION='(v\d+)'/) || [])[1];
    expect(ver).toBeTruthy();
    expect(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8')).toContain(`const VERSION = '${ver}'`);
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const stale = [...html.matchAll(/\?v=(\d+)/g)].map((m) => 'v' + m[1]).filter((v) => v !== ver);
    expect(stale).toEqual([]);
  });
});

describe('数字进度条（原来是无限滑动的假进度）', () => {
  const load = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const Books = new Function(load('js/views/books.js') + ';return BooksMixin;')();

  it('_setProg 算出百分比，总数为 0 时不谎报进度', () => {
    const c = { matProg: {} };
    Books.methods._setProg.call(c, 240, 388, '页');
    expect(c.matProg).toEqual({ cur: 240, total: 388, pct: 62, unit: '页' });
    Books.methods._setProg.call(c, 5, 0, '段');
    expect(c.matProg.pct).toBe(0);
  });

  it('首个目录请求带 count=1 拿总数，进度才有分母', () => {
    expect(load('js/views/books.js')).toMatch(/i===0\?'&count=1':''/);
  });

  it('模板在 total>0 时切换成确定进度条并显示百分比', () => {
    const tpl = load('js/tpl/view-books.js');
    expect(tpl).toMatch(/:class="\{det:matProg\.total>0\}"/);
    expect(tpl).toMatch(/matProg\.pct \}\}% · \{\{ matProg\.cur \}\} \/ \{\{ matProg\.total \}\}/);
    const css = load('css/style.css');
    expect(css).toMatch(/\.bk-loadbar\.det::after\{display:none\}/);
  });
});

describe('ensureBookContent 必须「等在途」而不是提前返回（线上 665 题静默变 430 的根因）', () => {
  const load = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const Books = new Function(load('js/views/books.js') + ';return BooksMixin;')();
  const M = Books.methods;

  function ctx(nPages) {
    const pages = Array.from({ length: nPages }, (_, i) => ({ id: 'm' + i, page: i + 1 }));
    const gate = [];
    const c = Object.assign(Object.create(M), {
      pages, gate,
      token: 't', materials: { items: pages, loading: false }, loadProgMsg: '', flash() {},
      matProg: { cur: 0, total: 0, pct: 0, unit: '段' },
      currentBook: { title: '书A', pages },
      async api(path) {
        const ids = decodeURIComponent((path.match(/ids=([^&]+)/) || [])[1] || '').split(',');
        await new Promise((r) => gate.push(() => r()));      // 卡住，直到测试放行
        return { items: ids.map((id) => ({ id, content_md: '正文' + id })) };
      },
    });
    return c;
  }
  const drain = async (c) => { for (let i = 0; i < 60 && (c.gate.length || i < 3); i++) { const g = c.gate.shift(); if (g) g(); await new Promise((r) => setTimeout(r, 0)); } };

  it('第二个调用方要等第一批拉完，返回那一刻正文必须已经齐', async () => {
    const c = ctx(45);                       // 45 页 = 3 个分块
    const a = M.ensureBookContent.call(c);   // 先发起，不 await
    await new Promise((r) => setTimeout(r, 0));
    // 关键：记录「b 兑现的那一瞬间」还缺多少页。
    // 旧实现看到在途就 return，b 会在下一个微任务就兑现，那时还缺 45 页 —— 这一条能红。
    let missingAtResolve = -1;
    const b = M.ensureBookContent.call(c).then(() => {
      missingAtResolve = c.pages.filter((p) => p.content_md === undefined).length;
    });
    await drain(c);
    await Promise.all([a, b]);
    expect(missingAtResolve).toBe(0);
    expect(M.matMissingCount.call(c)).toBe(0);
  });

  it('同一页不会被两个调用方各下一次', async () => {
    const c = ctx(30);
    const got = [];
    const realApi = c.api;
    c.api = async function (p) { got.push(...decodeURIComponent((p.match(/ids=([^&]+)/) || [])[1] || '').split(',')); return realApi.call(this, p); };
    const a = M.ensureBookContent.call(c);
    await new Promise((r) => setTimeout(r, 0));
    const b = M.ensureBookContent.call(c);
    await drain(c);
    await Promise.all([a, b]);
    expect(got.length).toBe(30);
    expect(new Set(got).size).toBe(30);
  });

  it('matMissingCount 如实报告缺多少页（抽题自检要用）', () => {
    const pages = [{ id: 'a', content_md: 'x' }, { id: 'b' }, { id: 'c' }];
    const c = Object.assign(Object.create(M), { currentBook: { pages } });
    expect(M.matMissingCount.call(c)).toBe(2);
    pages[1].content_md = ''; pages[2].content_md = 'y';
    expect(M.matMissingCount.call(c)).toBe(0);            // 空串是「已载入但这页没正文」，不算缺
  });
});

describe('正文拉取并发（串行会让 278 页排成 14 个来回、抽题前干等十几秒）', () => {
  const load = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const Books = new Function(load('js/views/books.js') + ';return BooksMixin;')();
  const M = Books.methods;

  it('同时最多 3 路在飞，且每页只拉一次', async () => {
    const pages = Array.from({ length: 200 }, (_, i) => ({ id: 'm' + i, page: i + 1 }));   // 10 个分块
    let inFlight = 0, peak = 0; const got = [];
    const c = Object.assign(Object.create(M), {
      token: 't', materials: { items: pages, loading: false }, loadProgMsg: '', flash() {},
      matProg: { cur: 0, total: 0, pct: 0, unit: '段' },
      currentBook: { title: '书A', pages },
      async api(p) {
        inFlight++; peak = Math.max(peak, inFlight);
        const ids = decodeURIComponent((p.match(/ids=([^&]+)/) || [])[1] || '').split(',');
        got.push(...ids);
        await new Promise((r) => setTimeout(r, 3));
        inFlight--;
        return { items: ids.map((id) => ({ id, content_md: 'c' + id })) };
      },
    });
    await M.ensureBookContent.call(c);
    expect(peak).toBe(3);
    expect(peak).toBeLessThanOrEqual(3);
    expect(got.length).toBe(200);
    expect(new Set(got).size).toBe(200);
    expect(pages.filter((p) => p.content_md === undefined).length).toBe(0);
  });

  it('分块数少于并发数时不会开多余的 worker', async () => {
    const pages = Array.from({ length: 15 }, (_, i) => ({ id: 'm' + i, page: i + 1 }));    // 1 个分块
    let peak = 0, inFlight = 0;
    const c = Object.assign(Object.create(M), {
      token: 't', materials: { items: pages, loading: false }, loadProgMsg: '', flash() {},
      matProg: { cur: 0, total: 0, pct: 0, unit: '段' },
      currentBook: { title: '书A', pages },
      async api(p) { inFlight++; peak = Math.max(peak, inFlight);
        const ids = decodeURIComponent((p.match(/ids=([^&]+)/) || [])[1] || '').split(',');
        await new Promise((r) => setTimeout(r, 1)); inFlight--;
        return { items: ids.map((id) => ({ id, content_md: 'c' + id })) }; },
    });
    await M.ensureBookContent.call(c);
    expect(peak).toBe(1);
  });

  it('进度条按已完成页数推进，收尾是 100%', async () => {
    const pages = Array.from({ length: 60 }, (_, i) => ({ id: 'm' + i, page: i + 1 }));
    const seen = [];
    const c = Object.assign(Object.create(M), {
      token: 't', materials: { items: pages, loading: false }, loadProgMsg: '', flash() {},
      matProg: { cur: 0, total: 0, pct: 0, unit: '段' },
      currentBook: { title: '书A', pages },
      async api(p) { const ids = decodeURIComponent((p.match(/ids=([^&]+)/) || [])[1] || '').split(',');
        return { items: ids.map((id) => ({ id, content_md: 'c' + id })) }; },
    });
    const realSet = M._setProg;
    c._setProg = function (cur, total, unit) { realSet.call(this, cur, total, unit); seen.push(this.matProg.pct); };
    await M.ensureBookContent.call(c);
    expect(Math.max(...seen)).toBe(100);
    expect(seen.filter((p) => p > 100).length).toBe(0);
  });
});
