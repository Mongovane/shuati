// 整本抽题入库的优化回归（P0 预览分页 / P1 批大小 / P2 push / P3 预警）
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const src = fs.readFileSync(path.join(ROOT, 'js/views/ingest.js'), 'utf8');
const Ingest = new Function(src + ';return IngestMixin;')();
const M = Ingest.methods;

// 造 n 道题
const mkQ = (n) => Array.from({ length: n }, (_, i) => ({ stem: '题目' + i, type: 'single_choice', answer: ['A'] }));

// fake this：_openPreview 只依赖 this.extractPreview
function ctx() {
  return Object.assign(Object.create(M), { extractPreview: {}, flash() {} });
}

describe('P0 预览分页（防大题量全量渲染卡死）', () => {
  it('_openPreview 初始化分页状态，每项带稳定 key', () => {
    const c = ctx();
    M._openPreview.call(c, mkQ(100), 't', 'math', 's');
    expect(c.extractPreview.page).toBe(1);
    expect(c.extractPreview.pageSize).toBe(40);
    expect(c.extractPreview.items.length).toBe(100);
    expect(c.extractPreview.items[0]._k).toBe(0);
    expect(c.extractPreview.items[99]._k).toBe(99);
  });

  it('extractPages 按 pageSize 正确算总页数', () => {
    const c = ctx();
    M._openPreview.call(c, mkQ(100), 't', 'math', 's');
    expect(M.extractPages.call(c)).toBe(3);          // ceil(100/40)
    M._openPreview.call(c, mkQ(40), 't', 'math', 's');
    expect(M.extractPages.call(c)).toBe(1);          // 正好一页
    M._openPreview.call(c, mkQ(41), 't', 'math', 's');
    expect(M.extractPages.call(c)).toBe(2);
  });

  it('extractPageItems 只返回当前页，且切页返回不同批', () => {
    const c = ctx();
    M._openPreview.call(c, mkQ(100), 't', 'math', 's');
    const p1 = M.extractPageItems.call(c);
    expect(p1.length).toBe(40);
    expect(p1[0].stem).toBe('题目0');
    M.extractGoPage.call(c, 3);
    const p3 = M.extractPageItems.call(c);
    expect(p3.length).toBe(20);                      // 最后一页只剩 20
    expect(p3[0].stem).toBe('题目80');
  });

  it('extractGoPage 越界会夹到合法范围', () => {
    const c = ctx();
    M._openPreview.call(c, mkQ(100), 't', 'math', 's');
    M.extractGoPage.call(c, 999); expect(c.extractPreview.page).toBe(3);
    M.extractGoPage.call(c, -5); expect(c.extractPreview.page).toBe(1);
    M.extractGoPage.call(c, 'abc'); expect(c.extractPreview.page).toBe(1);
  });

  it('勾选状态跨页保留（改的是 items 上的对象）', () => {
    const c = ctx();
    M._openPreview.call(c, mkQ(100), 't', 'math', 's');
    M.extractPageItems.call(c)[0]._use = false;      // 取消第 1 页第 1 题
    M.extractGoPage.call(c, 2);
    M.extractGoPage.call(c, 1);
    expect(M.extractPageItems.call(c)[0]._use).toBe(false);   // 切回来仍是取消态
    expect(M.extractUseCount.call(c)).toBe(99);
  });

  it('空列表不炸：至少 1 页', () => {
    const c = ctx();
    M._openPreview.call(c, [], 't', 'math', 's');
    expect(M.extractPages.call(c)).toBe(1);
    expect(M.extractPageItems.call(c)).toEqual([]);
  });
});

