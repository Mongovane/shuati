// 批量标签 / 批量收藏：原来这两个是「循环里每题一个请求」，
// 且批量加标签只遍历当前页 items，跨页勾选的 id 会被静默跳过而提示照旧说成功。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FakeDB, authedReq, makeEnv, ROOT } from './helpers.mjs';
import { onRequestPatch as questionsPatch } from '../functions/api/questions.js';
import { onRequestPost as progressPost } from '../functions/api/progress.js';

const patchReq = (body) => authedReq('http://x/api/questions', { method: 'PATCH', body: JSON.stringify(body) });
const progReq = (body) => authedReq('http://x/api/progress', { method: 'POST', body: JSON.stringify(body) });

describe('PATCH /api/questions 的 addTags（服务端读改写）', () => {
  const rows = (m) => [{ match: /SELECT id, tags FROM questions/, value: m }];

  it('与原标签合并去重，只写真正变了的行', async () => {
    const db = new FakeDB(rows([
      { id: 'a', tags: '["指针"]' },
      { id: 'b', tags: '["指针","链表"]' },   // 已经有了，不该写
      { id: 'c', tags: null },
    ]));
    const res = await questionsPatch({ request: patchReq({ ids: ['a', 'b', 'c'], addTags: ['链表'] }), env: makeEnv(db) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.updated).toBe(2);          // b 无变化被跳过
    expect(body.matched).toBe(3);
    const ups = db.stmts(/UPDATE questions SET tags/);
    expect(ups.length).toBe(2);
    const byId = Object.fromEntries(ups.map((s) => [s.binds[1], JSON.parse(s.binds[0])]));
    expect(byId.a).toEqual(['指针', '链表']);
    expect(byId.c).toEqual(['链表']);
  });

  it('找不到的 id 如实报 missing，不再假装全部成功', async () => {
    const db = new FakeDB(rows([{ id: 'a', tags: '[]' }]));
    const res = await questionsPatch({ request: patchReq({ ids: ['a', 'ghost1', 'ghost2'], addTags: ['x'] }), env: makeEnv(db) });
    const body = await res.json();
    expect(body.matched).toBe(1);
    expect(body.missing).toBe(2);
  });

  it('removeTags 能删标签，也能和 addTags 一起用', async () => {
    const db = new FakeDB(rows([{ id: 'a', tags: '["旧","保留"]' }]));
    await questionsPatch({ request: patchReq({ ids: ['a'], addTags: ['新'], removeTags: ['旧'] }), env: makeEnv(db) });
    const up = db.stmts(/UPDATE questions SET tags/)[0];
    expect(JSON.parse(up.binds[0])).toEqual(['保留', '新']);
  });

  it('tags 与 addTags 同时给就报 400（语义冲突，不要静默择一）', async () => {
    const db = new FakeDB(rows([]));
    const res = await questionsPatch({ request: patchReq({ ids: ['a'], tags: ['x'], addTags: ['y'] }), env: makeEnv(db) });
    expect(res.status).toBe(400);
    expect(db.ran(/UPDATE questions/)).toBe(false);
  });

  it('tags 字段是脏数据（非 JSON / 非数组）时当空数组处理，不炸', async () => {
    const db = new FakeDB(rows([{ id: 'a', tags: '不是JSON' }, { id: 'b', tags: '{"x":1}' }]));
    const res = await questionsPatch({ request: patchReq({ ids: ['a', 'b'], addTags: ['t'] }), env: makeEnv(db) });
    expect(res.status).toBe(200);
    for (const s of db.stmts(/UPDATE questions SET tags/)) expect(JSON.parse(s.binds[0])).toEqual(['t']);
  });

  it('id 很多时 SELECT 按 80 分块，不撞 D1 变量上限', async () => {
    const ids = Array.from({ length: 200 }, (_, i) => 'q' + i);
    const db = new FakeDB(rows([]));
    await questionsPatch({ request: patchReq({ ids, addTags: ['t'] }), env: makeEnv(db) });
    const sels = db.stmts(/SELECT id, tags FROM questions/);
    expect(sels.length).toBe(3);                                  // 80 + 80 + 40
    expect(Math.max(...sels.map((s) => s.binds.length))).toBeLessThanOrEqual(80);
  });

  it('addTags 与普通字段同时给时，两者都生效', async () => {
    const db = new FakeDB(rows([{ id: 'a', tags: '[]' }]));
    const res = await questionsPatch({ request: patchReq({ ids: ['a'], addTags: ['t'], chapter: '第一章' }), env: makeEnv(db) });
    expect(res.status).toBe(200);
    expect(db.ran(/UPDATE questions SET tags/)).toBe(true);
    expect(db.ran(/UPDATE questions SET chapter = \?/)).toBe(true);
  });

  it('空白 / 超量标签被清理', async () => {
    const db = new FakeDB(rows([{ id: 'a', tags: '[]' }]));
    await questionsPatch({ request: patchReq({ ids: ['a'], addTags: ['  ', '', ' 有效 ', ...Array.from({ length: 80 }, (_, i) => 't' + i)] }), env: makeEnv(db) });
    const tags = JSON.parse(db.stmts(/UPDATE questions SET tags/)[0].binds[0]);
    expect(tags).toContain('有效');
    expect(tags.every((t) => t.trim() === t && t.length > 0)).toBe(true);
    expect(tags.length).toBeLessThanOrEqual(50);
  });
});

describe('POST /api/progress 的批量收藏/掌握', () => {
  it('question_ids 走批量分支，一次 batch 写完', async () => {
    const db = new FakeDB([]);
    const res = await progressPost({ request: progReq({ action: 'favorite', question_ids: ['a', 'b', 'c'], value: 0 }), env: makeEnv(db) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.count).toBe(3);
    const ups = db.stmts(/INSERT INTO progress .*favorited/s);
    expect(ups.length).toBe(3);
    expect(ups.map((s) => s.binds[0])).toEqual(['a', 'b', 'c']);
    expect(ups.every((s) => s.binds[1] === 0)).toBe(true);
  });

  it('master 也支持批量，写的是 mastered 列', async () => {
    const db = new FakeDB([]);
    await progressPost({ request: progReq({ action: 'master', question_ids: ['a'], value: 1 }), env: makeEnv(db) });
    expect(db.ran(/INSERT INTO progress .*mastered/s)).toBe(true);
    expect(db.ran(/favorited/)).toBe(false);
  });

  it('空 question_ids 报 400，不当成「缺少 question_id」', async () => {
    const db = new FakeDB([]);
    const res = await progressPost({ request: progReq({ action: 'favorite', question_ids: [], value: 0 }), env: makeEnv(db) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/question_ids/);
  });

  it('仍然兼容单个 question_id 的老写法', async () => {
    const db = new FakeDB([]);
    const res = await progressPost({ request: progReq({ action: 'favorite', question_id: 'a', value: 1 }), env: makeEnv(db) });
    expect(res.status).toBe(200);
    expect(db.stmts(/INSERT INTO progress .*favorited/s).length).toBe(1);
  });

  it('超过 2000 个 id 会截断，不至于打爆 batch', async () => {
    const db = new FakeDB([]);
    const many = Array.from({ length: 2500 }, (_, i) => 'q' + i);
    const body = await (await progressPost({ request: progReq({ action: 'favorite', question_ids: many, value: 0 }), env: makeEnv(db) })).json();
    expect(body.count).toBe(2000);
  });
});

describe('前端：批量加标签不再逐题发请求、也不再谎报条数', () => {
  const Bank = new Function(fs.readFileSync(path.join(ROOT, 'js/views/bank.js'), 'utf8') + ';return BankMixin;')();

  function ctx(resp) {
    const calls = [];
    return Object.assign(Object.create(Bank.methods), {
      calls, flashes: [],
      token: 't', bank: { sel: ['a', 'b', 'zzz'], items: [{ id: 'a', tags: ['旧'] }] },   // zzz 不在当前页
      flash(msg, bad) { this.flashes.push([msg, !!bad]); },
      loadMeta() {},
      async api(p, o) { calls.push({ p, body: JSON.parse((o && o.body) || '{}') }); return resp; },
    });
  }

  it('一个请求带上全部 ids 和 addTags，不依赖当前页 items', async () => {
    global.prompt = () => '链表, 指针';
    const c = ctx({ ok: true, updated: 1, matched: 3, missing: 0 });   // 只有 1 行真的变了，但 3 题都带上了标签
    await Bank.methods.bankBatchTag.call(c);
    expect(c.calls.length).toBe(1);
    expect(c.calls[0].body.ids).toEqual(['a', 'b', 'zzz']);
    expect(c.calls[0].body.addTags).toEqual(['链表', '指针']);
    expect(c.calls[0].body.tags).toBe(undefined);
    expect(c.bank.items[0].tags).toEqual(['旧', '链表', '指针']);     // 本页的就地更新
    expect(c.flashes[0][0]).toContain('3 题');
  });

  it('服务端说有 id 找不到时，提示里如实说出来并标为警告', async () => {
    global.prompt = () => '链表';
    const c = ctx({ ok: true, updated: 2, matched: 2, missing: 1 });
    await Bank.methods.bankBatchTag.call(c);
    expect(c.flashes[0][0]).toContain('2 题');   // 报 matched，不是 ids.length=3
    expect(c.flashes[0][0]).toMatch(/1 题.*找不到/);
    expect(c.flashes[0][1]).toBe(true);
  });

  it('取消 prompt 不发请求', async () => {
    global.prompt = () => null;
    const c = ctx({});
    await Bank.methods.bankBatchTag.call(c);
    expect(c.calls.length).toBe(0);
  });
});
