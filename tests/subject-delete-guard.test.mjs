// 线上事故：在设置页点「删除」，科目直接就没了，没有任何确认。
//
// 三个叠在一起的 bug：
//  ① 前端「先删了再说」：直接发 DELETE，只有后端回 409 才弹确认。
//     科目为空 → 后端放行 → 零确认删除。而科目配置（代码/名称/关键词/排序）删了就没了。
//  ② 后端的「为空」只数 questions 不数 materials。「0 道题 + 278 页教材」被判成空 ——
//     政治理论就是这么没的。
//  ③ 只有 `force && qCount > 0` 分支才清 materials。②那种情况下教材既没删也没转移，
//     subject 指向一个已不存在的科目，成了孤儿。
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FakeDB, authedReq, makeEnv, ROOT } from './helpers.mjs';
import { onRequestDelete as delSubject } from '../functions/api/subjects.js';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const Settings = new Function(read('js/views/settings.js') + ';return SettingsMixin;')();

const dbWith = (q, m) => new FakeDB([
  { match: /COUNT\(\*\)\s+AS\s+n\s+FROM\s+questions/i, value: [{ n: q }] },
  { match: /COUNT\(\*\)\s+AS\s+n\s+FROM\s+materials/i, value: [{ n: m }] },
]);
const call = (body, db) => delSubject({
  request: authedReq('http://x/api/subjects', { method: 'DELETE', body: JSON.stringify(body) }),
  env: Object.assign(makeEnv(db), { DB: db }),
});
const ran = (db, re) => db.log.filter((r) => re.test(r.sql));

describe('后端：非空判定要含教材', () => {
  it('0 题 + 278 页教材 = 非空，拒绝并报出两个数', async () => {
    const db = dbWith(0, 278);
    const res = await call({ code: 'politics' }, db);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'subject_not_empty', questions: 0, materials: 278 });
    expect(ran(db, /DELETE FROM subjects/i)).toHaveLength(0);
  });
  it('真空科目才放行', async () => {
    const db = dbWith(0, 0);
    expect((await call({ code: 'empty' }, db)).status).toBe(200);
    expect(ran(db, /DELETE FROM subjects/i)).toHaveLength(1);
  });
});

describe('后端：dry_run 只报数不动数据', () => {
  it('返回两个数', async () => {
    const b = await (await call({ code: 'x', dry_run: 1 }, dbWith(5, 30))).json();
    expect(b).toMatchObject({ dryRun: true, questions: 5, materials: 30 });
  });
  it('一条 DELETE 都不发', async () => {
    const db = dbWith(5, 30);
    await call({ code: 'x', dry_run: 1 }, db);
    expect(ran(db, /^DELETE/i)).toHaveLength(0);
  });
  it('空科目的 dry_run 也不删（线上丢科目正是栽在这一步）', async () => {
    const db = dbWith(0, 0);
    await call({ code: 'x', dry_run: 1 }, db);
    expect(ran(db, /DELETE FROM subjects/i)).toHaveLength(0);
  });
});

describe('后端：force 要连教材一起清，不留孤儿', () => {
  it('0 题 + 有教材时也删教材（原来这里漏了）', async () => {
    const db = dbWith(0, 278);
    await call({ code: 'politics', force: true }, db);
    expect(ran(db, /DELETE FROM materials/i)).toHaveLength(1);
    expect(ran(db, /DELETE FROM questions/i)).toHaveLength(0);
  });
  it('题和教材都有就都删，并如实回报数量', async () => {
    const db = dbWith(9, 40);
    const b = await (await call({ code: 'x', force: true }, db)).json();
    expect(ran(db, /DELETE FROM questions/i)).toHaveLength(1);
    expect(ran(db, /DELETE FROM materials/i)).toHaveLength(1);
    expect(b).toMatchObject({ removedQuestions: 9, removedMaterials: 40 });
  });
  it('转移时题和教材一起改挂，且不删', async () => {
    const db = dbWith(9, 40);
    const b = await (await call({ code: 'x', moveTo: 'math' }, db)).json();
    expect(ran(db, /UPDATE questions SET subject/i)).toHaveLength(1);
    expect(ran(db, /UPDATE materials SET subject/i)).toHaveLength(1);
    expect(ran(db, /DELETE FROM questions/i)).toHaveLength(0);
    expect(b).toMatchObject({ moved: 'math', movedQuestions: 9, movedMaterials: 40 });
  });
});

