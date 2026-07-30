// 静态守卫：`this.foo(` 却没有任何地方定义 foo —— 这类错误运行时才炸，而且往往被
// try/finally 或事件处理器吞掉，表现成「按钮点了没反应」，测试里再被 fake context
// 的桩掩盖掉。v174 就是这么把 _yieldToPaint 的定义删了而调用点留着的。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const FILES = [
  'js/api.js', 'js/app.js',
  'js/components/reader.js', 'js/components/rich-text.js', 'js/components/question-card.js',
  'js/views/practice.js', 'js/views/bank.js', 'js/views/mock-stats.js', 'js/views/ingest.js',
  'js/views/mineru.js', 'js/views/books.js', 'js/views/pdftool.js', 'js/views/saved.js', 'js/views/settings.js',
];
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Vue 实例上真实可用但不在源码里定义的东西
const BUILTINS = new Set(['$nextTick', '$forceUpdate', '$emit', '$watch', '$set', '$refs']);

function collect(sources) {
  const defined = new Set();
  const called = new Map();          // name -> [文件:行]
  for (const [file, s] of sources) {
    // 方法定义：行首、或紧跟 { , 之后（覆盖 `methods:{ enhance(){` 这种同行写法）
    for (const m of s.matchAll(/(?:^|[{,])\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) defined.add(m[1]);
    // data / computed / 对象属性键
    for (const m of s.matchAll(/^\s{2,8}([A-Za-z_$][\w$]*)\s*:/gm)) defined.add(m[1]);
    // 箭头函数属性
    for (const m of s.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?\(/gm)) defined.add(m[1]);
    // 调用点
    s.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/this\.([A-Za-z_$][\w$]*)\s*\(/g)) {
        if (!called.has(m[1])) called.set(m[1], []);
        called.get(m[1]).push(file + ':' + (i + 1));
      }
    });
  }
  return { defined, called };
}

const sources = FILES.map((f) => [f, read(f)]);

describe('this.xxx() 的调用点都必须有定义', () => {
  it('全站没有「调用了但谁都没定义」的方法', () => {
    const { defined, called } = collect(sources);
    const missing = [...called.keys()].filter((n) => !defined.has(n) && !BUILTINS.has(n))
      .map((n) => n + '  ← ' + called.get(n).join(', '));
    expect(missing).toEqual([]);
  });

  it('这个检查确实能抓住「删了定义、留着调用」（自检）', () => {
    // 把 ingest.js 里 _yieldToPaint 的定义抠掉，调用点保留 —— 必须被检出
    const broken = sources.map(([f, s]) => [f, f.endsWith('ingest.js')
      ? s.replace(/_yieldToPaint\(\)\{[\s\S]*?\}\); \},\n/, '') : s]);
    const { defined, called } = collect(broken);
    expect(called.has('_yieldToPaint')).toBe(true);
    expect(defined.has('_yieldToPaint')).toBe(false);
  });

  it('_yieldToPaint 本体存在，且两个抽题入口都会调它', () => {
    const ing = read('js/views/ingest.js');
    expect(ing).toMatch(/_yieldToPaint\(\)\{/);
    expect((ing.match(/this\._yieldToPaint\(\)/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('抽题入口调用的每个自有方法都在 ingest.js 或其它 mixin 里', () => {
    const ing = read('js/views/ingest.js');
    const body = ing.slice(ing.indexOf('async localExtractPage(){'), ing.indexOf('async extractDoImport(){'));
    const { defined } = collect(sources);
    const used = [...new Set([...body.matchAll(/this\.([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]))];
    expect(used.filter((n) => !defined.has(n) && !BUILTINS.has(n))).toEqual([]);
    expect(used).toContain('_yieldToPaint');
    expect(used).toContain('_hoistImages');
  });
});

describe('_yieldToPaint 不能挂死（后台标签页里 rAF 不触发）', () => {
  const Ingest = new Function(fs.readFileSync(path.join(ROOT, 'js/views/ingest.js'), 'utf8') + ';return IngestMixin;')();
  const Y = Ingest.methods._yieldToPaint;

  it('没有 requestAnimationFrame 时靠 setTimeout 兜底', async () => {
    const saved = global.requestAnimationFrame;
    delete global.requestAnimationFrame;
    await expect(Promise.race([Y.call({}), new Promise((_, rej) => setTimeout(() => rej(new Error('挂死')), 500))])).resolves.toBeUndefined();
    if (saved) global.requestAnimationFrame = saved;
  });

  it('rAF 存在但永不触发（隐藏标签页）时也必须在超时后 resolve —— 这正是线上卡死的成因', async () => {
    const saved = global.requestAnimationFrame;
    global.requestAnimationFrame = () => {};            // 注册了但永远不回调
    const t0 = Date.now();
    await expect(Promise.race([Y.call({}), new Promise((_, rej) => setTimeout(() => rej(new Error('挂死')), 1000))])).resolves.toBeUndefined();
    expect(Date.now() - t0).toBeLessThan(500);
    if (saved) global.requestAnimationFrame = saved; else delete global.requestAnimationFrame;
  });

  it('rAF 正常时不会因为兜底而 resolve 两次', async () => {
    let calls = 0;
    global.requestAnimationFrame = (cb) => { setTimeout(cb, 1); };
    const p = Y.call({});
    p.then(() => { calls++; });
    await new Promise((r) => setTimeout(r, 200));
    expect(calls).toBe(1);
    delete global.requestAnimationFrame;
  });

  it('源码里有超时兜底，不是只有 rAF', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/views/ingest.js'), 'utf8');
    const body = src.slice(src.indexOf('_yieldToPaint(){'), src.indexOf('async localExtractPage(){'));
    expect(body).toMatch(/setTimeout\(/);
    expect(body).toMatch(/requestAnimationFrame/);
  });
});
