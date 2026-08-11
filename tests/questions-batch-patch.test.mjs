// PATCH /api/questions 的 items 路径：按 id 分别赋值。
// 为什么要有这条：原来的 {ids, 字段} 是「给所有 id 设同一个值」，AI 补答案这种
// 每题答案都不一样的场景用不上，前端只能一题一个请求 —— 200 题 200 次往返，
// 中途失败还会留下补了一半的状态。
import { describe, it, expect } from 'vitest';
import { FakeDB, authedReq, makeEnv } from './helpers.mjs';
import { onRequestPatch as patchQ } from '../functions/api/questions.js';

// SELECT id 校验存在性：默认把绑进来的 id 全部当成存在
const dbWith = (existing) => new FakeDB([
  { match: /SELECT id FROM questions/i, value: (binds) => binds.filter((b) => existing.includes(b)).map((id) => ({ id })) },
]);
const call = (body, db) => patchQ({
  request: authedReq('http://x/api/questions', { method: 'PATCH', body: JSON.stringify(body) }),
  env: Object.assign(makeEnv(db), { DB: db }),
});
const updates = (db) => db.log.filter((r) => /^UPDATE questions SET/.test(r.sql));

describe('逐题不同值', () => {
  it('每题各写自己的答案', async () => {
    const db = dbWith(['a', 'b']);
    const res = await call({ items: [
      { id: 'a', answer: ['A'], status: 'draft' },
      { id: 'b', answer: ['B', 'C'], analysis: '乙的解析' },
    ] }, db);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toMatchObject({ ok: true, updated: 2, missing: [] });
    const ups = updates(db);
    expect(ups).toHaveLength(2);
    // 绑定顺序按服务端 ALLOWED 数组走（analysis 在 answer 之前），
    // 与入参 key 的书写顺序无关 —— 这是个好性质，顺手钉住
    expect(ups[0].binds).toEqual([JSON.stringify(['A']), 'draft', 'a']);
    expect(ups[1].binds).toEqual(['乙的解析', JSON.stringify(['B', 'C']), 'b']);
  });

  it('走 D1 batch（同一事务），不是一条条 run', async () => {
    const db = dbWith(['a', 'b', 'c']);
    await call({ items: [{ id: 'a', answer: ['A'] }, { id: 'b', answer: ['B'] }, { id: 'c', answer: ['C'] }] }, db);
    expect(db.batches).toHaveLength(1);
    expect(db.batches[0]).toHaveLength(3);
  });

  it('不传的字段就不动 —— 空 analysis 不该被写进去', async () => {
    const db = dbWith(['a']);
    await call({ items: [{ id: 'a', answer: ['A'] }] }, db);
    expect(updates(db)[0].sql).not.toMatch(/analysis/);
  });

  it('显式传空字符串 analysis 仍然会写（与单值路径语义一致，判空是调用方的责任）', async () => {
    const db = dbWith(['a']);
    await call({ items: [{ id: 'a', answer: ['A'], analysis: '' }] }, db);
    expect(updates(db)[0].sql).toMatch(/analysis = \?/);
  });
});

describe('绑定顺序与入参 key 顺序无关', () => {
  it('两种书写顺序生成同样的 SQL 和绑定', async () => {
    const a = dbWith(['x']); const b = dbWith(['x']);
    await call({ items: [{ id: 'x', answer: ['A'], analysis: 'm', status: 'draft' }] }, a);
    await call({ items: [{ id: 'x', status: 'draft', analysis: 'm', answer: ['A'] }] }, b);
    const ua = updates(a)[0], ub = updates(b)[0];
    expect(ua.sql).toBe(ub.sql);
    expect(ua.binds).toEqual(ub.binds);
  });
});

