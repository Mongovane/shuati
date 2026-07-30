// 两件事：
// 1) 「全选本页」只能选 50 条，删一批要翻 12 页 —— 加「全选全部匹配」跨页选中
// 2) 查重原来剥不掉插图标记，同一道题的 base64 版与「［图］」版永远查不出重复
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FakeDB, authedReq, makeEnv, ROOT } from './helpers.mjs';
import { onRequestGet as qGet, onRequestDelete as qDel } from '../functions/api/questions.js';
import { stemShape } from '../functions/api/process.js';

const Bank = new Function(fs.readFileSync(path.join(ROOT, 'js/views/bank.js'), 'utf8') + ';return BankMixin;')();

describe('GET /api/questions?idsonly=1', () => {
  const idRows = (n) => [{ match: /SELECT q\.id FROM questions/, value: Array.from({ length: n }, (_, i) => ({ id: 'q' + i })) }];

  it('只查 id 列，不把带 base64 插图的题干拉回来', async () => {
    const db = new FakeDB(idRows(3));
    const res = await qGet({ request: authedReq('http://x/api/questions?idsonly=1'), env: makeEnv(db) });
    const body = await res.json();
    expect(body.ids).toEqual(['q0', 'q1', 'q2']);
    expect(body.count).toBe(3);
    const sql = db.stmts(/SELECT q\.id FROM questions/)[0].sql;
    expect(sql).not.toMatch(/q\.\*/);
    expect(sql).not.toMatch(/stem/);
  });

  it('沿用同一套筛选条件（科目/题型/标签/状态/模式）', async () => {
    const db = new FakeDB(idRows(1));
    await qGet({ request: authedReq('http://x/api/questions?idsonly=1&subject=math&type=single_choice&tag=%E6%8C%87%E9%92%88&mode=wrong'), env: makeEnv(db) });
    const st = db.stmts(/SELECT q\.id FROM questions/)[0];
    expect(st.sql).toMatch(/q\.subject = \?/);
    expect(st.sql).toMatch(/q\.type = \?/);
    expect(st.sql).toMatch(/q\.tags LIKE \?/);
    expect(st.sql).toMatch(/pr\.wrong_count > 0/);
    expect(st.binds).toContain('math');
    expect(st.binds).toContain('single_choice');
  });

  it('默认排除待审草稿；status=draft 时只看草稿', async () => {
    const db = new FakeDB(idRows(1));
    await qGet({ request: authedReq('http://x/api/questions?idsonly=1'), env: makeEnv(db) });
    expect(db.stmts(/SELECT q\.id/)[0].sql).toMatch(/IFNULL\(q\.status,''\) <> 'draft'/);
    const db2 = new FakeDB(idRows(1));
    await qGet({ request: authedReq('http://x/api/questions?idsonly=1&status=draft'), env: makeEnv(db2) });
    expect(db2.stmts(/SELECT q\.id/)[0].sql).toMatch(/q\.status = 'draft'/);
  });

  it('有上限并如实报 truncated', async () => {
    const db = new FakeDB(idRows(5000));
    const body = await (await qGet({ request: authedReq('http://x/api/questions?idsonly=1'), env: makeEnv(db) })).json();
    expect(body.truncated).toBe(true);
    const db2 = new FakeDB(idRows(10));
    const b2 = await (await qGet({ request: authedReq('http://x/api/questions?idsonly=1'), env: makeEnv(db2) })).json();
    expect(b2.truncated).toBe(false);
  });
});

describe('DELETE 的条数兜底', () => {
  it('一次超过 200 个 id 会截断，避免撞 D1 变量上限', async () => {
    const db = new FakeDB([{ match: /DELETE FROM questions/, value: { meta: { changes: 200 } } }]);
    const ids = Array.from({ length: 500 }, (_, i) => 'q' + i);
    await qDel({ request: authedReq('http://x/api/questions', { method: 'DELETE', body: JSON.stringify({ ids }) }), env: makeEnv(db) });
    const st = db.stmts(/DELETE FROM questions/)[0];
    expect((st.sql.match(/\?/g) || []).length).toBe(200);
  });
});

