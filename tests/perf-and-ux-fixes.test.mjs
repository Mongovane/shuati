// 首屏加载性能优化、功能 Bug 修复与刷题交互增强回归测试
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FakeDB, authedReq, makeEnv, loadQuestionCard, ROOT } from './helpers.mjs';
import { onRequestGet as getQuestions } from '../functions/api/questions.js';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('首屏按需加载（根治启动即全量拉取整本教材阻塞首题）', () => {
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
});

describe('Service Worker 预缓存完整性与首屏网络让路', () => {
  const swSrc = read('sw.js');
  const htmlSrc = read('index.html');

  it('index.html 引用的所有本地 ?v= 资源均在 sw.js CORE 预缓存清单中（含 icon.js）', () => {
    const htmlAssets = [...htmlSrc.matchAll(/(?:src|href)="(js\/[^"]+|css\/[^"]+)"/g)].map((m) => './' + m[1]);
    expect(htmlAssets.length).toBeGreaterThanOrEqual(27);
    for (const asset of htmlAssets) {
      expect(swSrc.includes(asset), 'sw.js CORE 缺少预缓存资源: ' + asset).toBe(true);
    }
  });
});

describe('题卡原生参考解析（baseAnalysis）展示与 light=1 懒加载 AI 状态同步', () => {
  const { QuestionCard: QC } = loadQuestionCard();
  const Practice = new Function(read('js/views/practice.js') + ';return PracticeMixin;')();

  it('QuestionCard.computed.baseAnalysis 正确提取原生参考解析并剥离追加的 AI 解析段', () => {
    const fn = QC.computed.baseAnalysis;
    expect(fn.call({ q: { analysis: '【精析】由洛必达法则得极限为 2。' } })).toBe('【精析】由洛必达法则得极限为 2。');
    expect(fn.call({ q: { analysis: '原生解析内容\n\n---\n\n**AI 解析**\n\nAI生成的详细步骤' } })).toBe('原生解析内容');
    expect(fn.call({ q: { analysis: '**AI 解析**\n\n只有AI解析没有原生解析' } })).toBe('');
    expect(fn.call({ q: { analysis: '' } })).toBe('');
  });

  it('QuestionCard 模板在揭晓后渲染参考解析（baseAnalysis）与题目标签（q.tags）', () => {
    expect(QC.template).toContain('v-if="baseAnalysis"');
    expect(QC.template).toContain('参考解析');
    expect(QC.template).toContain('class="q-tags"');
    expect(QC.template).toContain('class="card card-q"');
  });

  it('ensureFullQuestion 补回 analysis/ai_cards 后自动同步已存 AI 解析与卡片到 aiStates 及当前 aiX', async () => {
    const q = { id: 'q1', _lite: true, has_analysis: true, has_cards: true, analysis: '', ai_cards: null };
    const ctx = Object.assign(Object.create(Practice.methods), {
      cur: q,
      aiStates: {},
      aiX: { id: '', view: '', text: '', cards: [] },
      _extractSavedAi(item) {
        const a = String((item && item.analysis) || '');
        const i = a.search(/\*\*(AI 解析|知识点卡片)\*\*/);
        return i >= 0 ? a.slice(i).replace(/^\*\*(AI 解析|知识点卡片)\*\*\s*/, '').trim() : '';
      },
      async api() {
        return {
          items: [{
            id: 'q1',
            analysis: '原生解析\n\n---\n\n**AI 解析**\n\n保存的AI深度解析',
            ai_cards: [{ term: '拉格朗日中值定理', formula: "f'(c)=(f(b)-f(a))/(b-a)", plain: '区间存在切线平行于割线', example: '例题' }],
          }],
        };
      },
    });
    await ctx.ensureFullQuestion(q);
    expect(q.analysis).toContain('原生解析');
    expect(ctx.aiStates.q1).toBeDefined();
    expect(ctx.aiStates.q1.text).toBe('保存的AI深度解析');
    expect(ctx.aiStates.q1.cards).toHaveLength(1);
    expect(ctx.aiX.id).toBe('q1');
    expect(ctx.aiX.cards).toHaveLength(1);
    expect(ctx.aiX.text).toBe('保存的AI深度解析');
  });
});

