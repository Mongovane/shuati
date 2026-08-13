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
// 孤儿扫描要在 questions/materials 上各跑一次 GROUP BY 全表扫描，
// 而 loadSubjects() 前端有 13 处调用（每次保存科目/调顺序/补关键词后都会重拉）。
// 所以改成显式 ?orphans=1 才扫 —— 上一版无条件扫，把这条接口拖成几百毫秒，
// 用户点「补回关键词」半天没反应就连点好几次。
const get = async (db, withOrphans = true) => (await getSubjects({
  request: authedReq('http://x/api/subjects' + (withOrphans ? '?orphans=1' : '')),
  env: Object.assign(makeEnv(db), { DB: db }),
})).json();
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
  it('不带 orphans=1 时跳过扫描（这是热路径，13 处调用都走这条）', async () => {
    const db = mkDb({ subjects: SUBJ, m: [{ s: 'politics', n: 278 }] });
    const d = await get(db, false);
    expect(d.orphans).toBeUndefined();
    expect(db.log.filter((r) => /GROUP BY subject/i.test(r.sql))).toHaveLength(0);
    expect(d.items).toHaveLength(3);          // 科目列表照常返回
    expect(d.defaults).toHaveLength(4);       // chip 需要的默认值也照常返回
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
  it('loadSubjects 只在带 orphans=1 时更新列表，不覆盖已有结果', () => {
    expect(settings).toContain("async loadSubjects(withOrphans)");
    expect(settings).toContain("'/api/subjects'+(withOrphans?'?orphans=1':'')");
    expect(settings).toContain('if(Array.isArray(d&&d.orphans))this.subjOrphans=d.orphans;');
  });
  it('只在进设置页时扫一次', () => {
    expect(read('js/app.js')).toContain("if(v==='settings' && this.token && !this._orphansScanned){ this._orphansScanned=true; this.loadSubjects(true); }");
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

describe('内置科目 chip：三态灰点', () => {
  const settings = read('js/views/settings.js');
  const tpl = read('js/tpl/view-settings.js');
  const css = read('css/style.css');

  const D = {
    politics: { code: 'politics', name: '政治理论', keywords: '马克思,毛概' },
    english: { code: 'english', name: '英语', keywords: '阅读理解,完形,四级' },
  };
  const mk = (subjects, orphans = []) => {
    const calls = [];
    return Object.assign(Object.create(Settings.methods), {
      subjects, subjOrphans: orphans, calls, flashes: [],
      flash(m) { this.flashes.push(String(m)); },
      loadSubjects: async () => {}, loadMeta() {},
      async api(p, o) { calls.push({ m: o.method, b: JSON.parse(o.body) }); return { ok: true }; },
    });
  };

  it('三态判定：正常 / 缺关键词 / 已删除', () => {
    const c = mk([
      { v: 'english', t: '英语', keywords: '' },
      { v: 'math', t: '高等数学', keywords: '导数,积分' },
    ]);
    expect(c.subjChipState({ code: 'math' })).toBe('ok');
    expect(c.subjChipState({ code: 'english' })).toBe('nokw');
    expect(c.subjChipState({ code: 'politics' })).toBe('gone');
  });
  it('只有空白字符的关键词也算缺', () => {
    const c = mk([{ v: 'english', t: '英语', keywords: '   ' }]);
    expect(c.subjChipState({ code: 'english' })).toBe('nokw');
  });

  it('黄点（缺关键词）：PATCH 补回默认值，不重建科目', async () => {
    global.confirm = () => true;
    const c = mk([{ v: 'english', t: '英语', keywords: '', sort: 10 }]);
    await c.subjRestoreDefault(D.english);
    expect(c.calls[0].m).toBe('PATCH');
    expect(c.calls[0].b).toMatchObject({ code: 'english', keywords: '阅读理解,完形,四级' });
    expect(c.flashes.join('')).toMatch(/已补回/);
  });
  it('蓝点（已删除）：POST 按原代码重建', async () => {
    global.confirm = () => true;
    const c = mk([]);
    await c.subjRestoreDefault(D.english);
    expect(c.calls[0].m).toBe('POST');
    expect(c.calls[0].b).toMatchObject({ code: 'english', keywords: '阅读理解,完形,四级' });
  });
  it('灰点（正常）：不发任何请求', async () => {
    const c = mk([{ v: 'english', t: '英语', keywords: '已有关键词' }]);
    await c.subjRestoreDefault(D.english);
    expect(c.calls).toHaveLength(0);
    expect(c.flashes.join('')).toMatch(/已存在且有关键词/);
  });
  it('点击只开弹窗，不直接发请求', () => {
    const c = mk([{ v: 'english', t: '英语', keywords: '' }]);
    c.subjChipClick(D.english);
    expect(c.calls).toHaveLength(0);
    expect(c.subjChipDlg).toMatchObject({ code: 'english', state: 'nokw' });
    expect(c.subjChipDlg.kws).toEqual(['阅读理解', '完形', '四级']);
  });
  it('正常态点了不开弹窗', () => {
    const c = mk([{ v: 'english', t: '英语', keywords: '有了' }]);
    c.subjChipClick(D.english);
    expect(c.subjChipDlg).toBeFalsy();
  });
  it('弹窗里取消就什么都不做', () => {
    const c = mk([]);
    c.subjChipClick(D.english);
    c.subjChipDlgClose();
    expect(c.subjChipDlg).toBe(null);
    expect(c.calls).toHaveLength(0);
  });
  it('重建态的弹窗要说明会归位多少内容', () => {
    const c = mk([], [{ code: 'politics', questions: 0, materials: 278 }]);
    c.subjChipClick(D.politics);
    expect(c.subjChipDlg.moved).toBe('278 页教材');
    expect(c.subjChipDlg.desc).toMatch(/自动归位/);
  });
  it('防连点：正在处理时再点无效', async () => {
    const c = mk([{ v: 'english', t: '英语', keywords: '', sort: 10 }]);
    c.subjChipBusy = 'english';
    await c.subjRestoreDefault(D.english);
    expect(c.calls).toHaveLength(0);
  });
  it('处理完清掉 busy，允许再次操作', async () => {
    const c = mk([{ v: 'english', t: '英语', keywords: '', sort: 10 }]);
    await c.subjRestoreDefault(D.english);
    expect(c.subjChipBusy).toBe('');
  });
  it('重建时若有孤儿内容，提示要说明会归位多少', async () => {
    global.confirm = () => true;
    const c = mk([], [{ code: 'politics', questions: 0, materials: 278 }]);
    await c.subjRestoreDefault(D.politics);
    expect(c.flashes.join('')).toMatch(/278 页教材 已归位/);
  });

  it('渲染成小圆点而不是整颗高亮胶囊', () => {
    expect(tpl).toContain('class="def-dot"');
    expect(tpl).toContain('subjChipState(d)');
    expect(css).toContain('.def-dot{');
    for (const st of ['.def-chip.nokw .def-dot', '.def-chip.gone .def-dot']) expect(css).toContain(st);
  });
  it('正常态不可点；正在处理时全部不可点（防连点）', () => {
    expect(tpl).toContain("subjChipState(d)==='ok' || !!subjChipBusy");
    expect(css).toContain('.def-chip.nokw,.def-chip.gone{cursor:pointer');
  });
  it('处理中的那个 chip 显示转圈', () => {
    expect(tpl).toContain('subjChipBusy===d.code');
    expect(tpl).toContain('class="spin"');
  });
  it('说明改成居中弹窗，不再用浏览器原生 title/confirm', () => {
    expect(tpl).toContain('chipdlg-mask');
    expect(tpl).toContain('@click.self="subjChipDlgClose"');
    expect(tpl).not.toContain(':title="subjChipTip(d)"');
    expect(settings).not.toContain("confirm('重建内置科目");
  });
  it('弹窗把默认关键词逐个列出来给用户过目', () => {
    expect(tpl).toContain('chipdlg-kwlist');
    expect(tpl).toContain('v-for="k in subjChipDlg.kws"');
  });
  it('弹窗在处理中禁用取消和确定，避免中途关掉', () => {
    expect(tpl.match(/:disabled="!!subjChipBusy"/g).length).toBeGreaterThanOrEqual(3);
  });
  it('居中且移动端贴底', () => {
    expect(css).toContain('.chipdlg-mask{position:fixed;inset:0');
    expect(css).toContain('align-items:center;justify-content:center');
    expect(css).toContain('.chipdlg-mask{padding:12px;align-items:flex-end}');
  });
  it('图例把三种颜色讲清楚', () => {
    expect(tpl).toMatch(/灰点＝正常/);
    expect(tpl).toMatch(/黄点＝缺默认关键词/);
    expect(tpl).toMatch(/蓝点＝科目已被删除/);
  });
  it('后端把默认定义下发给前端（不让前端再抄一份）', () => {
    expect(read('functions/api/subjects.js')).toContain('defaults: DEFAULT_SUBJECTS.map');
    expect(settings).toContain('this.subjDefaults=Array.isArray(d&&d.defaults)?d.defaults:[];');
  });
});
