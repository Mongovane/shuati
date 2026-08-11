// 追问的两个问题：
//  ① 没有流式、没有推理过程
//     —— push 进响应式数组的是原始对象，代码一直在改 push 之前那个原始引用，
//        绕开了 Proxy 的 setter，依赖不触发。最后 asking=false 整体重渲染时文字才一次性出现。
//  ② 生成时强制贴底，用户往上翻会被一直拽回去。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { reactive, effect } from '@vue/reactivity';
import { ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const QC = new Function('RichText', read('js/constants.js') + '\n' + read('js/components/question-card.js') + '\nreturn QuestionCard;')({});

describe('Vue 响应式：改原始对象 vs 改代理', () => {
  const run = (mutate) => {
    const aiX = reactive({ chat: [] });
    let renders = 0;
    effect(() => { aiX.chat.forEach((c) => { void c.a; void c.r; }); renders++; });
    const before = { q: 'why', a: '', r: '' };
    aiX.chat.push(before);
    const base = renders;
    mutate(before, aiX.chat[aiX.chat.length - 1]);
    return renders - base;
  };
  it('改 push 之前的原始引用不会触发重渲染（这就是旧代码的写法）', () => {
    expect(run((raw) => { raw.a = 'chunk1'; raw.a = 'chunk1chunk2'; })).toBe(0);
  });
  it('改 push 之后的代理才会逐块触发', () => {
    expect(run((raw, live) => { live.a = 'chunk1'; live.a = 'chunk1chunk2'; })).toBe(2);
  });
});

describe('practice.js 必须取代理来改', () => {
  const src = read('js/views/practice.js');
  it('push 之后立刻按下标取回代理', () => {
    expect(src).toContain('const entry=this.aiX.chat[this.aiX.chat.length-1];');
  });
  it('不再 push 一个之后还要改的局部变量', () => {
    expect(src).not.toMatch(/const entry=\{[^}]*\};\s*this\.aiX\.chat\.push\(entry\)/);
  });
  it('追问的回调不再丢掉 reasoning', () => {
    expect(src).toContain("if(d.reasoning)entry.r=(entry.r||'')+d.reasoning;");
  });
  it('reset 同时清空正文和思维链', () => {
    expect(src).toContain("if(d.reset){ entry.a=''; entry.r=''; }");
  });
  it('追问也上报降级 / 截断，和主解析一致', () => {
    expect(src).toContain('d.streamFallback');
    expect(src).toContain("d.finish_reason==='length'");
  });
});

describe('贴底跟随：用户一接管就撒手', () => {
  let self;
  beforeEach(() => {
    self = { stickBottom: true, $nextTick: (f) => f() };
    for (const k of Object.keys(QC.methods)) self[k] = QC.methods[k].bind(self);
    global.document = { documentElement: { scrollHeight: 2000 } };
    global.window = { scrollY: 0, innerHeight: 800, scrollTo: vi.fn() };
  });

  it('滚轮向上 → 停止贴底', () => {
    self._onUserScroll({ type: 'wheel', deltaY: -120 });
    expect(self.stickBottom).toBe(false);
  });
  it('滚轮向下 → 保持贴底（用户只是想看得更快）', () => {
    self._onUserScroll({ type: 'wheel', deltaY: 120 });
    expect(self.stickBottom).toBe(true);
  });
  it('PageUp / ArrowUp / Home 都算接管', () => {
    for (const key of ['PageUp', 'ArrowUp', 'Home']) {
      self.stickBottom = true;
      self._onUserScroll({ type: 'keydown', key });
      expect(self.stickBottom).toBe(false);
    }
  });
  it('向下的按键不算接管', () => {
    self._onUserScroll({ type: 'keydown', key: 'ArrowDown' });
    expect(self.stickBottom).toBe(true);
  });
  it('触摸拖动方向拿不准，一律当成用户接管', () => {
    self._onUserScroll({ type: 'touchmove' });
    expect(self.stickBottom).toBe(false);
  });

  it('撒手之后不再自动滚动', () => {
    self.stickBottom = false;
    self._chatScroll();
    expect(globalThis.window.scrollTo).not.toHaveBeenCalled();
  });
  it('贴底状态下照常自动滚动', () => {
    self._chatScroll();
    expect(globalThis.window.scrollTo).toHaveBeenCalled();
  });
  it('force=true 时无视撒手（用于「回到底部」按钮）', () => {
    self.stickBottom = false;
    self._chatScroll(true);
    expect(globalThis.window.scrollTo).toHaveBeenCalled();
  });

  it('用户自己滑回底部 → 重新贴底', () => {
    self.stickBottom = false;
    globalThis.window.scrollY = 1200;   // 1200 + 800 = 2000，正好到底
    self._onScroll();
    expect(self.stickBottom).toBe(true);
  });
  it('还在半路时不重新贴底', () => {
    self.stickBottom = false;
    globalThis.window.scrollY = 300;
    self._onScroll();
    expect(self.stickBottom).toBe(false);
  });
  it('阈值内（90px）算到底，不必像素级精确', () => {
    expect(self._nearBottom()).toBe(false);
    globalThis.window.scrollY = 1150;   // 距底 50px
    expect(self._nearBottom()).toBe(true);
  });
  it('backToBottom 复位并滚动', () => {
    self.stickBottom = false;
    self.backToBottom();
    expect(self.stickBottom).toBe(true);
    expect(globalThis.window.scrollTo).toHaveBeenCalled();
  });
});

describe('新一轮生成 / 切题要复位', () => {
  const src = read('js/components/question-card.js');
  it('开始追问时恢复贴底', () => {
    expect(src).toContain('aiAsking(v){ if(v)this.stickBottom=true; }');
  });
  it('开始生成解析时恢复贴底', () => {
    expect(src).toMatch(/aiBusy\(v\)\{ if\(v\)\{[^}]*this\.stickBottom=true;/);
  });
  it('切题时复位贴底并清空每轮折叠状态', () => {
    expect(src).toContain('this.stickBottom=true; this.chatReasonOpen={};');
  });
});

describe('模板', () => {
  const tpl = QC.template;
  it('每轮追问渲染可折叠的推理过程', () => {
    expect(tpl).toContain('chat-reason');
    expect(tpl).toContain('推理过程');
    expect(tpl).toContain('chatReasonOpen[i]');
  });
  it('撒手且仍在生成时给「回到底部」入口', () => {
    expect(tpl).toContain('(aiBusy||aiAsking) && !stickBottom');
    expect(tpl).toContain('回到底部');
  });
});