describe('刷题交互增强：背题模式（studyMode）、点选即交（instantSubmit）、答对自动下一题（autoNext）', () => {
  const { QuestionCard: QC } = loadQuestionCard();

  it('studyMode=true 时无需作答即处于 revealed 状态', () => {
    const q = { id: 'q1', type: 'single_choice', answer: ['A'] };
    expect(QC.computed.revealed.call({ mode: 'practice', studyMode: false, localRevealed: false, q })).toBe(false);
    expect(QC.computed.revealed.call({ mode: 'practice', studyMode: true, localRevealed: false, q })).toBe(true);
  });

  it('instantSubmit=true 时单选与判断题点选后立即触发 submit()', () => {
    let submitted = 0;
    const singleCtx = {
      q: { id: 'q1', type: 'single_choice', answer: ['B'] },
      mode: 'practice', revealed: false, isMulti: false, instantSubmit: true, sel: [],
      submit() { submitted++; },
    };
    QC.methods.pick.call(singleCtx, 'B');
    expect(singleCtx.sel).toEqual(['B']);
    expect(submitted).toBe(1);

    const multiCtx = {
      q: { id: 'q2', type: 'multiple_choice', answer: ['A', 'B'] },
      mode: 'practice', revealed: false, isMulti: true, instantSubmit: true, sel: [],
      submit() { submitted++; },
    };
    QC.methods.pick.call(multiCtx, 'A');
    expect(multiCtx.sel).toEqual(['A']);
    expect(submitted).toBe(1); // 多选题不自动提交
  });
});

describe('后端 GET /api/questions?meta=1 附带 wrong_open 与 mode=all COUNT 去冗余 JOIN', () => {
  it('meta=1 返回 wrong_open 与 due 供顶栏错题徽标首屏展示', async () => {
    const db = new FakeDB([
      { match: /GROUP BY subject, chapter/i, value: [{ subject: 'math', chapter: '极限', n: 5 }] },
      { match: /GROUP BY subject/i, value: [{ subject: 'math', n: 10 }] },
      { match: /WHERE status = 'draft'/i, value: { n: 2 } },
      { match: /FROM progress WHERE wrong_count > 0/i, value: { n: 7, due: 3 } },
    ]);
    const res = await getQuestions({ request: authedReq('http://x/api/questions?meta=1'), env: makeEnv(db) });
    const data = await res.json();
    expect(data.drafts).toBe(2);
    expect(data.wrong_open).toBe(7);
    expect(data.due).toBe(3);
  });

  it('mode=all 时 countSql 不再冗余 LEFT JOIN progress', async () => {
    const db = new FakeDB([
      { match: /COUNT\(\*\) AS total/i, value: { total: 10 } },
      { match: /FROM questions q/i, value: [] },
    ]);
    await getQuestions({ request: authedReq('http://x/api/questions?mode=all&order=seq&limit=10'), env: makeEnv(db) });
    const cntStmt = db.stmts(/COUNT\(\*\) AS total/i)[0];
    expect(cntStmt).toBeDefined();
    expect(cntStmt.sql).not.toContain('LEFT JOIN progress');
  });
});

describe('CSS 裁切修复与模板样式挂载', () => {
  it('.q-nav-prog 不再设置 overflow:hidden 裁掉上方的题号文字', () => {
    const css = read('css/style.css');
    const line = css.split('\n').find((l) => l.startsWith('.q-nav-prog{'));
    expect(line).toBeTruthy();
    expect(line).not.toContain('overflow:hidden');
  });

  it('CHANGELOG 中设计的响应式与视觉类名已在对应模板中挂载', () => {
    expect(read('js/components/question-card.js')).toContain('class="card card-q"');
    expect(read('js/tpl/shell-open.js')).toContain('class="tabs-more-hint"');
    expect(read('js/tpl/view-practice.js')).toContain('class="row q-info-row q-meta"');
    expect(read('js/tpl/view-practice.js')).toContain('class="q-info-ops"');
    expect(read('js/tpl/view-practice.js')).toContain('class="streak"');
    expect(read('js/tpl/view-bank.js')).toContain('class="bank-check bank-sel-all-match"');
    expect(read('js/tpl/view-stats.js')).toContain(':class="{zero:!statTotals.totalQ}"');
  });
});
