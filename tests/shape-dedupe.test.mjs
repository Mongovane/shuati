// 重导不该产生重复行：题干里的插图形态会变（MinerU 内嵌 base64 → 转存 R2 短链 →
// 早期版本剥成「［图］」占位），但那不改变一道题的身份。
// stableQid 拿 subject+stem 做哈希，题干一变 id 就变，于是重导变成「新增一行」——
// 线上实测留下 16 行「［图］」旧行，其中 10 行有带真图的孪生行。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FakeDB, authedReq, makeEnv, ROOT } from './helpers.mjs';
import { stemShape, shapeKey, stableQid, onRequestPost as process } from '../functions/api/process.js';

const STEM_B64 = '对图 1-9 所示的函数 $y=f(x)$\n\n<figure class="fig"><img src="data:image/png;base64,AAAABBBB"></figure>\n\n下列陈述哪些对？';
const STEM_PH = '对图 1-9 所示的函数 $y=f(x)$\n\n<figure class="fig">［图］</figure>\n\n下列陈述哪些对？';
const STEM_R2 = '对图 1-9 所示的函数 $y=f(x)$\n\n![](/api/qimg?k=qimg/abc.png)\n\n下列陈述哪些对？';

describe('stemShape：插图形态归一', () => {
  it('base64 / ［图］占位 / R2 短链 三种形态得到同一个 shape', () => {
    expect(stemShape(STEM_B64)).toBe(stemShape(STEM_PH));
    expect(stemShape(STEM_PH)).toBe(stemShape(STEM_R2));
    expect(stemShape(STEM_B64)).toContain('对图 1-9 所示的函数');
    expect(stemShape(STEM_B64)).not.toContain('base64');
  });

  it('[图] 半角与全角、带空格都认', () => {
    const a = stemShape('看 ［图］ 求值'); const b = stemShape('看 [ 图 ] 求值');
    expect(a).toBe(b);
  });

  it('题干正文不同就不该同 shape（不能把不同题并成一道）', () => {
    expect(stemShape('求极限 A ![](data:image/png;base64,X)')).not.toBe(stemShape('求极限 B ![](data:image/png;base64,X)'));
  });

  it('shapeKey 把章节也纳入：不同章节里字面相同的小题不会互相认领', () => {
    expect(shapeKey('math', '习题1-3', STEM_B64)).toBe(shapeKey('math', '习题1-3', STEM_PH));
    expect(shapeKey('math', '习题1-3', STEM_B64)).not.toBe(shapeKey('math', '习题1-4', STEM_B64));
    expect(shapeKey('math', '习题1-3', STEM_B64)).not.toBe(shapeKey('cs', '习题1-3', STEM_B64));
  });

  it('shape 与 stableQid 是两套指纹，互不干扰', () => {
    expect(stableQid('math', STEM_B64)).not.toBe(stableQid('math', STEM_PH));   // 老指纹会变（这就是病根）
    expect(shapeKey('math', 'c', STEM_B64)).toBe(shapeKey('math', 'c', STEM_PH)); // 新指纹不变
  });
});

const req = (body) => authedReq('http://x/api/process', { method: 'POST', body: JSON.stringify(body) });
const Q = (stem, over) => Object.assign({ type: 'short_answer', stem, answer: ['x'], chapter: '习题1-3' }, over || {});

function db(existing) {
  return new FakeDB([
    { match: /SELECT code FROM subjects|FROM subjects/, value: [{ code: 'math' }] },
    { match: /SELECT id, subject, chapter, stem FROM questions/, value: [] },
    { match: /SELECT id, shape_key FROM questions/, value: existing || [] },
  ]);
}

