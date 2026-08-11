// 两组问题：
//  A. 解题解析下的追问会显示在知识点卡片视图里，而且卡片视图的追问拿到的上下文其实是解析。
//  B. Bank 的「AI 补答案」：跨页勾选被静默丢弃、空 analysis 会抹掉题目原有解析、不能中止。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const QC = new Function('RichText', read('js/constants.js') + '\n' + read('js/components/question-card.js') + '\nreturn QuestionCard;')({});

const rounds = (aiKind, aiChat) => QC.computed.chatRounds.call({ aiKind, aiChat });

describe('追问按视图分线程', () => {
  const chat = [
    { q: '解析问题1', a: 'a1', kind: 'explain' },
    { q: '卡片问题1', a: 'b1', kind: 'concept' },
    { q: '解析问题2', a: 'a2', kind: 'explain' },
  ];
  it('解析视图只看到解析的追问', () => {
    expect(rounds('', chat).map((r) => r.c.q)).toEqual(['解析问题1', '解析问题2']);
  });
  it('卡片视图只看到卡片的追问', () => {
    expect(rounds('concept', chat).map((r) => r.c.q)).toEqual(['卡片问题1']);
  });
  it('保留在 aiChat 里的真实下标 —— 否则 ai-retry 会删错条目', () => {
    expect(rounds('', chat).map((r) => r.i)).toEqual([0, 2]);
    expect(rounds('concept', chat).map((r) => r.i)).toEqual([1]);
  });
  it('没有 kind 的旧记录按解析处理（向后兼容已存的追问）', () => {
    const legacy = [{ q: '老记录', a: 'x' }];
    expect(rounds('', legacy)).toHaveLength(1);
    expect(rounds('concept', legacy)).toHaveLength(0);
  });
  it('空输入不炸', () => {
    expect(rounds('', undefined)).toEqual([]);
    expect(rounds('concept', [])).toEqual([]);
  });
});

describe('模板用 chatRounds 而不是 aiChat', () => {
  const tpl = QC.template;
  it('v-for 走过滤后的 chatRounds', () => {
    expect(tpl).toContain('v-for="r in chatRounds"');
    expect(tpl).not.toContain('v-for="(c,i) in aiChat"');
  });
  it('retry 传真实下标 r.i', () => {
    expect(tpl).toContain("$emit('ai-retry',r.i)");
  });
  it('清空按钮按当前视图的条数显隐', () => {
    expect(tpl).toContain('chatRounds.length && !aiAsking');
  });
});

describe('practice.js：上下文与归属', () => {
  const src = read('js/views/practice.js');
  it('追问条目打上归属视图', () => {
    expect(src).toContain("const kind=(this.aiX.view==='concept')?'concept':'explain';");
    expect(src).toContain("this.aiX.chat.push({ q:text, a:'', r:'', kind });");
  });
  it('历史只带同一视图的轮次', () => {
    expect(src).toContain("filter(c=>((c.kind||'explain')===kind))");
  });
  it('上下文跟着视图走，不再无条件优先用解析', () => {
    expect(src).toContain("kind==='concept' ? (cardsCtx() || this.aiX.text");
    expect(src).not.toMatch(/let analysisCtx=this\.aiX\.text\|\|'';/);
  });
  it('清空只清当前视图', () => {
    expect(src).toContain("const keep=(this.aiX.chat||[]).filter(c=>((c.kind||'explain')!==kind));");
  });
});

describe('Bank AI 补答案', () => {
  const src = read('js/views/bank.js');
  it('跨页勾选要回服务端补齐，不能只从本页 items 过滤', () => {
    expect(src).toContain("const miss=sel.filter(id=>!have.has(id));");
    expect(src).toContain("'/api/questions?ids='");
  });
  it('拉取失败就中止，不能装作没这回事继续', () => {
    expect(src).toContain('拉取跨页勾选的题目失败，已中止');
  });
  it('analysis 只在非空时才发 —— 否则会抹掉题目原有的【精析】', () => {
    expect(src).toContain("if(String(it.analysis||'').trim())row.analysis=it.analysis;");
    expect(src).not.toContain("analysis:it.analysis||''");
  });
  it('支持中止，且已补好的保留', () => {
    expect(src).toContain('AbortController');
    expect(src).toContain('bankAiFillStop()');
    expect(src).toContain("if(e.name==='AbortError'||ctrl.signal.aborted)");
  });
  it('中止后的提示要说清处理到哪儿了', () => {
    expect(src).toContain("f.canceled?'已停止（处理了 '");
  });
  it('确认框告知请求次数，别让人蒙着点', () => {
    expect(src).toContain("Math.ceil(pool.length/CH)");
  });
  it('停止按钮挂上去了', () => {
    expect(read('js/tpl/view-bank.js')).toContain('bankAiFillStop');
  });
});

describe('落库改成一次批量 PATCH', () => {
  const src = read('js/views/bank.js');
  it('走服务端新增的 items 路径', () => {
    expect(src).toContain("body:JSON.stringify({items:patch})");
  });
  it('不再每题一个 {ids:[it.id]}', () => {
    expect(src).not.toContain("ids:[it.id]");
  });
  it('批量 PATCH 也要能被中止', () => {
    expect(src).toMatch(/method:'PATCH',signal:ctrl\.signal/);
  });
});

describe('PATCH 语义（说明这个坑为什么存在）', () => {
  it('空字符串会被写库，所以前端必须自己判空', () => {
    const api = read('functions/api/questions.js');
    expect(api).toContain("body[k] !== undefined && body[k] !== null");
  });
});