describe('P1/P2 源码层面守卫', () => {
  it('导入批大小为 80（与后端 batchChunked 对齐，请求数砍半）', () => {
    // 两条题目导入路径（预览导入 / _postQuestions）都应对齐后端的 80
    expect((src.match(/const CH=80/g) || []).length).toBe(2);
    expect(src).not.toMatch(/const CH=40/);
  });
  it('整本抽题不用 concat 累积（避免 O(n²) 重建数组）', () => {
    // 现在整本走 _extractWholeBook：拼接成一条流后一次解析，连累积循环都不需要了
    const body = src.match(/async localExtractBook\(\)[\s\S]*?_openPreview\(all[^\n]*/)[0];
    expect(body).not.toMatch(/all=all\.concat/);
    expect(body).toMatch(/_extractWholeBook\(b\)/);
    const whole = src.match(/_extractWholeBook\(book\)\{[\s\S]*?return qs; \},/)[0];
    expect(whole).not.toMatch(/\.concat\(/);
  });
  it('整本改为「拼接成一条流」解析，修跨页被切断的题', () => {
    const whole = src.match(/_extractWholeBook\(book\)\{[\s\S]*?return qs; \},/)[0];
    expect(whole).toMatch(/texts\.join\(SEP\)/);
    expect(whole).toMatch(/mdToQuestions\(joined/);
    // 只解析一次，不是逐页各来一发
    expect((whole.match(/mdToQuestions\(/g) || []).length).toBe(1);
    // 页码要靠偏移回填，不能整本都记成同一页
    expect(whole).toMatch(/indexOf\(key,cur\)/);
    expect(whole).toMatch(/q\.page=pageAt\(at\)/);
  });
  it('抽题前有正文完整性自检，不拿半本书静默少抽', () => {
    const body = src.match(/async localExtractBook\(\)[\s\S]*?_openPreview\(all[^\n]*/)[0];
    expect(body).toMatch(/matMissingCount/);
    expect(body).toMatch(/没载入完/);
  });
  it('P3：整本抽题对大题量有 confirm 预警', () => {
    const body = src.match(/async localExtractBook\(\)[\s\S]*?_openPreview\(all[^\n]*/)[0];
    expect(body).toMatch(/all\.length>800/);
    expect(body).toMatch(/confirm\(/);
  });
});

describe('批内去重仍然有效（原有能力不回退）', () => {
  it('相同题干只保留一条并计入 dup', () => {
    const c = ctx();
    M._openPreview.call(c, [
      { stem: '同一题', answer: ['A'] },
      { stem: '同一题', answer: ['A'] },
      { stem: ' 同一题 ', answer: ['A'] },   // 空白归一后也算重复
      { stem: '另一题', answer: ['B'] },
    ], 't', 'math', 's');
    expect(c.extractPreview.items.length).toBe(2);
    expect(c.extractPreview.dup).toBe(2);
  });
});

describe('插图转存到 R2（原来是剥成「［图］」，把图题弄成了没法做的题）', () => {
  const bigData = 'data:image/png;base64,' + 'A'.repeat(60000);
  const smallData = 'data:image/png;base64,' + 'B'.repeat(400);

  function ctx2(uploader) {
    const c = Object.assign(Object.create(M), {
      token: 't', bookExtract: { busy: false, prog: '' }, flash() {},
    });
    global.FormData = class { constructor(){ this.d={}; } append(k,v,n){ this.d[k]={v,n}; } };
    global.Blob = class { constructor(parts, o){ this.parts=parts; this.type=(o&&o.type)||''; this.size=(parts[0]&&parts[0].length)||0; } };
    global.atob = (b) => b;                       // 测试里不关心真实解码
    global.fetch = uploader;
    return c;
  }

  it('大图上传 R2 并把 data URL 换成短链，小图留在题干里', async () => {
    let calls = 0;
    const c = ctx2(async () => { calls++; return { ok: true, json: async () => ({ ok: true, url: '/api/qimg?k=qimg/abc.png' }) }; });
    const qs = [{ stem: '对图 1-9 所示的函数\n\n<figure><img src="' + bigData + '"></figure>\n\n下列哪些对？', analysis: '解 见 ![](' + smallData + ')' }];
    const stat = await M._hoistImages.call(c, qs);
    expect(calls).toBe(1);                        // 只有大图上传
    expect(stat).toMatchObject({ total: 2, uploaded: 1, inlined: 1, failed: 0 });
    expect(qs[0].stem).toContain('/api/qimg?k=qimg/abc.png');
    expect(qs[0].stem).not.toContain('base64,AAA');
    expect(qs[0].stem).toContain('对图 1-9 所示的函数');   // 题干正文没被动
    expect(qs[0].analysis).toContain(smallData);   // 小图原样保留
  });

  it('同一张图在多道题里只上传一次，替换却要全覆盖', async () => {
    let calls = 0;
    const c = ctx2(async () => { calls++; return { ok: true, json: async () => ({ ok: true, url: '/api/qimg?k=qimg/one.png' }) }; });
    const qs = [{ stem: 'A ![](' + bigData + ')' }, { stem: 'B ![](' + bigData + ')' }, { stem: 'C 无图' }];
    const stat = await M._hoistImages.call(c, qs);
    expect(calls).toBe(1);
    expect(stat.uploaded).toBe(1);
    expect(qs[0].stem).toContain('qimg/one.png');
    expect(qs[1].stem).toContain('qimg/one.png');
  });

  it('上传失败时保留内嵌——宁可胖也不能把图丢了', async () => {
    const c = ctx2(async () => ({ ok: false, json: async () => ({ error: '未绑定 R2' }) }));
    const qs = [{ stem: '看图 ![](' + bigData + ')' }];
    const stat = await M._hoistImages.call(c, qs);
    expect(stat.failed).toBe(1);
    expect(stat.uploaded).toBe(0);
    expect(qs[0].stem).toContain('base64');       // 图还在
    expect(qs[0].stem).not.toContain('［图］');
  });

  it('选项与答案里的图也一起转存', async () => {
    const c = ctx2(async () => ({ ok: true, json: async () => ({ ok: true, url: '/api/qimg?k=qimg/o.png' }) }));
    const qs = [{ stem: 'x', options: [{ key: 'A', text: '看 ![](' + bigData + ')' }], answer: ['选 ![](' + bigData + ')'] }];
    await M._hoistImages.call(c, qs);
    expect(qs[0].options[0].text).toContain('qimg/o.png');
    expect(qs[0].answer[0]).toContain('qimg/o.png');
  });

  it('没有内嵌图时不发任何请求', async () => {
    let calls = 0;
    const c = ctx2(async () => { calls++; return { ok: true, json: async () => ({}) }; });
    const stat = await M._hoistImages.call(c, [{ stem: '求下列极限' }, { stem: '![](https://r2/x.png)' }]);
    expect(calls).toBe(0);
    expect(stat.total).toBe(0);
  });

  it('外链图片不动（不会被当成 data URL）', async () => {
    const c = ctx2(async () => ({ ok: true, json: async () => ({ ok: true, url: '/api/qimg?k=q.png' }) }));
    const qs = [{ stem: '![图](https://r2.example.com/x.png)' }];
    await M._hoistImages.call(c, qs);
    expect(qs[0].stem).toBe('![图](https://r2.example.com/x.png)');
  });
});

describe('_extractWholeBook：整本拼接解析，修跨页被切断的题', () => {
  // 一道题的题干被切在两页之间（线上实测有 101 道这样的题）
  const bookPages = [
    { page: 48, content_md: '1. 求下列极限：\n\n$\\lim_{x\\to0}\\frac{\\sin x}{x}$ .\n\n解 原式 $=1$ .' },
    { page: 49, content_md: '2. 证明任一最高次幂的指数为奇数的代数方程\n\n$a_0x^{2n+1}+\\dots+a_{2n+1}=0$' },
    { page: 50, content_md: '至少有一个实根,其中 $a_0,\\dots,a_{2n+1}$ 均为常数.\n\n证 设 $f(x)$ 连续,由零点定理即得.' },
  ];
  const book = { title: '高等数学习题全解', subject: 'math', pages: bookPages };

  it('跨页的题干被拼回完整，不再断在句子中间', () => {
    const c = ctx();
    const qs = M._extractWholeBook.call(c, book);
    const hit = qs.find((q) => /最高次幂的指数为奇数/.test(q.stem));
    expect(hit).toBeTruthy();
    expect(hit.stem).toContain('至少有一个实根');       // 逐页解析时这半句会丢
  });

  it('页码按题干在原文里的偏移回填，不是整本记成同一页', () => {
    const c = ctx();
    const qs = M._extractWholeBook.call(c, book);
    const pages = qs.map((q) => q.page);
    expect(pages.every((p) => bookPages.some((m) => m.page === p))).toBe(true);
    expect(new Set(pages).size).toBeGreaterThan(1);
    const first = qs.find((q) => /求下列极限/.test(q.stem));
    expect(first.page).toBe(48);
    const second = qs.find((q) => /最高次幂/.test(q.stem));
    expect(second.page).toBe(49);                       // 题干起点所在页，不是结尾那页
  });

  it('只调用 mdToQuestions 一次（图交给 _hoistImages，这里不动）', () => {
    const c = ctx();
    let calls = 0;
    const real = M.mdToQuestions;
    c.mdToQuestions = function (...a) { calls++; return real.apply(this, a); };
    const d = 'data:image/png;base64,' + 'C'.repeat(3000);
    const qs = M._extractWholeBook.call(c, { title: 't', subject: 'math', pages: [{ page: 1, content_md: '1. 看图 ![](' + d + ') 求值.\n\n解 略.' }] });
    expect(calls).toBe(1);
    expect(qs.length).toBeGreaterThan(0);
  });

  it('空书不炸', () => {
    const c = ctx();
    expect(M._extractWholeBook.call(c, { title: 't', subject: 'math', pages: [] })).toEqual([]);
  });
});
