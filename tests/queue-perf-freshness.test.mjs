// 两个线上问题：
//
// 一、564 道题时 Home 骨架屏转很久。实测一批 30 题的响应是 220KB / 1.1~3.3 秒，
//    其中 analysis 88KB + ai_cards 6KB = 43% —— 而这两样在【答题阶段根本不显示】，
//    要等用户揭晓答案才用得上。改成 light=1 不取，揭晓时按 id 单独补。
//    （基线延迟本身就有 ~800ms：一个 3KB 的 meta 查询也要 829ms，那部分动不了。）
//
// 二、题库里 AI 补答案补完，回 Home 看到的还是补之前那批题。
//    bankDirty 只让题库页重拉，Home 的活会话和缓存快照不受它影响。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FakeDB, authedReq, makeEnv, ROOT } from './helpers.mjs';
import { onRequestGet as getQuestions } from '../functions/api/questions.js';
import { rowToQuestion } from '../functions/api/_utils.js';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('light=1：列表不带解析和卡片', () => {
  const grab = async (qs) => {
    const db = new FakeDB([{ match: /FROM questions q/i, value: [] }]);
    await getQuestions({ request: authedReq('http://x/api/questions?' + qs), env: Object.assign(makeEnv(db), { DB: db }) });
    return db.log.filter((r) => /FROM questions q/i.test(r.sql)).map((r) => r.sql).join('\n');
  };
  it('默认仍然取全部列（其它页面依赖）', async () => {
    expect(await grab('limit=30')).toMatch(/SELECT q\.\*/);
  });
  it('light=1 时不查 analysis / ai_cards', async () => {
    const sql = await grab('limit=30&light=1');
    expect(sql).not.toMatch(/SELECT q\.\*/);
    // 注意：has_* 的 CASE 表达式里会出现 q.analysis / q.ai_cards（只读它们判空，不返回内容），
    // 所以断言要针对「选取列」而不是整条 SQL 里的字面量。
    const cols = sql.slice(sql.indexOf('SELECT') + 6, sql.indexOf('FROM questions'));
    const selected = cols.split(',').map((x) => x.trim()).filter((x) => /^q\.[a-z_]+$/.test(x));
    expect(selected).not.toContain('q.analysis');
    expect(selected).not.toContain('q.ai_cards');
  });
  it('但要带回「有没有」的标记，否则前端分不清「没有」和「没取」', async () => {
    const sql = await grab('limit=30&light=1');
    expect(sql).toContain('AS has_analysis');
    expect(sql).toContain('AS has_cards');
  });
  it('答题必需的列一个不能少', async () => {
    const sql = await grab('limit=30&light=1');
    for (const c of ['q.id', 'q.stem', 'q.options', 'q.answer', 'q.type', 'q.passage', 'q.subject']) {
      expect(sql).toContain(c);
    }
  });
});

describe('rowToQuestion 要能区分「没有」和「没取」', () => {
  it('轻量行带 _lite 标记和两个 has_*', () => {
    const q = rowToQuestion({ id: 'a', stem: 's', has_analysis: 1, has_cards: 0 });
    expect(q._lite).toBe(true);
    expect(q.has_analysis).toBe(true);
    expect(q.has_cards).toBe(false);
  });
  it('完整行不带这些标记（老调用方不受影响）', () => {
    const q = rowToQuestion({ id: 'a', stem: 's', analysis: '解析内容' });
    expect(q._lite).toBeUndefined();
    expect(q.analysis).toBe('解析内容');
  });
});