describe('前端：全选全部匹配 + 删除分批', () => {
  function ctx(over) {
    const calls = [];
    return Object.assign(Object.create(Bank.methods), {
      calls, flashes: [], token: 't',
      bank: { items: [{ id: 'a' }], total: 568, sel: [], mode: 'all', subject: 'math', type: '', kw: '', tag: '', status: '', chapter: '', loading: false, batchProg: '' },
      flash(m, bad) { this.flashes.push([m, !!bad]); }, loadMeta() {}, statsDirty: false,
      async api(p, o) { calls.push({ p, method: (o && o.method) || 'GET', body: o && o.body ? JSON.parse(o.body) : null });
        if (/idsonly=1/.test(p)) return { ids: Array.from({ length: 568 }, (_, i) => 'id' + i), count: 568, truncated: false };
        return { deleted: (o && JSON.parse(o.body).ids.length) || 0 }; },
    }, over || {});
  }

  it('全选全部匹配：只发一个 idsonly 请求，带上当前筛选，选中全部 568 题', async () => {
    const c = ctx();
    await Bank.methods.bankSelectAllMatching.call(c);
    expect(c.calls.length).toBe(1);
    expect(c.calls[0].p).toMatch(/idsonly=1/);
    expect(c.calls[0].p).toMatch(/subject=math/);
    expect(c.bank.sel.length).toBe(568);
    expect(c.flashes[0][0]).toContain('568');
  });

  it('truncated 时提示并标警告', async () => {
    const c = ctx();
    c.api = async () => ({ ids: ['a', 'b'], count: 2, truncated: true });
    await Bank.methods.bankSelectAllMatching.call(c);
    expect(c.flashes[0][1]).toBe(true);
    expect(c.flashes[0][0]).toMatch(/上限/);
  });

  it('删 568 题会按 80 分批发 8 个请求，而不是一次全塞', async () => {
    global.confirm = () => true;
    const c = ctx();
    c.bank.sel = Array.from({ length: 568 }, (_, i) => 'id' + i);
    await Bank.methods.bankBatchDelete.call(c);
    const dels = c.calls.filter((x) => x.method === 'DELETE');
    expect(dels.length).toBe(8);                                  // ceil(568/80)
    expect(Math.max(...dels.map((d) => d.body.ids.length))).toBe(80);
    expect(dels.reduce((s, d) => s + d.body.ids.length, 0)).toBe(568);
    expect(c.bank.sel).toEqual([]);
    expect(c.bank.batchProg).toBe('');
    expect(c.flashes[0][0]).toContain('568');
  });

  it('少量删除不显示分批进度（不制造噪音）', async () => {
    global.confirm = () => true;
    const c = ctx();
    c.bank.sel = ['a', 'b'];
    await Bank.methods.bankBatchDelete.call(c);
    expect(c.calls.filter((x) => x.method === 'DELETE').length).toBe(1);
  });

  it('清空选择', () => {
    const c = ctx(); c.bank.sel = ['a', 'b'];
    Bank.methods.bankClearSel.call(c);
    expect(c.bank.sel).toEqual([]);
  });
});

describe('查重现在认得出「同题不同插图形态」', () => {
  const B64 = '求下列极限\n\n<figure class="fig"><img src="data:image/png;base64,' + 'A'.repeat(500) + '"></figure>\n\n(1) $x\\to0$';
  const PH = '求下列极限\n\n<figure class="fig">［图］</figure>\n\n(1) $x\\to0$';
  const R2 = '求下列极限\n\n![](/api/qimg?k=qimg/abc.png)\n\n(1) $x\\to0$';

  it('前端剥图规则与后端 stemShape 结果一致（两份实现必须同步）', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/views/bank.js'), 'utf8');
    const strip = new Function(src.slice(src.indexOf('const _stripFigs='), src.indexOf('const _dsNorm=')) + ';return _stripFigs;')();
    for (const t of [B64, PH, R2, '无图题干', '![](https://r2/x.png) 外链']) {
      expect(strip(t)).toBe(stemShape(t));
    }
  });

  it('三种插图形态归一后完全相同 → bankDedup 的精确判定能抓到', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/views/bank.js'), 'utf8');
    const strip = new Function(src.slice(src.indexOf('const _stripFigs='), src.indexOf('const _dsNorm=')) + ';return _stripFigs;')();
    expect(strip(B64)).toBe(strip(PH));
    expect(strip(PH)).toBe(strip(R2));
  });

  it('simhash 喂的是剥图后的文本，不再被 base64 主导', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/views/bank.js'), 'utf8');
    expect(src).toMatch(/simhash64\(_stripFigs\(q\.stem\|\|''\)/);
    expect(src).not.toMatch(/simhash64\(\(q\.stem\|\|''\)\+' '/);
  });

  it('bankDedup 的分组键含章节且已剥图', () => {
    const src = fs.readFileSync(path.join(ROOT, 'js/views/bank.js'), 'utf8');
    expect(src).toMatch(/_stripFigs\(q\.stem\)/);
    expect(src).toMatch(/\(q\.chapter\|\|''\)/);
  });
});
