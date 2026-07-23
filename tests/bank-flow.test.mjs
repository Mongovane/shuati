// 题库页新增/改进的方法（js/views/bank.js）——mixin 对象字面量，用 fake this 调用
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const src = fs.readFileSync(path.join(ROOT, 'js/views/bank.js'), 'utf8');
const Bank = new Function(src + ';return BankMixin;')();

function ctx(over = {}) {
  const calls = [];
  return Object.assign({
    calls, token: 't',
    bank: { items: [], sel: [], total: 0, mode: 'all' },
    async api(url, opt) { calls.push({ url, method: (opt && opt.method) || 'GET', body: opt && opt.body ? JSON.parse(opt.body) : null }); return { ok: true, updated: (opt && opt.body ? (JSON.parse(opt.body).ids || []).length : 0), items: [] }; },
    flash() {}, loadMeta() {}, subjName: (x) => x, isChoiceType: (t) => ['single_choice', 'multiple_choice', 'true_false'].includes(t),
  }, over);
}

describe('批量改章节 bankBatchChapter', () => {
  beforeEach(() => { global.prompt = () => '第三章-指针'; });
  it('PATCH chapter 并本地同步；未选提示', async () => {
    const c = ctx({ bank: { items: [{ id: 'a', chapter: '旧' }, { id: 'b', chapter: '旧' }], sel: ['a', 'b'], mode: 'all' } });
    await Bank.methods.bankBatchChapter.call(c);
    const patch = c.calls.find((x) => x.method === 'PATCH');
    expect(patch.body.chapter).toBe('第三章-指针');
    expect(patch.body.ids).toEqual(['a', 'b']);
    expect(c.bank.items.every((q) => q.chapter === '第三章-指针')).toBe(true);
    expect(c.bank.sel).toEqual([]);
  });
  it('用户取消 prompt → 不发请求', async () => {
    global.prompt = () => null;
    const c = ctx({ bank: { items: [{ id: 'a' }], sel: ['a'] } });
    await Bank.methods.bankBatchChapter.call(c);
    expect(c.calls.length).toBe(0);
  });
});

describe('批量加标签 bankBatchTag（合并去重）', () => {
  it('把新标签并入原标签、去重', async () => {
    global.prompt = () => '易错, 指针';
    const c = ctx({ bank: { items: [{ id: 'a', tags: ['指针'] }, { id: 'b', tags: [] }], sel: ['a', 'b'] } });
    await Bank.methods.bankBatchTag.call(c);
    expect(c.bank.items[0].tags.sort()).toEqual(['指针', '易错']);   // 原有指针不重复
    expect(c.bank.items[1].tags.sort()).toEqual(['指针', '易错']);
  });
});

describe('导出选中 bankExportSel', () => {
  it('拉全字段并触发下载（选中优先，未选导出已加载列表）', async () => {
    // 桩 DOM 下载
    let clicked = false, dlName = '';
    global.URL.createObjectURL = () => 'blob:x'; global.URL.revokeObjectURL = () => {};
    const origCreate = global.document?.createElement;
    global.document = { createElement: () => ({ href: '', download: '', set href(v) {}, click() { clicked = true; }, remove() {}, set download(v) { dlName = v; }, get download() { return dlName; } }), body: { appendChild() {}, removeChild() {} } };
    global.Blob = class { constructor(parts) { this.parts = parts; } };
    const c = ctx({ bank: { items: [{ id: 'a' }], sel: ['a'], mode: 'all' } });
    c.api = async () => ({ items: [{ subject: 'math', type: 'single_choice', stem: 'x', options: [{ key: 'A', text: '1' }], answer: ['A'], difficulty: 3, tags: [] }] });
    await Bank.methods.bankExportSel.call(c);
    expect(clicked).toBe(true);
    expect(dlName).toMatch(/shuati-questions-.*\.json/);
    if (origCreate) global.document.createElement = origCreate;
  });
});

describe('编辑保存 bankSaveEdit 补全字段', () => {
  it('PATCH 带上 chapter/difficulty/tags 且本地同步', async () => {
    const q = { id: 'a', stem: '旧', options: [], answer: [] };
    const c = ctx({
      bankEdit: { open: true, q, stem: '新题干', analysis: '', subject: 'math', type: 'single_choice', chapter: '第一章', difficulty: 4, tags: '易错, 重点', options: [{ key: 'A', text: 'x' }], answerText: 'A', busy: false },
      bankCloseEdit() { this.bankEdit.open = false; },
    });
    await Bank.methods.bankSaveEdit.call(c);
    const patch = c.calls.find((x) => x.method === 'PATCH');
    expect(patch.body.chapter).toBe('第一章');
    expect(patch.body.difficulty).toBe(4);
    expect(patch.body.tags).toEqual(['易错', '重点']);
    expect(q.chapter).toBe('第一章');
    expect(q.difficulty).toBe(4);
    expect(q.tags).toEqual(['易错', '重点']);
  });
});
