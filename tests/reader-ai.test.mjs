// 阅读器 AI 交互（js/views/books.js 的 pdfAiStop、js/components/reader.js 的 rdAiStop/bookAskAI）
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const Books = new Function(fs.readFileSync(path.join(ROOT, 'js/views/books.js'), 'utf8') + ';return BooksMixin;')();
const Reader = new Function(fs.readFileSync(path.join(ROOT, 'js/components/reader.js'), 'utf8') + ';return ReaderMixin;')();

describe('PDF 问答停止 pdfAiStop', () => {
  it('中止 AbortController、清 asking、无内容时标记「已停止」', () => {
    let aborted = false;
    const ctx = { _pdfAiCtrl: { abort() { aborted = true; } }, pdfAi: { asking: true, chat: [{ q: '问', a: '' }] } };
    Books.methods.pdfAiStop.call(ctx);
    expect(aborted).toBe(true);
    expect(ctx.pdfAi.asking).toBe(false);
    expect(ctx.pdfAi.chat[0].a).toBe('_（已停止）_');
  });
  it('已有部分流式内容则保留，不覆盖成「已停止」', () => {
    const ctx = { _pdfAiCtrl: { abort() {} }, pdfAi: { asking: true, chat: [{ q: '问', a: '已经回答了一半' }] } };
    Books.methods.pdfAiStop.call(ctx);
    expect(ctx.pdfAi.chat[0].a).toBe('已经回答了一半');
  });
  it('没有进行中的请求也不报错', () => {
    const ctx = { pdfAi: { asking: false, chat: [] } };
    expect(() => Books.methods.pdfAiStop.call(ctx)).not.toThrow();
  });
});

describe('书架层级改科目 setBookSubjectByKey', () => {
  it('对指定书的每一页 saveOneMaterial 改 subject，不依赖当前打开的书', async () => {
    const saved = [];
    const ctx = { token: 't', materials: { loading: false },
      async saveOneMaterial(m) { saved.push(m); }, async loadMaterials() {}, flash() {}, subjName: (x) => x };
    // setBookSubjectByKey 转发到 _setBookSubjectPages，绑上同一 mixin 的该方法
    ctx._setBookSubjectPages = Books.methods._setBookSubjectPages.bind(ctx);
    const book = { title: '高数', pages: [{ id: 'a', content_md: 'x' }, { id: 'b', content_md: 'y' }] };
    await Books.methods.setBookSubjectByKey.call(ctx, book, 'math');
    expect(saved.length).toBe(2);
    expect(saved.every((m) => m.subject === 'math')).toBe(true);
  });
  it('缺参数直接返回，不报错', async () => {
    const ctx = { flash() {}, _setBookSubjectPages() {} };
    await expect(Books.methods.setBookSubjectByKey.call(ctx, null, 'math')).resolves.toBeUndefined();
  });
});

describe('pdfvClose 关闭 PDF 阅读器（切视图时调用，修复白屏残留）', () => {
  it('置 open=false、清空 doc、断开 observer', () => {
    let obsDisc = false, obsRDisc = false;
    const ctx = {
      pdfv: { open: true, barsOff: true },
      pdfAi: { open: false, asking: false, input: '', chat: [], pageAtOpen: 0, _cacheP: 0, _cacheT: '', _cacheImgP: 0, _cacheImg: '' },
      _pdfAiReset: Books.methods._pdfAiReset,
      $refs: {}, _pdfvScroll: null, _pdfvSingleTask: null,
      _pdfvDoc: { fake: true },
      _pdfvObs: { disconnect() { obsDisc = true; } },
      _pdfvObsR: { disconnect() { obsRDisc = true; } },
    };
    ctx._pdfAiReset = Books.methods._pdfAiReset.bind(ctx);
    Books.methods.pdfvClose.call(ctx);
    expect(ctx.pdfv.open).toBe(false);
    expect(ctx._pdfvDoc).toBe(null);
    expect(obsDisc).toBe(true);
    expect(obsRDisc).toBe(true);
    expect(ctx._pdfvObs).toBe(null);
  });
});

