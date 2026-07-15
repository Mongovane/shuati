// 测试辅助工具。
// 前端是无构建的普通 <script>（不是模块），用 new Function 在函数作用域里执行源码，
// 把顶层 const（QuestionCard / SettingsMixin / 常量）取出来测——不改动线上代码结构。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// —— 题卡组件（依赖 constants.js 的 AUTO/OBJECTIVE 等；RichText 用空桩即可）——
export function loadQuestionCard() {
  const src = read('js/constants.js') + '\n' + read('js/components/question-card.js');
  return new Function('RichText', src + '\nreturn { QuestionCard, AUTO, OBJECTIVE };')({});
}

// 构造调用 QuestionCard computed 所需的 this 上下文（把依赖的其它 computed 一并挂上）
export function cardCtx(QC, q, over = {}) {
  const ctx = { q, sel: [], blanks: '', blanksArr: [], text: '', self: null, ...over };
  ctx.isChoice = q.type === 'single_choice' || q.type === 'multiple_choice';
  ctx.isMulti = q.type === 'multiple_choice';
  ctx.answerKeys = (q.answer || []).map((x) => String(x).toUpperCase());
  for (const k of ['autoCorrect', 'blankCount', 'isMultiBlank', 'mcPartial', 'ansDisplay']) {
    Object.defineProperty(ctx, k, { get() { return QC.computed[k].call(this); } });
  }
  return ctx;
}

// —— 设置页 mixin（含前端科目判定 classifySubject）——
export function loadSettingsMixin() {
  return new Function(read('js/views/settings.js') + '\nreturn SettingsMixin;')();
}

// 与 functions/api/subjects.js 的种子保持一致（tests/subject-classify.test.mjs 会校验没有漂移）
export const SEED_SUBJECTS = [
  { code: 'politics', keywords: '马克思,马克思主义,毛泽东,邓小平,习近平,社会主义,中国共产党,中国特色,辩证唯物,历史唯物,生产关系,生产力,无产阶级,资本主义,党的领导,毛概,马原,史纲,思修,科学发展观,三个代表,实事求是,改革开放,新民主主义' },
  { code: 'english', keywords: '阅读理解,完形,词汇,语法,写作,四级,六级' },
  { code: 'math', keywords: '导数,积分,极限,微分,矩阵,行列式,向量,特征值,定积分,不定积分,级数,偏导,微分方程,连续函数,可导,渐近线' },
  { code: 'computer', keywords: '算法,数据结构,时间复杂度,空间复杂度,链表,二叉树,操作系统,数据库,指针,数组,哈希,递归,进制转换,源程序,伪代码' },
];

// —— D1 桩：记录所有 SQL 与绑定参数，按正则路由返回预设数据 ——
// routes: [{ match: /regex/, value: rows | (binds, sql) => rows }]
export class FakeDB {
  constructor(routes = []) { this.log = []; this.batches = []; this.routes = routes; }
  prepare(sql) {
    const self = this; const rec = { sql, binds: [] };
    return {
      _rec: rec,
      bind(...a) { rec.binds = a; return this; },
      async first() { self.log.push(rec); const v = self._route(sql, rec.binds); return Array.isArray(v) ? (v[0] ?? null) : v; },
      async all() { self.log.push(rec); const v = self._route(sql, rec.binds); return { results: Array.isArray(v) ? v : (v ? [v] : []) }; },
      async run() { self.log.push(rec); return { meta: { changes: 1, last_row_id: 1 } }; },
    };
  }
  async batch(list) { this.batches.push(list); for (const s of list) this.log.push(s._rec); return list.map(() => ({ meta: { changes: 1 } })); }
  _route(sql, binds) {
    for (const r of this.routes) { if (r.match.test(sql)) return typeof r.value === 'function' ? r.value(binds, sql) : r.value; }
    return null;
  }
  // 便捷断言：所有执行过的语句（含 batch 内）里，是否有 SQL 命中正则
  ran(re) { return this.log.some((r) => re.test(r.sql)); }
  stmts(re) { return this.log.filter((r) => re.test(r.sql)); }
}

export const TOKEN = 'testtoken';
export function authedReq(url, opts = {}) {
  return new Request(url, { ...opts, headers: { authorization: 'Bearer ' + TOKEN, 'content-type': 'application/json', ...(opts.headers || {}) } });
}
export function makeEnv(db) { return { DB: db, APP_TOKEN: TOKEN }; }
