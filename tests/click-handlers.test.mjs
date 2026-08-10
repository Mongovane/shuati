// 按钮的两类系统性坑：
//  1) 模板 @click / :disabled / v-if 引用了不存在的方法或字段 —— 死按钮，运行时才炸且常被吞掉
//  2) async 点击处理器有 await 却没有 catch —— 异常变成 unhandled rejection，
//     界面一个字都不说，用户看到的就是「点了没反应」（localExtractPage 就是这么坑了一整轮）
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const MIX = ['js/api.js', 'js/app.js', 'js/components/reader.js', 'js/components/rich-text.js',
  'js/components/question-card.js', 'js/views/practice.js', 'js/views/bank.js', 'js/views/mock-stats.js',
  'js/views/ingest.js', 'js/views/mineru.js', 'js/views/books.js', 'js/views/pdftool.js',
  'js/views/saved.js', 'js/views/settings.js'];
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const src = Object.fromEntries(MIX.map((f) => [f, read(f)]));
const tplFiles = fs.readdirSync(path.join(ROOT, 'js/tpl')).map((f) => 'js/tpl/' + f);

const GLOBALS = new Set(['true', 'false', 'null', 'undefined', 'this', '$event', '$refs', 'Math', 'JSON', 'Object',
  'Array', 'String', 'Number', 'Boolean', 'window', 'document', 'console', 'parseInt', 'parseFloat', 'isNaN',
  'encodeURIComponent', 'Date', 'Set', 'Map', 'Promise', 'localStorage', 'navigator', 'location', 'alert',
  'confirm', 'prompt', 'setTimeout', 'URL', 'Blob', 'FormData', 'fetch', 'atob', 'new', 'typeof', 'in', 'of',
  'instanceof', 'void', 'delete', 'return', 'if', 'else']);