describe('前端：按需补齐', () => {
  const Practice = new Function(read('js/views/practice.js') + ';return PracticeMixin;')();
  const mk = (reply) => {
    const calls = [];
    return Object.assign(Object.create(Practice.methods), {
      calls, async api(p) { calls.push(p); return reply; },
    });
  };
  it('取队列时带 light=1', () => {
    expect(read('js/views/practice.js')).toContain('const extra={limit:30, light:1};');
  });
  it('本来就没有解析和卡片时不白跑一趟', async () => {
    const c = mk({ items: [] });
    const q = { id: 'x', _lite: true, has_analysis: false, has_cards: false };
    await c.ensureFullQuestion(q);
    expect(c.calls).toHaveLength(0);
    expect(q._full).toBe(true);
  });
  it('有解析时按 id 取一次并填回去', async () => {
    const c = mk({ items: [{ id: 'x', analysis: '参考解析', ai_cards: [{ term: 'T' }] }] });
    const q = { id: 'x', _lite: true, has_analysis: true, has_cards: true };
    await c.ensureFullQuestion(q);
    expect(c.calls[0]).toContain('ids=x');
    expect(q.analysis).toBe('参考解析');
    expect(q.ai_cards).toHaveLength(1);
  });
  it('已经补过就不重复请求', async () => {
    const c = mk({ items: [{ id: 'x', analysis: 'a' }] });
    const q = { id: 'x', _lite: true, has_analysis: true };
    await c.ensureFullQuestion(q);
    await c.ensureFullQuestion(q);
    expect(c.calls).toHaveLength(1);
  });
  it('完整记录（非 light）不会被误补', async () => {
    const c = mk({ items: [] });
    await c.ensureFullQuestion({ id: 'x', analysis: '已有' });
    expect(c.calls).toHaveLength(0);
  });
  it('揭晓答案时触发补齐，且不阻塞计分', () => {
    const src = read('js/views/practice.js');
    expect(src).toContain('if(q)this.ensureFullQuestion(q).catch(()=>{});');
    expect(src).not.toContain('await this.ensureFullQuestion(q);');
  });
  it('取失败不影响答题（吞掉错误）', async () => {
    const c = Object.assign(Object.create(Practice.methods), { async api() { throw new Error('boom'); } });
    const q = { id: 'x', _lite: true, has_analysis: true };
    await expect(c.ensureFullQuestion(q)).resolves.toBeUndefined();
  });
});

describe('题目内容改过要让 Home 重新取题', () => {
  const app = read('js/app.js');
  it('有独立的 queueDirty，不跟 bankDirty 混用', () => {
    expect(app).toContain('queueDirty:false,');
    expect(app).toContain('if(this.queueDirty){ this.queueDirty=false;');
  });
  it('置位后连活会话一起作废（否则原地不动）', () => {
    expect(app).toContain('delete qCache[v]; this.queue=[]; this.startSession();');
  });
  it('AI 补答案完成后置位 —— 这正是线上没刷新的那条路', () => {
    expect(read('js/views/bank.js')).toContain('this.bankDirty=true; this.statsDirty=true; this.queueDirty=true;');
  });
  it('导入题目 / 教材出题 / 恢复备份 / 科目变更都置位', () => {
    for (const f of ['js/views/ingest.js', 'js/views/books.js', 'js/views/mock-stats.js', 'js/views/settings.js']) {
      expect(read(f)).toContain('this.queueDirty=true;');
    }
  });
  it('刷题页内改当前题不置位（自己已经就地更新，重取反而丢进度）', () => {
    const src = read('js/views/practice.js');
    const idx = src.indexOf('async setQuestionSubject');
    expect(src.slice(idx, idx + 500)).not.toContain('queueDirty');
  });
});


