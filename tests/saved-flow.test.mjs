// 收藏清单 SavedMixin（js/views/saved.js）
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const Saved = new Function(fs.readFileSync(path.join(ROOT, 'js/views/saved.js'), 'utf8') + ';return SavedMixin;')();

function ctx(over = {}) {
  const calls = [];
  return Object.assign({
    calls, token: 't',
    f: { subject: 'all', chapter: '', type: '', tag: '', order: 'seq' },
    fav: { items: [], total: 0, loading: false, offset: 0, limit: 30, sel: [], listMode: true, loadedOnce: false },
    async api(url, opt) { calls.push({ url, method: (opt && opt.method) || 'GET', body: opt && opt.body ? JSON.parse(opt.body) : null }); return { items: [], total: 0 }; },
    flash() {}, subjName: (x) => x, statsDirty: false,
  }, over);
}

describe('loadFav 载入收藏清单', () => {
  it('带 mode=favorite 与筛选参数请求', async () => {
    const c = ctx({ f: { subject: 'math', chapter: '第一章', type: 'single_choice', tag: '易错', order: 'seq' } });
    c.api = async (url) => { c._url = url; return { items: [{ id: 'a' }], total: 5 }; };
    await Saved.methods.loadFav.call(c, true);
    expect(c._url).toContain('mode=favorite');
    expect(c._url).toContain('subject=math');
    expect(c._url).toContain('chapter=');
    expect(c._url).toContain('type=single_choice');
    expect(c._url).toContain('tag=');
    expect(c.fav.items).toEqual([{ id: 'a' }]);
    expect(c.fav.total).toBe(5);
  });
  it('offset>0 时追加而非覆盖', async () => {
    const c = ctx({ fav: { items: [{ id: 'a' }], total: 5, offset: 30, limit: 30, sel: [] } });
    c.api = async () => ({ items: [{ id: 'b' }], total: 5 });
    await Saved.methods.loadFav.call(c, false);
    expect(c.fav.items.map((q) => q.id)).toEqual(['a', 'b']);
  });
});

describe('多选与批量取消收藏', () => {
  beforeEach(() => { global.confirm = () => true; });
  it('favToggleSel 增删选中', () => {
    const c = ctx();
    Saved.methods.favToggleSel.call(c, 'a');
    expect(c.fav.sel).toEqual(['a']);
    Saved.methods.favToggleSel.call(c, 'a');
    expect(c.fav.sel).toEqual([]);
  });
  it('favUnstarSel 对每题发 favorite=0、本地移除、更新总数', async () => {
    const c = ctx({ fav: { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], total: 3, sel: ['a', 'b'], offset: 0, limit: 30 } });
    await Saved.methods.favUnstarSel.call(c);
    const posts = c.calls.filter((x) => x.method === 'POST');
    expect(posts.length).toBe(2);
    expect(posts.every((p) => p.body.action === 'favorite' && p.body.value === 0)).toBe(true);
    expect(c.fav.items.map((q) => q.id)).toEqual(['c']);
    expect(c.fav.total).toBe(1);
    expect(c.fav.sel).toEqual([]);
  });
  it('取消确认则不发请求', async () => {
    global.confirm = () => false;
    const c = ctx({ fav: { items: [{ id: 'a' }], total: 1, sel: ['a'] } });
    await Saved.methods.favUnstarSel.call(c);
    expect(c.calls.length).toBe(0);
  });
});

describe('favUnstarOne 单题取消收藏', () => {
  it('移除该题并更新总数', async () => {
    const c = ctx({ fav: { items: [{ id: 'a' }, { id: 'b' }], total: 2, sel: [] } });
    await Saved.methods.favUnstarOne.call(c, { id: 'a' });
    expect(c.fav.items.map((q) => q.id)).toEqual(['b']);
    expect(c.fav.total).toBe(1);
  });
});

describe('favPractice 从清单进刷题', () => {
  it('切到刷题模式并按收藏起会话', () => {
    let started = false;
    const c = ctx({ startSession() { started = true; } });
    Saved.methods.favPractice.call(c);
    expect(c.fav.listMode).toBe(false);
    expect(c.f._mode).toBe('favorite');
    expect(started).toBe(true);
  });
});
