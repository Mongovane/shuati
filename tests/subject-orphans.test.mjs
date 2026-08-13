// 两个后续问题，都是「科目被误删」的余波：
//
//  ① 重建科目后关键词没了。种子只在【表完全为空】时才灌（ensure 里 if(!c.n)），
//     所以删掉内置科目再建回来，keywords 是空的 —— 用户以为「加了科目但关键词丢了」。
//
//  ② 教材列表出现「politics 1 本」这种以原始代码作分组标题的组。
//     成因：materials.subject 还是 'politics'，但科目表里已经没有这一行了
//     （用户重建时代码打成了 '2'）。内容还在，只是没有任何提示告诉用户
//     「代码必须一模一样才会归位」。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FakeDB, authedReq, makeEnv, ROOT } from './helpers.mjs';
import { onRequestGet as getSubjects, onRequestPost as postSubject } from '../functions/api/subjects.js';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const Settings = new Function(read('js/views/settings.js') + ';return SettingsMixin;')();

const mkDb = ({ subjects = [], q = [], m = [] }) => new FakeDB([
  { match: /COUNT\(\*\) AS n FROM subjects/i, value: [{ n: subjects.length }] },
  { match: /SELECT code, name, sort, keywords FROM subjects/i, value: subjects },
  { match: /FROM questions WHERE subject IS NOT NULL/i, value: q },
  { match: /FROM materials WHERE subject IS NOT NULL/i, value: m },
]);
const get = async (db) => (await getSubjects({ request: authedReq('http://x/api/subjects'), env: Object.assign(makeEnv(db), { DB: db }) })).json();
const post = async (db, body) => postSubject({
  request: authedReq('http://x/api/subjects', { method: 'POST', body: JSON.stringify(body) }),
  env: Object.assign(makeEnv(db), { DB: db }),
});

const SUBJ = [
  { code: 'english', name: '英语', sort: 10, keywords: '' },
  { code: 'math', name: '高等数学', sort: 20, keywords: '导数,积分' },
  { code: '2', name: '政治理论', sort: 30, keywords: '' },
];

describe('孤儿科目检测', () => {
  it('教材挂在不存在的科目上时报出来（线上就是这个：politics 278 页）', async () => {
    const d = await get(mkDb({ subjects: SUBJ, m: [{ s: 'politics', n: 278 }, { s: 'math', n: 711 }] }));
    expect(d.orphans).toHaveLength(1);
    expect(d.orphans[0]).toMatchObject({ code: 'politics', materials: 278, suggestName: '政治理论' });
  });
  it('题目和教材都统计', async () => {
    const d = await get(mkDb({ subjects: SUBJ, q: [{ s: 'ghost', n: 5 }], m: [{ s: 'ghost', n: 9 }] }));
    expect(d.orphans[0]).toMatchObject({ code: 'ghost', questions: 5, materials: 9 });
  });
  it('已存在的科目不算孤儿', async () => {
    const d = await get(mkDb({ subjects: SUBJ, q: [{ s: 'math', n: 100 }], m: [{ s: 'english', n: 8 }] }));
    expect(d.orphans).toEqual([]);
  });
  it('非内置代码没有建议名，但仍然报出来', async () => {
    const d = await get(mkDb({ subjects: SUBJ, q: [{ s: 'mycode', n: 3 }] }));
    expect(d.orphans[0].code).toBe('mycode');
    expect(d.orphans[0].suggestName).toBeUndefined();
  });
  it('空 subject 值不计入', async () => {
    const d = await get(mkDb({ subjects: SUBJ, q: [{ s: '', n: 3 }, { s: null, n: 2 }] }));
    expect(d.orphans).toEqual([]);
  });
  it('items 照常返回，不受影响', async () => {
    const d = await get(mkDb({ subjects: SUBJ, m: [{ s: 'politics', n: 278 }] }));
    expect(d.items.map((x) => x.v)).toEqual(['english', 'math', '2']);
  });
});