describe('首屏按需加载与 Bug 修复回归验证', () => {
  const appSrc = read('js/app.js');
  const setSrc = read('js/views/settings.js');
  const booksSrc = read('js/views/books.js');

  it('mounted() 不再无条件启动 loadMaterials / loadPdfShelf / loadCfUsage', () => {
    const mountedBlk = appSrc.slice(appSrc.indexOf('mounted(){'), appSrc.indexOf('beforeUnmount(){'));
    expect(mountedBlk).not.toContain('this.loadMaterials()');
    expect(mountedBlk).not.toContain('this.loadPdfShelf()');
    expect(mountedBlk).not.toContain('this.loadCfUsage()');
    expect(mountedBlk).toContain('this.loadSubjects()');
    expect(mountedBlk).toContain('this.loadMeta()');
    expect(mountedBlk).toContain('this.loadConfig()');
  });

  it('go(v) 在进入 books / ingest / settings 时按需触发材料与配置加载', () => {
    const goBlk = appSrc.slice(appSrc.indexOf('go(v){'), appSrc.indexOf('sleep(ms){'));
    expect(goBlk).toContain("if(v==='books' && this.token)");
    expect(goBlk).toContain("if(v==='ingest' && this.token)");
    expect(goBlk).toContain('this.loadMaterials()');
    expect(goBlk).toContain('this.loadPdfShelf()');
    expect(goBlk).toContain('this.loadCfUsage()');
  });

  it('loadMaterials() 仅在当前处于 books 或 ingest 整书抽题页时才拉取整书正文 ensureBookContent()', () => {
    expect(booksSrc).toContain('if(this.view==="books" || (this.view==="ingest" && this.ingest && this.ingest.tab==="book")) await this.ensureBookContent();');
  });

  it('saveToken() 首次填入访问码保存后必须调用 loadConfig() 以激活 AI 解析按钮，且不抢跑下载整书', () => {
    const saveBlk = setSrc.slice(setSrc.indexOf('saveToken(){'), setSrc.indexOf('logout(){'));
    expect(saveBlk).toContain('this.loadConfig()');
    expect(saveBlk).not.toContain('this.loadMaterials()');
    expect(saveBlk).not.toContain('this.loadPdfShelf()');
  });

  it('index.html 引用的所有本地 ?v= 资源均在 sw.js CORE 预缓存清单中（含 icon.js）', () => {
    const swSrc = read('sw.js');
    const htmlSrc = read('index.html');
    const htmlAssets = [...htmlSrc.matchAll(/(?:src|href)="(js\/[^"]+|css\/[^"]+)"/g)].map((m) => './' + m[1]);
    expect(htmlAssets.length).toBeGreaterThanOrEqual(27);
    for (const asset of htmlAssets) {
      expect(swSrc.includes(asset), 'sw.js CORE 缺少预缓存资源: ' + asset).toBe(true);
    }
  });

  it('QuestionCard 模板在揭晓后渲染参考解析（baseAnalysis）与题目标签（q.tags）', () => {
    const qcSrc = read('js/components/question-card.js');
    expect(qcSrc).toContain('v-if="baseAnalysis"');
    expect(qcSrc).toContain('参考解析');
    expect(qcSrc).toContain('class="q-tags"');
    expect(qcSrc).toContain('class="card card-q"');
  });

  it('meta=1 返回 wrong_open 与 due 供顶栏错题徽标首屏展示，且 mode=all 时 countSql 不冗余 LEFT JOIN progress', async () => {
    const db = new FakeDB([
      { match: /GROUP BY subject, chapter/i, value: [{ subject: 'math', chapter: '极限', n: 5 }] },
      { match: /GROUP BY subject/i, value: [{ subject: 'math', n: 10 }] },
      { match: /WHERE status = 'draft'/i, value: { n: 2 } },
      { match: /FROM progress WHERE wrong_count > 0/i, value: { n: 7, due: 3 } },
      { match: /COUNT\(\*\) AS total/i, value: { total: 10 } },
      { match: /FROM questions q/i, value: [] },
    ]);
    const res = await getQuestions({ request: authedReq('http://x/api/questions?meta=1'), env: makeEnv(db) });
    const data = await res.json();
    expect(data.drafts).toBe(2);
    expect(data.wrong_open).toBe(7);
    expect(data.due).toBe(3);

    await getQuestions({ request: authedReq('http://x/api/questions?mode=all&order=seq&limit=10'), env: makeEnv(db) });
    const cntStmt = db.stmts(/COUNT\(\*\) AS total/i)[0];
    expect(cntStmt).toBeDefined();
    expect(cntStmt.sql).not.toContain('LEFT JOIN progress');
  });

  it('.q-nav-prog 不再设置 overflow:hidden 裁掉上方的题号文字，且模板样式全部正确挂载', () => {
    const css = read('css/style.css');
    const line = css.split('\n').find((l) => l.startsWith('.q-nav-prog{'));
    expect(line).toBeTruthy();
    expect(line).not.toContain('overflow:hidden');
    expect(read('js/tpl/shell-open.js')).toContain('class="tabs-more-hint"');
    expect(read('js/tpl/view-practice.js')).toContain('class="row q-info-row q-meta"');
    expect(read('js/tpl/view-practice.js')).toContain('class="q-info-ops"');
    expect(read('js/tpl/view-practice.js')).toContain('class="streak"');
    expect(read('js/tpl/view-bank.js')).toContain('class="bank-check bank-sel-all-match"');
    expect(read('js/tpl/view-stats.js')).toContain(':class="{zero:!statTotals.totalQ}"');
  });
});
