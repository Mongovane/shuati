// 通用防重入守卫：这些按钮都写库或触发下载，且模板上原本没有 :disabled。
// 慢的时候用户会连点——轻则重复下载/重复扣 AI 额度，重则第二次点击落在已经变化的状态上。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');

// 把所有 mixin 与 app.js 的守卫段一起装起来，拿到真正的 GuardMixin
const MIXIN_FILES = ['js/api.js', 'js/components/reader.js', 'js/views/practice.js', 'js/views/bank.js',
  'js/views/mock-stats.js', 'js/views/ingest.js', 'js/views/mineru.js', 'js/views/books.js',
  'js/views/pdftool.js', 'js/views/saved.js', 'js/views/settings.js'];
const guardSection = appSrc.slice(appSrc.indexOf('const MIXINS ='), appSrc.indexOf('const App={'));
const built = new Function(
  MIXIN_FILES.map(read).join('\n') + '\n' + guardSection + ';return {MIXINS, GUARDED_OPS, GuardMixin};'
)();
const { MIXINS, GUARDED_OPS, GuardMixin } = built;

describe('守卫名单本身要站得住', () => {
  it('名单里每个名字都能在 mixin 里找到实现（防手误写错名字后静默失效）', () => {
    const missing = GUARDED_OPS.filter((n) => !MIXINS.some((mx) => mx.methods && mx.methods[n]));
    expect(missing).toEqual([]);
    expect(GuardMixin.methods && Object.keys(GuardMixin.methods).length).toBe(GUARDED_OPS.length);
  });

  it('写库/下载类的点击方法都在名单里', () => {
    for (const n of ['bankBatchDelete', 'bankBatchTag', 'bankBatchChapter', 'bankBatchSubject', 'bankAutoClassify',
      'bankDelete', 'deleteCurrentQuestion', 'dropFromReview', 'favUnstarOne', 'favUnstarSel',
      'deleteBook', 'deleteMock', 'subjSave', 'subjDelete', 'loadSample', 'bankExportSel', 'favExportSel']) {
      expect(GUARDED_OPS).toContain(n);
    }
  });

  it('startSession 不能进名单——它有 onFilter 等程序化调用，守卫会吞掉正常重新开局', () => {
    expect(GUARDED_OPS).not.toContain('startSession');
    expect(read('js/views/practice.js')).toMatch(/onFilter\(\)\{[^}]*this\.startSession\(\)/);
  });

  it('名单内的方法没有其它内部调用点（否则守卫会误伤程序化调用）', () => {
    const src = MIXIN_FILES.map(read).join('\n') + appSrc;
    for (const n of GUARDED_OPS) {
      const calls = [...src.matchAll(new RegExp('this\\.' + n + '\\s*\\(', 'g'))].length;
      // deleteBook 只有 deleteCurrentBook 这一处转发，继承守卫正是想要的
      expect(calls).toBeLessThanOrEqual(n === 'deleteBook' ? 1 : 0);
    }
  });
});

describe('包装后的行为', () => {
  // 造一个最小 this：busyOps + 一个可控的原方法
  // 用真实的 app.js 守卫代码构造包装器：把 11 个 mixin 名当参数塞成同一个假 mixin，
  // 这样 MIXINS 数组成立，名单换成 ['probe'] 就能拿到包装后的探针方法。
  const MIXIN_NAMES = ['ApiMixin', 'ReaderMixin', 'PracticeMixin', 'BankMixin', 'MockStatsMixin',
    'IngestMixin', 'MineruMixin', 'BooksMixin', 'PdfToolMixin', 'SavedMixin', 'SettingsMixin'];
  function wrap(orig) {
    const fake = { methods: { probe: orig } };
    const body = guardSection.replace(/const GUARDED_OPS = \[[\s\S]*?\];/, "const GUARDED_OPS = ['probe'];");
    const mix = new Function(...MIXIN_NAMES, body + ';return GuardMixin;')(...MIXIN_NAMES.map(() => fake));
    return mix.methods.probe;
  }

  it('第一次调用照常执行，busy 期间的重复调用被忽略', async () => {
    let runs = 0;
    const probe = wrap(async function () { runs++; await new Promise((r) => setTimeout(r, 5)); return 'ok'; });
    const ctx = { busyOps: {} };
    const a = probe.call(ctx);
    expect(ctx.busyOps.probe).toBe(true);
    const b = probe.call(ctx);
    const c = probe.call(ctx);
    expect(await a).toBe('ok');
    expect(b).toBe(undefined);
    expect(c).toBe(undefined);
    expect(runs).toBe(1);
    expect(ctx.busyOps.probe).toBe(false);
  });

  it('完成后可以再次调用（不是一次性锁）', async () => {
    let runs = 0;
    const probe = wrap(async function () { runs++; });
    const ctx = { busyOps: {} };
    await probe.call(ctx);
    await probe.call(ctx);
    expect(runs).toBe(2);
  });

  it('原方法抛异常也要复位，不能把按钮永久锁死', async () => {
    const probe = wrap(async function () { throw new Error('boom'); });
    const ctx = { busyOps: {} };
    await expect(probe.call(ctx)).rejects.toThrow('boom');
    expect(ctx.busyOps.probe).toBe(false);
  });

  it('同步抛错也复位', () => {
    const probe = wrap(function () { throw new Error('sync'); });
    const ctx = { busyOps: {} };
    expect(() => probe.call(ctx)).toThrow('sync');
    expect(ctx.busyOps.probe).toBe(false);
  });

  it('同步返回值原样透传，且不会残留 busy', () => {
    const probe = wrap(function (x) { return x * 2; });
    const ctx = { busyOps: {} };
    expect(probe.call(ctx, 21)).toBe(42);
    expect(ctx.busyOps.probe).toBe(false);
  });

  it('参数完整传给原方法，this 也正确', async () => {
    let got = null;
    const probe = wrap(async function (a, b) { got = [a, b, this.marker]; });
    await probe.call({ busyOps: {}, marker: 'me' }, 1, 'two');
    expect(got).toEqual([1, 'two', 'me']);
  });
});

describe('模板反馈：耗时按钮要置灰', () => {
  it('批量/AI/导出按钮都绑了 busyOps', () => {
    const bank = read('js/tpl/view-bank.js');
    for (const n of ['bankAutoClassify', 'bankBatchSubject', 'bankBatchChapter', 'bankBatchTag', 'bankExportSel', 'bankBatchDelete']) {
      expect(bank).toContain(':disabled="busyOps.' + n + '"');
    }
    const prac = read('js/tpl/view-practice.js');
    expect(prac).toContain(':disabled="busyOps.favUnstarSel"');
    expect(prac).toContain(':disabled="busyOps.favExportSel"');
    expect(read('js/tpl/view-ingest.js')).toContain(':disabled="busyOps.loadSample"');
  });

  it('busyOps 在 data 里声明了（否则模板取不到、也不响应）', () => {
    expect(appSrc).toMatch(/busyOps:\{\}/);
  });

  it('GuardMixin 挂在 mixins 末尾，才能覆盖原方法', () => {
    expect(appSrc).toMatch(/mixins:\s*\[\.\.\.MIXINS,\s*GuardMixin\]/);
  });
});