function collectDefined() {
  const d = new Set();
  for (const s of Object.values(src)) {
    for (const m of s.matchAll(/(?:^|[{,])\s*(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm)) d.add(m[1]);
    for (const m of s.matchAll(/(?:^|[{,])\s*([A-Za-z_$][\w$]*)\s*:/gm)) d.add(m[1]);
  }
  const app = src['js/app.js'];
  const dataBlk = app.slice(app.indexOf('data()'), app.indexOf('\n  computed:'));
  for (const m of dataBlk.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*:/g)) d.add(m[1]);
  const compBlk = app.slice(app.indexOf('\n  computed:'), app.indexOf('\n  watch:'));
  for (const m of compBlk.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*[(:]/g)) d.add(m[1]);
  return d;
}

describe('模板里没有死引用', () => {
  const defined = collectDefined();

  it('@click / :disabled / v-if / {{ }} 引用的标识符都能在 mixin 或 data/computed 里找到', () => {
    const bad = [];
    for (const f of tplFiles) {
      const s = read(f);
      const loc = new Set();
      for (const m of s.matchAll(/v-for\s*=\s*"\s*\(?\s*([A-Za-z_$][\w$]*)(?:\s*,\s*([A-Za-z_$][\w$]*))?(?:\s*,\s*([A-Za-z_$][\w$]*))?/g)) {
        for (const g of m.slice(1)) if (g) loc.add(g);
      }
      for (const m of s.matchAll(/(@[\w.]+|:[\w-]+|v-if|v-else-if|v-show|v-model)\s*=\s*"([^"]*)"|(\{\{)([^}]*)\}\}/g)) {
        const attr = m[1] || m[3] || '';
        let expr = m[2] !== undefined ? m[2] : (m[4] || '');
        expr = expr.replace(/'[^']*'/g, '""');
        // :style / :class 的对象键是 CSS 属性名 / 类名，不是组件引用
        if (attr === ':style' || attr === ':class') expr = expr.replace(/(?<![.\w$])[A-Za-z_$][\w$-]*\s*:/g, ':');
        for (const t of expr.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\b/g)) {
          if (!GLOBALS.has(t[1]) && !defined.has(t[1]) && !loc.has(t[1])) bad.push(path.basename(f) + ' ' + attr + ' → ' + t[1]);
        }
      }
    }
    expect([...new Set(bad)]).toEqual([]);
  });
});

describe('async 点击处理器必须处理异常', () => {
  // 这些方法自己不 catch，而是把错误交给它 await 的下游处理（下游内部有 try/catch）。
  // 放进白名单是显式决定，不是遗漏；下游若哪天去掉 catch，这里也应当同步复核。
  const DELEGATES = {
    pickBookSubject: '_setBookSubjectPages 内部已 try/catch',
    subjMove: 'subjReorder 内部已 try/catch',
    mineruConvert: '无 await，纯同步分发',
  };

  // 位置断言必须在「剥掉注释」的代码上做：注释里出现 finally / catch 这类词会让下标失真
  // （我自己那句「只有 try/finally 的话…」的注释就把这条测试搞红过一次）
  const stripComments = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  function bodyOf(s, name) {
    const m = new RegExp('(?:^|[{,])\\s*async\\s+' + name + '\\s*\\(', 'm').exec(s);
    if (!m) return null;
    const i = s.indexOf('{', m.index + m[0].length - 1);
    let d = 0;
    for (let j = i; j < s.length; j++) {
      if (s[j] === '{') d++;
      else if (s[j] === '}' && --d === 0) return s.slice(i, j + 1);
    }
    return s.slice(i);
  }

  const clicked = new Set();
  for (const f of tplFiles) {
    for (const m of read(f).matchAll(/@click(?:\.\w+)*\s*=\s*"([^"]+)"/g)) {
      const e = m[1];
      for (const t of e.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) clicked.add(t[1]);
      const bare = /^\s*([A-Za-z_$][\w$]*)\s*$/.exec(e);
      if (bare) clicked.add(bare[1]);
    }
  }

  it('扫到的点击处理器数量合理（防止正则失效后这组测试空跑）', () => {
    expect(clicked.size).toBeGreaterThan(60);
  });

  it('每个「有 await 的 async 点击处理器」都有 catch，或在白名单里说明委托给谁', () => {
    const missing = [];
    for (const name of clicked) {
      for (const [f, s] of Object.entries(src)) {
        const b = bodyOf(s, name);
        if (b == null) continue;
        const awaits = (b.match(/await /g) || []).length;
        if (awaits > 0 && !b.includes('catch') && !DELEGATES[name]) missing.push(name + ' (' + path.basename(f) + ')');
        break;
      }
    }
    expect(missing).toEqual([]);
  });

  it('抽题两个入口有 catch —— 只有 try/finally 时异常会被静默吞掉', () => {
    const ing = src['js/views/ingest.js'];
    for (const n of ['localExtractPage', 'localExtractBook']) {
      const b = bodyOf(ing, n);
      expect(b).toBeTruthy();
      expect(b).toMatch(/catch\(e\)\{/);
      expect(b).toMatch(/finally/);
      // catch 必须在 finally 之前，否则语法上根本不成立
      const code = stripComments(b);
      expect(code.indexOf('catch(e)')).toBeLessThan(code.indexOf('finally'));
    }
  });

  it('resumeMock 兜住快照恢复失败，不留「半启动」的模考', () => {
    const b = bodyOf(src['js/views/mock-stats.js'], 'resumeMock');
    expect(b).toMatch(/restoreState/);
    expect(b).toMatch(/catch\(e\)\{[^}]*恢复失败/);
    // 计时器必须在 catch 之后仍然启动，否则模考卡在已开始但不走表
    const code = stripComments(b);
    expect(code.indexOf('catch(e)')).toBeLessThan(code.indexOf('_mockStartTimer'));
  });

  it('白名单里的方法，其下游确实有 catch（白名单不能变成免检通道）', () => {
    expect(bodyOf(src['js/views/settings.js'], 'subjReorder')).toMatch(/catch/);
    expect(bodyOf(src['js/views/books.js'], '_setBookSubjectPages')).toMatch(/catch/);
  });
});

describe('组件 $emit 必须在「每一个」使用点都有监听（不能只在其中一处绑）', () => {
  const cardSrc = read('js/components/question-card.js');
  const emits = [...new Set([...cardSrc.matchAll(/\$emit\(\s*'([^']+)'/g)].map((m) => m[1]))];

  // 抓 <question-card ...> 的开标签（可能跨行）
  const openTag = (tpl) => {
    const i = tpl.indexOf('<question-card');
    if (i < 0) return null;
    return tpl.slice(i, tpl.indexOf('>', i) + 1);
  };
  const bound = (tag, ev) => {
    const camel = ev.replace(/-(\w)/g, (_, c) => c.toUpperCase());
    return new RegExp('@(?:' + ev + '|' + camel + ')\\s*=').test(tag);
  };
  // 这些事件只在刷题页有意义；模考里对应按钮已用 v-if 隐藏或由 prop 关掉，故不要求绑定。
  // 每一项都要写清「为什么不需要」——否则这里会退化成免检清单。
  const AI_PROP_GATED = 'AI 解析区整块由 aiText / aiKind / hasConcept / aiBusy 这些 prop 控制显示，模考页不传这些 prop，按钮不会渲染出来';
  const EXEMPT_IN_EXAM = {
    'ai-ask': AI_PROP_GATED,
    'ai-concept': AI_PROP_GATED,
    'ai-concept-redo': AI_PROP_GATED,
    'ai-explain': AI_PROP_GATED,
    'ai-explain-redo': AI_PROP_GATED,
    'ai-note': AI_PROP_GATED,
    'ai-retry': AI_PROP_GATED,
    'ai-save': AI_PROP_GATED,
    // 这两个按钮在追问气泡里，外层 <template v-if="(aiText || …) && !aiBusy"> 就已经关掉了，
    // 而且它们自己还各带 v-if="aiAsking …" / v-if="aiChat.length …"。模考页 aiText/aiChat 都不传，
    // 三层条件没有一层成立，按钮渲染不出来 —— 绑上去只是永远不会触发的死代码。
    'ai-stop': AI_PROP_GATED,
    'ai-clear-chat': AI_PROP_GATED,
    'seg-mode': '选段悬浮条的 v-if 依赖 aiText，模考页拿不到 aiText 所以不渲染',
    'card-flip': '知识点卡片列表依赖 aiCards prop，模考页不传，卡片区不渲染',
    'cards-flip-all': '同上：整体翻转按钮和知识点卡片区一起不渲染',
    next: '模考把所有题列在同一页，「下一题」没有意义，已用 v-if="mode!==\'exam\'" 隐藏',
  };

  it('emit 列表非空（正则失效时不空跑）', () => {
    expect(emits.length).toBeGreaterThan(10);
  });

  it('刷题页绑了全部 emit', () => {
    const tag = openTag(read('js/tpl/view-practice.js'));
    expect(tag).toBeTruthy();
    expect(emits.filter((e) => !bound(tag, e))).toEqual([]);
  });

  it('模考页绑了「会渲染出来的」那些 emit —— 否则是可见但点了没反应的死按钮', () => {
    const tag = openTag(read('js/tpl/view-mock.js'));
    expect(tag).toBeTruthy();
    const missing = emits.filter((e) => !bound(tag, e) && !EXEMPT_IN_EXAM[e]);
    expect(missing).toEqual([]);
  });

  it('收藏 / 掌握 / 笔记 这三个必须在模考页也绑上（它们的实现只有 $emit，没有本地兜底）', () => {
    const tag = openTag(read('js/tpl/view-mock.js'));
    for (const e of ['favorite', 'master', 'note']) expect(bound(tag, e)).toBe(true);
    // 确认这三个方法确实只 emit、不改本地状态 —— 所以没监听就等于完全无效
    for (const [fn, ev] of [['toggleFav', 'favorite'], ['markMastered', 'master'], ['saveNote', 'note']]) {
      const m = new RegExp('(?:^|[{,])\\s*' + fn + '\\s*\\(\\)\\{([^}]*)\\}', 'm').exec(cardSrc);
      expect(m, fn + ' 未找到').toBeTruthy();
      expect(m[1]).toContain("$emit('" + ev + "'");
    }
  });

  it('豁免清单里的每一项都必须有说明文字，不能是空占位', () => {
    for (const [k, why] of Object.entries(EXEMPT_IN_EXAM)) {
      expect(typeof why === 'string' && why.length > 4, k + ' 缺说明').toBe(true);
    }
  });

  it('「下一题」在模考里确实被 v-if 隐藏了（豁免的前提）', () => {
    expect(cardSrc).toMatch(/v-if="mode!=='exam'"[^>]*@click="\$emit\('next'\)"/);
  });
});