const ctx = (probe) => {
  const calls = [];
  return {
    calls, flashes: [],
    subjects: [{ v: 'politics', t: '政治理论' }, { v: 'math', t: '高等数学' }, { v: 'computer', t: '计算机' }],
    flash(m) { this.flashes.push(String(m)); },
    loadSubjects: async () => {}, loadMeta: () => {},
    async api(p, o) {
      const body = JSON.parse(o.body || '{}');
      calls.push(body);
      if (body.dry_run) return probe;
      return { ok: true, removedQuestions: probe.questions, removedMaterials: probe.materials };
    },
  };
};
const del = (c) => Settings.methods.subjDelete.call(c, { v: 'politics', t: '政治理论' });
const realCalls = (c) => c.calls.filter((x) => !x.dry_run);

beforeEach(() => { global.confirm = () => true; global.prompt = () => null; });

describe('前端：任何情况都要先确认', () => {
  it('空科目也要确认，不能静默删除', async () => {
    const c = ctx({ questions: 0, materials: 0 });
    const seen = [];
    global.confirm = (m) => { seen.push(m); return false; };
    await del(c);
    expect(seen.join('')).toMatch(/删除空科目/);
    expect(realCalls(c)).toHaveLength(0);
  });
  it('探测阶段必须用 dry_run，不能靠发真删来试', async () => {
    const c = ctx({ questions: 0, materials: 0 });
    global.confirm = () => false;
    await del(c);
    expect(c.calls[0]).toMatchObject({ dry_run: 1 });
  });
  it('确认后才真删', async () => {
    const c = ctx({ questions: 0, materials: 0 });
    await del(c);
    expect(c.calls.some((x) => x.force)).toBe(true);
    expect(c.flashes.join('')).toMatch(/已删除空科目/);
  });
});

describe('前端：非空科目优先引导转移', () => {
  it('先问要不要转移，并说清有多少内容', async () => {
    const c = ctx({ questions: 0, materials: 278 });
    const seen = [];
    global.confirm = (m) => { seen.push(m); return false; };
    await del(c);
    expect(seen[0]).toMatch(/278 页教材/);
    expect(seen[0]).toMatch(/转移到别的科目/);
  });
  it('选了转移就带 moveTo，不发 force', async () => {
    const c = ctx({ questions: 0, materials: 278 });
    global.prompt = () => '1';
    await del(c);
    expect(realCalls(c)[0]).toMatchObject({ moveTo: 'math' });
    expect(realCalls(c).some((x) => x.force)).toBe(false);
  });
  it('序号无效就取消，不会误删', async () => {
    const c = ctx({ questions: 0, materials: 278 });
    global.prompt = () => '99';
    await del(c);
    expect(realCalls(c)).toHaveLength(0);
    expect(c.flashes.join('')).toMatch(/序号无效/);
  });
  it('候选列表排除自己', async () => {
    const c = ctx({ questions: 1, materials: 0 });
    const seen = [];
    global.prompt = (m) => { seen.push(m); return null; };
    await del(c);
    expect(seen[0]).not.toMatch(/政治理论/);
    expect(seen[0]).toMatch(/高等数学/);
  });
});

describe('前端：强删要手打科目名', () => {
  it('输入不匹配就取消', async () => {
    const c = ctx({ questions: 5, materials: 10 });
    global.confirm = () => false;
    global.prompt = () => '随便打的';
    await del(c);
    expect(realCalls(c)).toHaveLength(0);
    expect(c.flashes.join('')).toMatch(/输入不匹配/);
  });
  it('输入正确才删，并报出实际删了多少', async () => {
    const c = ctx({ questions: 5, materials: 10 });
    global.confirm = () => false;
    global.prompt = () => '政治理论';
    await del(c);
    expect(c.calls.some((x) => x.force)).toBe(true);
    expect(c.flashes.join('')).toMatch(/5 道题/);
    expect(c.flashes.join('')).toMatch(/10 页教材/);
  });
  it('提示里写明不可恢复', async () => {
    const c = ctx({ questions: 5, materials: 10 });
    global.confirm = () => false;
    const seen = [];
    global.prompt = (m) => { seen.push(m); return null; };
    await del(c);
    expect(seen[0]).toMatch(/不可恢复/);
  });
  it('直接关掉输入框（返回 null）也不删', async () => {
    const c = ctx({ questions: 5, materials: 10 });
    global.confirm = () => false;
    global.prompt = () => null;
    await del(c);
    expect(realCalls(c)).toHaveLength(0);
  });
});