describe('导入时按 shape 认领已有行', () => {
  it('库里已有「［图］」版本时，带真图的重导会复用它的 id（原地更新，不新增）', async () => {
    const oldId = 'math-OLDROW';
    const key = shapeKey('math', '习题1-3', STEM_PH);
    const d = db([{ id: oldId, shape_key: key }]);
    const res = await process({ request: req({ subject: 'math', trusted: true, questions: [Q(STEM_B64)] }), env: makeEnv(d) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.updated_in_place).toBe(1);
    const ins = d.stmts(/INSERT INTO questions/);
    expect(ins.length).toBe(1);
    expect(ins[0].binds[0]).toBe(oldId);                    // 用的是老行的 id
    expect(ins[0].binds[7]).toBe(STEM_B64);                 // 题干被换成带真图的版本
    expect(ins[0].binds[14]).toBe(key);                     // shape_key 一起写入
  });

  it('库里没有同 shape 的行时，走原本的 stableQid 新建', async () => {
    const d = db([]);
    const body = await (await process({ request: req({ subject: 'math', trusted: true, questions: [Q(STEM_B64)] }), env: makeEnv(d) })).json();
    expect(body.updated_in_place).toBe(0);
    expect(d.stmts(/INSERT INTO questions/)[0].binds[0]).toBe('math-' + stableQid('math', STEM_B64));
  });

  it('同一 shape 有多行（历史重复）时只更新第一行，其余如实报出来、不擅自删', async () => {
    const key = shapeKey('math', '习题1-3', STEM_PH);
    const d = db([{ id: 'math-A', shape_key: key }, { id: 'math-B', shape_key: key }]);
    const body = await (await process({ request: req({ subject: 'math', trusted: true, questions: [Q(STEM_B64)] }), env: makeEnv(d) })).json();
    expect(body.dup_total).toBe(1);
    expect(body.dup_groups[0]).toEqual({ kept: 'math-A', others: ['math-B'] });
    expect(d.stmts(/INSERT INTO questions/)[0].binds[0]).toBe('math-A');
    expect(d.ran(/DELETE FROM questions/)).toBe(false);     // 不删
  });

  it('历史行缺 shape_key 时会先就地回填', async () => {
    const d = new FakeDB([
      { match: /FROM subjects/, value: [{ code: 'math' }] },
      { match: /SELECT id, subject, chapter, stem FROM questions/, value: [{ id: 'math-OLD', subject: 'math', chapter: '习题1-3', stem: STEM_PH }] },
      { match: /SELECT id, shape_key FROM questions/, value: [] },
    ]);
    await process({ request: req({ subject: 'math', trusted: true, questions: [Q(STEM_B64)] }), env: makeEnv(d) });
    const back = d.stmts(/UPDATE questions SET shape_key/);
    expect(back.length).toBe(1);
    expect(back[0].binds).toEqual([shapeKey('math', '习题1-3', STEM_PH), 'math-OLD']);
    expect(d.stmts(/SELECT id, subject, chapter, stem FROM questions/)[0].sql).toMatch(/shape_key IS NULL/);
  });

  it('回填或查询失败都不该挡住导入（退回按 id 去重）', async () => {
    const d = new FakeDB([
      { match: /FROM subjects/, value: [{ code: 'math' }] },
      { match: /SELECT id, (subject|shape_key)/, value: () => { throw new Error('D1 down'); } },
    ]);
    const res = await process({ request: req({ subject: 'math', trusted: true, questions: [Q(STEM_B64)] }), env: makeEnv(d) });
    expect(res.status).toBe(200);
    expect(d.stmts(/INSERT INTO questions/).length).toBe(1);
  });

  it('upsert 语句把 shape_key 也纳入更新，不然回填的值会被覆盖成空', () => {
    const src = fs.readFileSync(path.join(ROOT, 'functions/api/process.js'), 'utf8');
    const sql = src.slice(src.indexOf('INSERT INTO questions'), src.indexOf('await batchChunked(env, cleanedQ'));
    expect(sql).toMatch(/shape_key/);
    expect(sql).toMatch(/shape_key=excluded\.shape_key/);
  });
});

describe('前端提示', () => {
  const Ingest = new Function(fs.readFileSync(path.join(ROOT, 'js/views/ingest.js'), 'utf8') + ';return IngestMixin;')();
  const M = Ingest.methods;
  it('把「原地更新」和「库里有重复行」都说出来', () => {
    const msg = M.importMsg.call(Object.create(M), { inserted_questions: 10, updated_in_place: 4, dup_total: 2 });
    expect(msg).toContain('10 题');
    expect(msg).toMatch(/4 题.*更新已有行/);
    expect(msg).toMatch(/2 道题.*重复行/);
  });
  it('没有重复时不加噪音', () => {
    const msg = M.importMsg.call(Object.create(M), { inserted_questions: 10 });
    expect(msg).not.toMatch(/更新已有行|重复行/);
  });
});