describe('白名单：只开放补答案真正需要的字段', () => {
  it('answer / analysis / status / difficulty 放行', async () => {
    const db = dbWith(['a']);
    await call({ items: [{ id: 'a', answer: ['A'], analysis: 'x', status: 'ok', difficulty: 5 }] }, db);
    const sql = updates(db)[0].sql;
    for (const f of ['answer', 'analysis', 'status', 'difficulty']) expect(sql).toMatch(new RegExp(f + ' = \\?'));
  });
  it('题干 / 选项 / 科目这些结构性字段一律不认', async () => {
    const db = dbWith(['a']);
    const res = await call({ items: [{ id: 'a', stem: '改题干', options: [], subject: 'math', chapter: 'c' }] }, db);
    const body = await res.json();
    expect(body.updated).toBe(0);
    expect(body.skipped).toEqual(['a']);      // 一个可写字段都没带
    expect(updates(db)).toHaveLength(0);
  });
  it('非法 status 被丢掉而不是写进去', async () => {
    const db = dbWith(['a']);
    const res = await call({ items: [{ id: 'a', status: 'published' }] }, db);
    expect((await res.json()).skipped).toEqual(['a']);
  });
  it('difficulty 非数字回落到 3', async () => {
    const db = dbWith(['a']);
    await call({ items: [{ id: 'a', difficulty: '不是数字' }] }, db);
    expect(updates(db)[0].binds).toEqual([3, 'a']);
  });
});

describe('不存在的 id 如实报出来', () => {
  it('missing 列出来，不冒充成功', async () => {
    const db = dbWith(['a']);
    const body = await (await call({ items: [{ id: 'a', answer: ['A'] }, { id: 'ghost', answer: ['X'] }] }, db)).json();
    expect(body.updated).toBe(1);
    expect(body.missing).toEqual(['ghost']);
    expect(updates(db)).toHaveLength(1);
  });
  it('全都不存在时不报 500，如实返回 0', async () => {
    const db = dbWith([]);
    const body = await (await call({ items: [{ id: 'ghost', answer: ['X'] }] }, db)).json();
    expect(body).toMatchObject({ ok: true, updated: 0, missing: ['ghost'] });
  });
});

describe('入参校验与规模上限', () => {
  it('items 为空 → 400', async () => {
    const res = await call({ items: [] }, dbWith([]));
    expect(res.status).toBe(400);
  });
  it('条目缺 id 会被过滤掉', async () => {
    const res = await call({ items: [{ answer: ['A'] }] }, dbWith([]));
    expect(res.status).toBe(400);
  });
  it('超过 200 条直接拒绝，而不是悄悄截断', async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ id: 'q' + i, answer: ['A'] }));
    const res = await call({ items }, dbWith([]));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/最多 200/);
  });
  it('存在性校验按 80 个一组分块，不撞 D1 的变量上限', async () => {
    const ids = Array.from({ length: 170 }, (_, i) => 'q' + i);
    const db = dbWith(ids);
    await call({ items: ids.map((id) => ({ id, answer: ['A'] })) }, db);
    const sels = db.log.filter((r) => /SELECT id FROM questions/.test(r.sql));
    expect(sels).toHaveLength(3);                       // 80 + 80 + 10
    expect(sels.every((s) => s.binds.length <= 80)).toBe(true);
  });
  it('重复 id 只校验一次', async () => {
    const db = dbWith(['a']);
    await call({ items: [{ id: 'a', answer: ['A'] }, { id: 'a', answer: ['B'] }] }, db);
    const sels = db.log.filter((r) => /SELECT id FROM questions/.test(r.sql));
    expect(sels[0].binds).toEqual(['a']);
  });
});

describe('不影响原有的单值路径', () => {
  it('{ids, 字段} 仍然是给所有 id 设同一个值', async () => {
    const db = new FakeDB([]);
    const body = await (await call({ ids: ['a', 'b'], chapter: '第三章' }, db)).json();
    expect(body).toMatchObject({ ok: true });
    const up = db.log.find((r) => /^UPDATE questions SET/.test(r.sql));
    expect(up.sql).toMatch(/WHERE id IN \(\?,\?\)/);
    expect(up.binds).toEqual(['第三章', 'a', 'b']);
  });
  it('既没有 items 也没有 ids → 400', async () => {
    const res = await call({ chapter: 'x' }, new FakeDB([]));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/缺少题目 id/);
  });
});