describe('沉浸阅读状态栏配色 _readerBarColor', () => {
  it('按阅读主题设置 theme-color meta', () => {
    let colorSet = '';
    global.document = { getElementById: () => ({ setAttribute: (k, v) => { colorSet = v; } }) };
    const ctx = { reader: { theme: 'night' } };
    Reader.methods._readerBarColor.call(ctx);
    expect(colorSet).toBe('#16161a');
    ctx.reader.theme = 'sepia';
    Reader.methods._readerBarColor.call(ctx);
    expect(colorSet).toBe('#ecdcc0');
  });
  it('未知主题回退纸白', () => {
    let colorSet = '';
    global.document = { getElementById: () => ({ setAttribute: (k, v) => { colorSet = v; } }) };
    Reader.methods._readerBarColor.call({ reader: { theme: 'xxx' } });
    expect(colorSet).toBe('#f6f5f1');
  });
  it('readerClose 调用 applyTheme 恢复 app 主题色', () => {
    let restored = false;
    const ctx = { reader: { open: true, panel: false, tocOpen: false }, applyTheme() { restored = true; } };
    Reader.methods.readerClose.call(ctx);
    expect(ctx.reader.open).toBe(false);
    expect(restored).toBe(true);
  });
});

describe('切换 PDF 重置问 AI（_pdfAiReset）', () => {
  it('清空对话、中止请求、清页缓存', () => {
    let aborted = false;
    const ctx = { _pdfAiCtrl: { abort() { aborted = true; } },
      pdfAi: { open: true, asking: true, input: '在问', chat: [{ q: '旧', a: '旧答' }], pageAtOpen: 3, _cacheP: 3, _cacheT: '旧页文字', _cacheImgP: 3, _cacheImg: 'data:...' } };
    Books.methods._pdfAiReset.call(ctx);
    expect(aborted).toBe(true);
    expect(ctx.pdfAi.chat).toEqual([]);
    expect(ctx.pdfAi.open).toBe(false);
    expect(ctx.pdfAi.input).toBe('');
    expect(ctx.pdfAi._cacheT).toBe('');
    expect(ctx.pdfAi._cacheImg).toBe('');
    expect(ctx._pdfAiCtrl).toBe(null);
  });
});

describe('AI 出题停止 genqStop', () => {
  it('中止请求、解除 busy', () => {
    let aborted = false;
    const ctx = { _genqCtrl: { abort() { aborted = true; } }, genq: { busy: true }, flash() {} };
    Books.methods.genqStop.call(ctx);
    expect(aborted).toBe(true);
    expect(ctx.genq.busy).toBe(false);
  });
  it('没有进行中的请求也不报错', () => {
    const ctx = { genq: { busy: false }, flash() {} };
    expect(() => Books.methods.genqStop.call(ctx)).not.toThrow();
  });
});

describe('Markdown 阅读器问答停止 rdAiStop', () => {
  it('中止并清 asking', () => {
    let aborted = false;
    const ctx = { _rdCtrl: { abort() { aborted = true; } }, rdAi: { asking: true, chat: [{ q: 'x', a: '' }] } };
    Reader.methods.rdAiStop.call(ctx);
    expect(aborted).toBe(true);
    expect(ctx.rdAi.asking).toBe(false);
    expect(ctx.rdAi.chat[0].a).toBe('_（已停止）_');
  });
});

describe('内联章节问 AI（bookAskAI）就地开面板', () => {
  it('不进沉浸阅读，直接打开 rdAi 面板并清空引用', () => {
    let opened = false;
    const ctx = {
      currentBook: { pages: [{}] }, currentPageMat: {},
      reader: { open: false }, rdAi: { open: false, quote: 'x' },
      readerOpen() { opened = true; },
      $nextTick() {}, $refs: {},
    };
    Reader.methods.bookAskAI.call(ctx);
    expect(opened, '不应再强制进入沉浸阅读').toBe(false);
    expect(ctx.rdAi.open).toBe(true);
    expect(ctx.rdAi.quote).toBe('');
    expect(ctx.reader.open).toBe(false);
  });
  it('没选书 → 提示且不开面板', () => {
    let flashed = false;
    const ctx = { currentBook: null, currentPageMat: null, reader: { open: false }, rdAi: { open: false }, flash() { flashed = true; }, readerOpen() {}, $nextTick() {}, $refs: {} };
    Reader.methods.bookAskAI.call(ctx);
    expect(flashed).toBe(true);
    expect(ctx.rdAi.open).toBe(false);
  });
});
