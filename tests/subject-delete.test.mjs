// 科目删除：非空科目需 force 才能连题删除，否则 409 拒绝
import { describe, it, expect } from 'vitest';
import { FakeDB, authedReq, makeEnv } from './helpers.mjs';
import { onRequestDelete as subjDelete } from '../functions/api/subjects.js';

function envWithCount(n) {
  // COUNT(*) 查询返回 {n}，其他 DDL/DELETE 返回空
  const db = new FakeDB([
    { match: /COUNT\(\*\)\s+AS\s+n\s+FROM\s+questions/i, value: [{ n }] },
  ]);
  return { db, env: makeEnv(db) };
}

describe('删除科目的空/非空约束', () => {
  it('空科目：直接删除成功', async () => {
    const { env } = envWithCount(0);
    const res = await subjDelete({ request: authedReq('http://x/api/subjects', { method: 'DELETE', body: JSON.stringify({ code: 'aaa' }) }), env });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.ok).toBe(true);
  });
  it('非空科目 + 未 force：返回 409 subject_not_empty 及题目数', async () => {
    const { env } = envWithCount(7);
    const res = await subjDelete({ request: authedReq('http://x/api/subjects', { method: 'DELETE', body: JSON.stringify({ code: 'aaa' }) }), env });
    expect(res.status).toBe(409);
    const d = await res.json();
    expect(d.error).toBe('subject_not_empty');
    expect(d.count).toBe(7);
  });
  it('非空科目 + force：连题一起删，成功', async () => {
    const { db, env } = envWithCount(7);
    const res = await subjDelete({ request: authedReq('http://x/api/subjects', { method: 'DELETE', body: JSON.stringify({ code: 'aaa', force: true }) }), env });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.ok).toBe(true);
    // 应执行了删除 questions 的语句
    expect(db.stmts(/DELETE FROM questions WHERE subject/i).length).toBe(1);
  });
  it('非空科目 + moveTo：转移题目而非删除', async () => {
    const { db, env } = envWithCount(7);
    const res = await subjDelete({ request: authedReq('http://x/api/subjects', { method: 'DELETE', body: JSON.stringify({ code: 'aaa', moveTo: 'math' }) }), env });
    expect(res.status).toBe(200);
    expect(db.stmts(/UPDATE questions SET subject/i).length).toBe(1);
    expect(db.stmts(/DELETE FROM questions WHERE subject/i).length).toBe(0); // 没删题
  });
});

describe('教材批量改科目 PATCH', () => {
  it('带 ids + subject：批量 UPDATE，返回 updated', async () => {
    const { onRequestPatch } = await import('../functions/api/materials.js');
    const { FakeDB, authedReq, makeEnv } = await import('./helpers.mjs');
    const db = new FakeDB();
    const res = await onRequestPatch({ request: authedReq('http://x/api/materials', { method: 'PATCH', body: JSON.stringify({ ids: ['a', 'b', 'c'], subject: 'math' }) }), env: makeEnv(db) });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.ok).toBe(true);
    expect(db.stmts(/UPDATE materials SET subject/i).length).toBeGreaterThanOrEqual(1);
  });
  it('缺 subject 返回 400', async () => {
    const { onRequestPatch } = await import('../functions/api/materials.js');
    const { FakeDB, authedReq, makeEnv } = await import('./helpers.mjs');
    const res = await onRequestPatch({ request: authedReq('http://x/api/materials', { method: 'PATCH', body: JSON.stringify({ ids: ['a'] }) }), env: makeEnv(new FakeDB()) });
    expect(res.status).toBe(400);
  });
  it('缺 ids 返回 400', async () => {
    const { onRequestPatch } = await import('../functions/api/materials.js');
    const { FakeDB, authedReq, makeEnv } = await import('./helpers.mjs');
    const res = await onRequestPatch({ request: authedReq('http://x/api/materials', { method: 'PATCH', body: JSON.stringify({ subject: 'math' }) }), env: makeEnv(new FakeDB()) });
    expect(res.status).toBe(400);
  });
});
