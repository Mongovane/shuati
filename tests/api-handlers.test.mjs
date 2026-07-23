// 后端处理器测试（FakeDB 桩掉 D1，Node 自带 Request/Response 即可跑）
import { describe, it, expect } from 'vitest';
import { FakeDB, authedReq, makeEnv } from './helpers.mjs';
import { onRequestGet as questionsGet, onRequestPatch as questionsPatch } from '../functions/api/questions.js';
import { onRequestPost as progressPost, onRequestGet as progressGet, onRequestDelete as progressDelete } from '../functions/api/progress.js';
import { onRequestPost as restorePost } from '../functions/api/restore.js';
import { onRequestPost as processPost } from '../functions/api/process.js';

describe('GET /api/questions 的 nocount 参数', () => {
  it('nocount=1（顺序分支）：不执行 COUNT，total 返回 -1', async () => {
    const db = new FakeDB([{ match: /FROM questions q/, value: [] }]);
    const res = await questionsGet({ request: authedReq('http://x/api/questions?order=seq&limit=5&nocount=1'), env: makeEnv(db) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.total).toBe(-1);
    expect(body.items).toEqual([]);
    expect(db.ran(/COUNT\(\*\) AS total/)).toBe(false);
  });
  it('nocount=1（随机无筛选分支）：同样跳过 COUNT', async () => {
    const db = new FakeDB([
      { match: /SELECT MAX\(rowid\) AS m FROM questions/, value: { m: 10 } },
      { match: /FROM questions q/, value: [] },
    ]);
    const res = await questionsGet({ request: authedReq('http://x/api/questions?nocount=1'), env: makeEnv(db) });
    const body = await res.json();
    expect(body.total).toBe(-1);
    expect(db.ran(/COUNT\(\*\) AS total/)).toBe(false);
  });
  it('默认（无 nocount）：照常 COUNT 并返回总数', async () => {
    const db = new FakeDB([
      { match: /COUNT\(\*\) AS total/, value: { total: 7 } },   // 必须放在通配 FROM questions q 之前
      { match: /FROM questions q/, value: [] },
    ]);
    const res = await questionsGet({ request: authedReq('http://x/api/questions?order=seq'), env: makeEnv(db) });
    const body = await res.json();
    expect(body.total).toBe(7);
    expect(db.ran(/COUNT\(\*\) AS total/)).toBe(true);
  });
});

describe('GET /api/questions 草稿与标签', () => {
  it('默认查询排除待审核草稿（draftCond 拼进 WHERE）', async () => {
    const db = new FakeDB([
      { match: /COUNT\(\*\) AS total/, value: { total: 0 } },
      { match: /FROM questions q/, value: [] },
    ]);
    await questionsGet({ request: authedReq('http://x/api/questions?order=seq'), env: makeEnv(db) });
    expect(db.ran(/IFNULL\(q\.status,''\) <> 'draft'/)).toBe(true);
  });
  it('status=draft 只看草稿', async () => {
    const db = new FakeDB([
      { match: /COUNT\(\*\) AS total/, value: { total: 0 } },
      { match: /FROM questions q/, value: [] },
    ]);
    await questionsGet({ request: authedReq('http://x/api/questions?order=seq&status=draft'), env: makeEnv(db) });
    expect(db.ran(/q\.status = 'draft'/)).toBe(true);
    expect(db.ran(/IFNULL\(q\.status,''\) <> 'draft'/)).toBe(false);
  });
  it('tag 参数走 tags LIKE 整词绑定，危险字符被剥掉', async () => {
    const db = new FakeDB([
      { match: /COUNT\(\*\) AS total/, value: { total: 0 } },
      { match: /FROM questions q/, value: [] },
    ]);
    await questionsGet({ request: authedReq('http://x/api/questions?order=seq&tag=' + encodeURIComponent('指%_"针')), env: makeEnv(db) });
    expect(db.ran(/q\.tags LIKE \?/)).toBe(true);
    const sel = db.stmts(/FROM questions q/).find((x) => /tags LIKE/.test(x.sql));
    expect(sel.binds.includes('%"指针"%')).toBe(true);
  });
  it('无筛选随机抽题仍走 rowid 快路径，且带草稿排除', async () => {
    const db = new FakeDB([
      { match: /SELECT MAX\(rowid\) AS m FROM questions/, value: { m: 100 } },
      { match: /FROM questions q/, value: [] },
    ]);
    const res = await questionsGet({ request: authedReq('http://x/api/questions?nocount=1'), env: makeEnv(db) });
    expect((await res.json()).total).toBe(-1);
    expect(db.ran(/WHERE q\.rowid >= \? AND IFNULL\(q\.status,''\) <> 'draft'/)).toBe(true);
  });
});

describe('POST /api/progress 单题四档与用时', () => {
  it('grade=easy 新题：interval=2、ease=2.6；duration_ms 写入流水', async () => {
    const db = new FakeDB([{ match: /SELECT interval_days, ease FROM progress/, value: null }]);
    const body = { action: 'answer', question_id: 'q1', is_correct: true, grade: 'easy', duration_ms: 8500 };
    const res = await progressPost({ request: authedReq('http://x/api/progress', { method: 'POST', body: JSON.stringify(body) }), env: makeEnv(db) });
    expect((await res.json()).ok).toBe(true);
    const up = db.stmts(/INSERT INTO progress/)[0];
    expect(up.binds[5]).toBe(2);
    expect(up.binds[6]).toBe(2.6);
    const lg = db.stmts(/INSERT INTO answer_log/)[0];
    expect(lg.binds).toEqual(['q1', 1, 8500]);
  });
  it('grade=again 覆盖 is_correct=true：按错记账', async () => {
    const db = new FakeDB([{ match: /SELECT interval_days, ease FROM progress/, value: null }]);
    const body = { action: 'answer', question_id: 'q1', is_correct: true, grade: 'again' };
    await progressPost({ request: authedReq('http://x/api/progress', { method: 'POST', body: JSON.stringify(body) }), env: makeEnv(db) });
    const up = db.stmts(/INSERT INTO progress/)[0];
    expect(up.binds[1]).toBe(0);
    expect(up.binds[2]).toBe(1);
    expect(db.stmts(/INSERT INTO answer_log/)[0].binds).toEqual(['q1', 0, null]);
  });
});

describe('POST /api/progress 模考半分与回写', () => {
  it('action=mock：score 落库；details 的 1/0.5/0/null 原样入明细', async () => {
    const db = new FakeDB();
    const body = { action: 'mock', subject: 'math', total: 4, correct: 2, score: 2.5, duration_seconds: 300, details: [
      { question_id: 'a', is_correct: 1 }, { question_id: 'b', is_correct: 0.5 },
      { question_id: 'c', is_correct: 0 }, { question_id: 'd', is_correct: null },
    ] };
    const res = await progressPost({ request: authedReq('http://x/api/progress', { method: 'POST', body: JSON.stringify(body) }), env: makeEnv(db) });
    const out = await res.json();
    expect(out.ok).toBe(true);
    expect(out.mock_id).toBe(1);
    expect(db.stmts(/INSERT INTO mock_results/)[0].binds).toEqual(['math', 4, 2, 300, 2.5]);
    expect(db.stmts(/INSERT INTO mock_answers/).map((x) => x.binds[2])).toEqual([1, 0.5, 0, null]);
  });
  it('action=mock_grade：复盘自评回写明细', async () => {
    const db = new FakeDB();
    const body = { action: 'mock_grade', mock_id: 7, question_id: 'x1', is_correct: true };
    const res = await progressPost({ request: authedReq('http://x/api/progress', { method: 'POST', body: JSON.stringify(body) }), env: makeEnv(db) });
    expect((await res.json()).ok).toBe(true);
    expect(db.stmts(/UPDATE mock_answers SET is_correct/)[0].binds).toEqual([1, 7, 'x1']);
  });
});

describe('POST /api/process 直导上限与草稿', () => {
  const mkQ = (n) => Array.from({ length: n }, (_, i) => ({ stem: '这是第 ' + i + ' 道用于测试的题目题干', type: 'short_answer', answer: ['参考答案'] }));
  it('超过 2000 题 → 400', async () => {
    const db = new FakeDB([{ match: /FROM subjects/, value: [] }]);
    const res = await processPost({ request: authedReq('http://x/api/process', { method: 'POST', body: JSON.stringify({ subject: 'math', questions: mkQ(2001) }) }), env: makeEnv(db) });
    expect(res.status).toBe(400);
  });
  it('直导 250 题：可信路径 status=NULL，按 80/块分批写库', async () => {
    const db = new FakeDB([{ match: /FROM subjects/, value: [] }]);
    const res = await processPost({ request: authedReq('http://x/api/process', { method: 'POST', body: JSON.stringify({ subject: 'math', questions: mkQ(250) }) }), env: makeEnv(db) });
    const out = await res.json();
    expect(out.inserted_questions).toBe(250);
    expect(out.inserted_drafts).toBe(0);
    const qb = db.batches.filter((b) => b.length && /INSERT INTO questions/.test(b[0]._rec.sql));
    expect(qb.length).toBe(Math.ceil(250 / 80));
    expect(qb[0][0]._rec.binds[13]).toBe(null);   // status 列（可信 → 已发布）
  });

  it('直导会规范化答案并返回 answer_warns（脏答案不静默入库）', async () => {
    const db = new FakeDB([{ match: /FROM subjects/, value: [] }]);
    const questions = [
      { stem: '多选但只给一个答案的题目题干示例', type: 'multiple_choice', options: [{ key: 'A', text: 'x' }, { key: 'B', text: 'y' }], answer: ['A'] },
      { stem: '答案超出选项范围的单选题干示例', type: 'single_choice', options: [{ key: 'A', text: 'x' }, { key: 'B', text: 'y' }], answer: ['Z'] },
    ];
    const res = await processPost({ request: authedReq('http://x/api/process', { method: 'POST', body: JSON.stringify({ subject: 'math', questions }) }), env: makeEnv(db) });
    const out = await res.json();
    expect(out.inserted_questions).toBe(2);
    expect(out.answer_warns.length).toBe(2);
    expect(out.answer_warns.join(' ')).toMatch(/多选题只有一个答案/);
    expect(out.answer_warns.join(' ')).toMatch(/不在选项内/);
    // 规范化后存进库的 answer 是干净的（多选去重大写、单选保留原值待查）
    const ins = db.batches.flat().filter((s) => /INSERT INTO questions/.test(s._rec.sql));
    expect(ins.length).toBe(2);
  });
});

describe('POST /api/progress action=answers_bulk', () => {
  it('一次读齐 SRS、同题串联演进、批量 UPSERT + 写流水', async () => {
    const db = new FakeDB([
      { match: /SELECT question_id, interval_days, ease FROM progress WHERE question_id IN/, value: [{ question_id: 'a', interval_days: 1, ease: 2.5 }] },
    ]);
    const body = { action: 'answers_bulk', items: [
      { question_id: 'a', is_correct: true },
      { question_id: 'a', is_correct: true },   // 同题第二次：应基于第一次的结果继续演进
      { question_id: 'b', is_correct: false },
    ] };
    const res = await progressPost({ request: authedReq('http://x/api/progress', { method: 'POST', body: JSON.stringify(body) }), env: makeEnv(db) });
    const out = await res.json();
    expect(out).toEqual({ ok: true, count: 3 });

    const ups = db.stmts(/INSERT INTO progress/);
    const logs = db.stmts(/INSERT INTO answer_log/);
    expect(ups.length).toBe(3);
    expect(logs.length).toBe(3);
    // bind 位次：(qid, right, wrong, last, dueAt, interval, ease, ...)
    // a 第一次：库里 (1, 2.5) 答对 → interval 3、ease 2.55
    expect(ups[0].binds[0]).toBe('a');
    expect(ups[0].binds[5]).toBe(3);
    expect(ups[0].binds[6]).toBe(2.55);
    // a 第二次：基于 (3, 2.55) → 3×2.55 = 7.65、ease 2.6
    expect(ups[1].binds[0]).toBe('a');
    expect(ups[1].binds[5]).toBeCloseTo(7.65, 6);
    expect(ups[1].binds[6]).toBe(2.6);
    // b：无记录、答错 → interval 0、ease 2.3
    expect(ups[2].binds[0]).toBe('b');
    expect(ups[2].binds[1]).toBe(0);      // right_count 增量 0
    expect(ups[2].binds[2]).toBe(1);      // wrong_count 增量 1
    expect(ups[2].binds[5]).toBe(0);
    expect(ups[2].binds[6]).toBe(2.3);
    // 全部经 batch 提交（6 条 < 80 → 一次）
    expect(db.batches.length).toBe(1);
    expect(db.batches[0].length).toBe(6);
  });
  it('0.5 半分按「需复习」计错进 SRS', async () => {
    const db = new FakeDB([{ match: /SELECT question_id, interval_days, ease FROM progress WHERE question_id IN/, value: [] }]);
    const body = { action: 'answers_bulk', items: [{ question_id: 'p', is_correct: 0.5 }] };
    await progressPost({ request: authedReq('http://x/api/progress', { method: 'POST', body: JSON.stringify(body) }), env: makeEnv(db) });
    const up = db.stmts(/INSERT INTO progress/)[0];
    expect(up.binds[1]).toBe(0);
    expect(up.binds[2]).toBe(1);
    expect(up.binds[5]).toBe(0);
  });
  it('items 为空 → 400', async () => {
    const db = new FakeDB();
    const res = await progressPost({ request: authedReq('http://x/api/progress', { method: 'POST', body: JSON.stringify({ action: 'answers_bulk', items: [] }) }), env: makeEnv(db) });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/restore', () => {
  const q = (id) => ({ id, subject: 'math', type: 'single_choice', stem: '题' + id, options: [{ key: 'A', text: 'x' }], answer: ['A'], tags: [], difficulty: 3, created_at: 1700000000 });

  it('merge：按主键 UPSERT；孤儿 progress 被剔除并提示；不清库', async () => {
    const db = new FakeDB([
      { match: /SELECT id FROM questions WHERE id IN/, value: [] },   // 库里也没有 ghost → 剔除
    ]);
    const data = {
      version: 2,
      questions: [q('q1'), q('q2')],
      progress: [
        { question_id: 'q1', right_count: 2, wrong_count: 1, ease: 2.5, interval_days: 3 },
        { question_id: 'ghost', right_count: 1 },
      ],
      subjects: [{ code: 'math', name: '高等数学', sort: 3, keywords: '导数' }],
      mock_results: [{ id: 5, subject: 'math', total: 10, correct: 8, duration_seconds: 600, taken_at: 1700000000 }],
      mock_answers: [{ id: 9, mock_id: 5, question_id: 'q1', is_correct: 1 }],
      answer_log: [{ id: 1, question_id: 'q1', is_correct: 1, ts: 1700000000 }],
    };
    const res = await restorePost({ request: authedReq('http://x/api/restore', { method: 'POST', body: JSON.stringify({ mode: 'merge', data }) }), env: makeEnv(db) });
    const out = await res.json();
    expect(res.status).toBe(200);
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('merge');
    expect(out.counts.questions).toBe(2);
    expect(out.counts.progress).toBe(1);                    // ghost 被剔除
    expect(out.notes.join(' ')).toMatch(/1 条找不到/);
    expect(db.ran(/DELETE FROM/)).toBe(false);              // merge 不清库
    expect(db.stmts(/INSERT INTO questions/).length).toBe(2);
    expect(db.stmts(/INSERT INTO progress/).length).toBe(1);
    // 进度行的 bind 位次：(qid, wrong, right, last, fav, mastered, note, due, interval, ease, updated)
    const p = db.stmts(/INSERT INTO progress/)[0];
    expect(p.binds[0]).toBe('q1');
    expect(p.binds[1]).toBe(1);   // wrong_count
    expect(p.binds[2]).toBe(2);   // right_count
    expect(db.stmts(/INSERT OR REPLACE INTO mock_results/).length).toBe(1);
    expect(db.stmts(/INSERT OR REPLACE INTO mock_answers/).length).toBe(1);
    expect(db.stmts(/INSERT OR REPLACE INTO answer_log/).length).toBe(1);
    expect(db.stmts(/INSERT OR REPLACE INTO subjects/).length).toBe(1);
  });

  it('replace：先清空备份中出现的表，未出现的不动', async () => {
    const db = new FakeDB();
    const data = { version: 2, questions: [q('q1')], progress: [], answer_log: [] };
    const res = await restorePost({ request: authedReq('http://x/api/restore', { method: 'POST', body: JSON.stringify({ mode: 'replace', data }) }), env: makeEnv(db) });
    const out = await res.json();
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('replace');
    expect(db.ran(/DELETE FROM questions/)).toBe(true);
    expect(db.ran(/DELETE FROM progress/)).toBe(true);
    expect(db.ran(/DELETE FROM answer_log/)).toBe(true);
    expect(db.ran(/DELETE FROM materials/)).toBe(false);    // 备份里没有 materials 键
    expect(db.ran(/DELETE FROM mock_results/)).toBe(false);
  });

  it('直接把导出 JSON 当请求体（无 mode 包装）→ 按 merge 处理', async () => {
    const db = new FakeDB([{ match: /SELECT id FROM questions WHERE id IN/, value: [] }]);
    const res = await restorePost({ request: authedReq('http://x/api/restore', { method: 'POST', body: JSON.stringify({ version: 2, questions: [q('q1')] }) }), env: makeEnv(db) });
    const out = await res.json();
    expect(out.ok).toBe(true);
    expect(out.mode).toBe('merge');
    expect(out.counts.questions).toBe(1);
  });

  it('恢复保真：questions.status=draft 与 mock_results.score 原样入库', async () => {
    const db = new FakeDB([{ match: /SELECT id FROM questions WHERE id IN/, value: [] }]);
    const data = { version: 2, questions: [{ ...q('qd'), status: 'draft' }],
      mock_results: [{ id: 9, subject: 'math', total: 5, correct: 3, score: 3.5, duration_seconds: 60 }] };
    const res = await restorePost({ request: authedReq('http://x/api/restore', { method: 'POST', body: JSON.stringify({ mode: 'merge', data }) }), env: makeEnv(db) });
    expect((await res.json()).ok).toBe(true);
    const qs = db.stmts(/INSERT INTO questions/)[0];
    expect(qs.sql).toMatch(/status=excluded\.status/);
    expect(qs.binds[13]).toBe('draft');
    expect(db.stmts(/INSERT OR REPLACE INTO mock_results/)[0].binds[5]).toBe(3.5);
  });

  it('不认识的备份版本 → 400；空备份 → 422', async () => {
    const db = new FakeDB();
    const r1 = await restorePost({ request: authedReq('http://x/api/restore', { method: 'POST', body: JSON.stringify({ version: 3, questions: [q('q1')] }) }), env: makeEnv(db) });
    expect(r1.status).toBe(400);
    const r2 = await restorePost({ request: authedReq('http://x/api/restore', { method: 'POST', body: JSON.stringify({ version: 2 }) }), env: makeEnv(db) });
    expect(r2.status).toBe(422);
  });
});

describe('GET /api/progress 统计口径', () => {
  it('bySubject 排除待审核草稿；返回按题做对数 right_q', async () => {
    const db = new FakeDB([
      { match: /FROM questions q LEFT JOIN progress/, value: [
        { subject: 'math', total_q: 2, seen: 2, right_sum: 5, wrong_sum: 1, right_q: 1, wrong_open: 1, mastered: 0, favorited: 0, due: 0 },
      ] },
      { match: /FROM mock_results/, value: [] },
    ]);
    const res = await progressGet({ request: authedReq('http://x/api/progress'), env: makeEnv(db) });
    const out = await res.json();
    expect(res.status).toBe(200);
    expect(db.ran(/IFNULL\(q\.status,''\) <> 'draft'/), 'stats 应排除草稿').toBe(true);
    expect(db.ran(/pr\.last_correct = 1 THEN 1 ELSE 0 END\) AS right_q/), '应查 right_q').toBe(true);
    expect(out.bySubject[0].right_q).toBe(1);
  });
});

describe('DELETE /api/progress 删模考记录', () => {
  it('mock_id → 同时删 mock_answers 与 mock_results', async () => {
    const db = new FakeDB();
    const res = await progressDelete({ request: authedReq('http://x/api/progress?mock_id=7', { method: 'DELETE' }), env: makeEnv(db) });
    expect((await res.json()).ok).toBe(true);
    expect(db.stmts(/DELETE FROM mock_answers WHERE mock_id/)[0].binds).toEqual([7]);
    expect(db.stmts(/DELETE FROM mock_results WHERE id/)[0].binds).toEqual([7]);
  });
  it('缺 mock_id → 400', async () => {
    const db = new FakeDB();
    const res = await progressDelete({ request: authedReq('http://x/api/progress', { method: 'DELETE' }), env: makeEnv(db) });
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/questions 批量改字段', () => {
  it('章节/难度/标签在白名单内，正确落库（tags 存 JSON）', async () => {
    const db = new FakeDB();
    const body = { ids: ['a', 'b'], chapter: '第一章', difficulty: 4, tags: ['易错', '重点'] };
    const res = await questionsPatch({ request: authedReq('http://x/api/questions', { method: 'PATCH', body: JSON.stringify(body) }), env: makeEnv(db) });
    expect((await res.json()).ok).toBe(true);
    const up = db.stmts(/UPDATE questions SET/)[0];
    expect(up.sql).toMatch(/chapter = \?/);
    expect(up.sql).toMatch(/difficulty = \?/);
    expect(up.sql).toMatch(/tags = \?/);
    // 绑定值：difficulty 数字、tags JSON 字符串、末尾是 ids
    expect(up.binds).toContain(4);
    expect(up.binds).toContain('["易错","重点"]');
    expect(up.binds.slice(-2)).toEqual(['a', 'b']);
  });
  it('status 只接受 draft/ok，非法值被忽略', async () => {
    const db = new FakeDB();
    const res = await questionsPatch({ request: authedReq('http://x/api/questions', { method: 'PATCH', body: JSON.stringify({ ids: ['a'], status: 'garbage', chapter: 'x' }) }), env: makeEnv(db) });
    expect((await res.json()).ok).toBe(true);
    const up = db.stmts(/UPDATE questions SET/)[0];
    expect(up.sql).not.toMatch(/status = \?/);
    expect(up.sql).toMatch(/chapter = \?/);
  });
  it('没有可更新字段 → 400', async () => {
    const db = new FakeDB();
    const res = await questionsPatch({ request: authedReq('http://x/api/questions', { method: 'PATCH', body: JSON.stringify({ ids: ['a'], bogus: 1 }) }), env: makeEnv(db) });
    expect(res.status).toBe(400);
  });
});