describe('重建内置科目要补回默认关键词', () => {
  it('关键词留空时自动填默认值', async () => {
    const db = mkDb({ subjects: [] });
    await post(db, { code: 'english', name: '英语' });
    const ins = db.log.find((r) => /INSERT INTO subjects/i.test(r.sql));
    expect(ins.binds[3]).toContain('阅读理解');
    expect(ins.binds[3]).toContain('四级');
  });
  it('政治理论的默认关键词也在', async () => {
    const db = mkDb({ subjects: [] });
    await post(db, { code: 'politics', name: '政治理论' });
    const ins = db.log.find((r) => /INSERT INTO subjects/i.test(r.sql));
    expect(ins.binds[3]).toContain('马克思');
    expect(ins.binds[3]).toContain('毛概');
  });
  it('用户自己填了就用用户的，不覆盖', async () => {
    const db = mkDb({ subjects: [] });
    await post(db, { code: 'english', name: '英语', keywords: '我自己的关键词' });
    const ins = db.log.find((r) => /INSERT INTO subjects/i.test(r.sql));
    expect(ins.binds[3]).toBe('我自己的关键词');
  });
  it('非内置代码没有默认值可补，保持空', async () => {
    const db = mkDb({ subjects: [] });
    await post(db, { code: 'mycode', name: '我的科目' });
    const ins = db.log.find((r) => /INSERT INTO subjects/i.test(r.sql));
    expect(ins.binds[3]).toBe('');
  });
  it('种子和默认值是同一份数据，不会各写各的', () => {
    const src = read('functions/api/subjects.js');
    expect(src).toContain('export const DEFAULT_SUBJECTS');
    expect(src).toContain('for (const [code, name, sort, kw] of DEFAULT_SUBJECTS)');
    expect(src.match(/'阅读理解,完形,词汇/g)).toHaveLength(1);   // 只出现一次
  });
});

describe('前端：把孤儿摆出来并能一键恢复', () => {
  const settings = read('js/views/settings.js');
  const tpl = read('js/tpl/view-settings.js');
  it('loadSubjects 保存 orphans', () => {
    expect(settings).toContain('this.subjOrphans=Array.isArray(d&&d.orphans)?d.orphans:[];');
  });
  it('有重建入口，且代码用孤儿的原始代码（改一个字就归不了位）', () => {
    expect(settings).toContain('async subjRestoreOrphan(o)');
    expect(settings).toContain('code:o.code');
  });
  it('重建前告知会归位多少内容', () => {
    expect(settings).toContain('这些内容目前挂在一个不存在的科目上');
  });
  it('设置页有告警区块', () => {
    expect(tpl).toContain('subjOrphans && subjOrphans.length');
    expect(tpl).toContain('无主内容');
    expect(tpl).toContain('subjRestoreOrphan(o)');
  });
  it('说明里点破「重建同名代码即可归位」', () => {
    expect(tpl).toContain('重建同名代码的科目即可自动归位');
  });
});

describe('内置科目的一键重建 chip', () => {
  const settings = read('js/views/settings.js');
  const tpl = read('js/tpl/view-settings.js');
  const css = read('css/style.css');

  const DEFAULTS = [
    { code: 'politics', name: '政治理论', sort: 1, keywords: '马克思,毛概' },
    { code: 'english', name: '英语', sort: 2, keywords: '阅读理解,完形' },
  ];
  const mkCtx = (subjects, orphans = []) => {
    const calls = [];
    return {
      calls, flashes: [], subjects, subjOrphans: orphans,
      flash(m) { this.flashes.push(String(m)); },
      loadSubjects: async () => {}, loadMeta() {},
      async api(p, o) { calls.push(JSON.parse(o.body)); return { ok: true }; },
    };
  };
  const restore = (c, d) => Settings.methods.subjRestoreDefault.call(c, d);

  it('后端把默认定义下发给前端（不让前端再抄一份）', () => {
    expect(read('functions/api/subjects.js')).toContain('defaults: DEFAULT_SUBJECTS.map');
    expect(settings).toContain('this.subjDefaults=Array.isArray(d&&d.defaults)?d.defaults:[];');
  });
  it('重建时用内置代码，并带回默认名称和关键词', async () => {
    global.confirm = () => true;
    const c = mkCtx([{ v: 'english', t: '英语' }]);
    await restore(c, DEFAULTS[0]);
    expect(c.calls[0]).toMatchObject({ code: 'politics', name: '政治理论', keywords: '马克思,毛概' });
  });
  it('挂在这个代码下的内容会归位，提示要说出来', async () => {
    global.confirm = () => true;
    const c = mkCtx([], [{ code: 'politics', questions: 0, materials: 278 }]);
    await restore(c, DEFAULTS[0]);
    expect(c.flashes.join('')).toMatch(/278 页教材 已归位/);
  });
  it('已存在的科目不重复创建', async () => {
    const c = mkCtx([{ v: 'english', t: '英语' }]);
    await restore(c, DEFAULTS[1]);
    expect(c.calls).toHaveLength(0);
    expect(c.flashes.join('')).toMatch(/已存在/);
  });
  it('取消确认就不发请求', async () => {
    global.confirm = () => false;
    const c = mkCtx([]);
    await restore(c, DEFAULTS[0]);
    expect(c.calls).toHaveLength(0);
  });
  it('chip 按「是否已存在」区分状态：已存在灰且禁用，缺失才可点', () => {
    expect(tpl).toContain("{gone: !subjects.some(x=>x.v===d.code)}");
    expect(tpl).toContain(':disabled="subjects.some(x=>x.v===d.code)"');
    expect(css).toContain('.def-chip{');
    expect(css).toContain('.def-chip.gone{');
  });
  it('chip 上显示代码，用户才知道「代码必须一致」', () => {
    expect(tpl).toContain('<code>{{ d.code }}</code>');
    expect(tpl).toMatch(/灰色＝已存在/);
  });
});
