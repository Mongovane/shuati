// 模板编译门禁：用 Vue 官方编译器真编译 APP_TEMPLATE 与题卡模板。
// 手写超长模板最怕标签没闭合 / 指令拼错 / 表达式语法错——这里直接红灯，而不是等到浏览器白屏。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { compile } from '@vue/compiler-dom';
import { ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function loadTemplates() {
  // 按 index.html 的真实加载顺序拼前端脚本（constants → 组件桩 → 题卡 → 模板分片 → app-template）
  let src = read('js/constants.js') + '\nconst RichText={template:"<div/>"};\n' + read('js/components/question-card.js') + '\n';
  const tplDir = path.join(ROOT, 'js/tpl');
  if (fs.existsSync(tplDir)) {
    for (const f of fs.readdirSync(tplDir).filter((x) => x.endsWith('.js')).sort()) src += read('js/tpl/' + f) + '\n';
  }
  src += read('js/app-template.js') + '\nreturn { APP_TEMPLATE, QuestionCard };';
  return new Function(src)();
}

function compileErrors(tpl) {
  const errs = [];
  compile(tpl, { onError: (e) => errs.push(e) });
  return errs;
}

describe('Vue 模板编译', () => {
  const { APP_TEMPLATE, QuestionCard } = loadTemplates();

  it('APP_TEMPLATE 完整可编译（标签闭合 / 指令 / 表达式全过）', () => {
    expect(typeof APP_TEMPLATE).toBe('string');
    expect(APP_TEMPLATE.length).toBeGreaterThan(50000);
    const errs = compileErrors(APP_TEMPLATE);
    expect(errs.map((e) => e.message + ' @' + JSON.stringify(e.loc && e.loc.start)), '模板编译错误').toEqual([]);
  });

  it('QuestionCard 模板可编译', () => {
    const errs = compileErrors(QuestionCard.template);
    expect(errs.map((e) => e.message), '题卡模板编译错误').toEqual([]);
  });

  it('主模板包含各视图与新功能关键标记（拆分/改动后防丢块）', () => {
    for (const marker of [
      `view==='practice'`, `view==='mock'`, `view==='bank'`, `view==='ingest'`, `view==='stats'`, `view==='settings'`,
      'bp-row', 'ms-chip', 'dur-grid', 'seg-badge', 'print-area', 'dup-group', 'st-chip', `ingest.tab==='excel'`, 'fab-top',
      'settFold.token', 'settFold.prefs', 'ai-concept', 'ai-concept-redo', 'ai-explain-redo', 'skel-wrap',
    ]) {
      expect(APP_TEMPLATE.includes(marker), '缺少标记: ' + marker).toBe(true);
    }
  });

  it('已下线的鸡肋功能不应残留在模板中（Scribe/tesseract 引擎、拍照/Markdown 独立 tab、PDF 本地提取）', () => {
    for (const gone of [
      `value="scribe"`, `value="tesseract"`,
      `ingest.tab==='photo'`, `ingest.tab==='md'`,
      'pdfExtractText', 'ingest.pdf.extracted',
    ]) {
      expect(APP_TEMPLATE.includes(gone), '不该再出现: ' + gone).toBe(false);
    }
  });
});

describe('模板属性名合法性（防手误）', () => {
  it('不出现引号残留的畸形属性，如 v-else" / v-if"', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { ROOT } = await import('./helpers.mjs');
    const dir = path.join(ROOT, 'js/tpl');
    const bad = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
      const src = fs.readFileSync(path.join(dir, f), 'utf8');
      // 形如 <template v-else">、<div v-if"> —— 指令名后紧跟引号再跟 >
      for (const m of src.matchAll(/<[a-zA-Z-]+[^>]*?\s(v-[a-z-]+)"(?=[\s>])/g)) bad.push(`${f}: ${m[1]}"`);
    }
    expect(bad, `发现畸形属性（指令会失效）: ${bad.join(', ')}`).toEqual([]);
  });
});

// —— 编译只能抓语法错，抓不到「渲染时才炸」的裸标识符 ——
// 机制：浏览器里的运行时编译器用 with(this) 模式（不加 _ctx. 前缀），而 Vue 实例代理的 has 陷阱
// 会**显式屏蔽 _ / $ 前缀的键**（留给内部用），于是 with 落空到全局作用域 → ReferenceError，
// 整棵渲染树炸掉、整个视图白屏。v181 的 @touchstart="_bookTouchStart" 就是这么把 Books 页搞白的。
// 编译期完全合法，所以 compile() 抓不到 —— 只能当成一条 lint 规则来守。
describe('模板不许引用 _ / $ 前缀标识符（渲染期会 ReferenceError）', () => {
  const BINDING = /(@[\w.]+|:[\w-]+|v-if|v-else-if|v-show|v-model|v-for)\s*=\s*"([^"]*)"|\{\{([^}]*)\}\}/g;
  // Vue 自己提供的、模板里可以合法使用的 $ 开头的东西
  const ALLOWED = new Set(['$event', '$refs', '$nextTick', '$el', '$emit', '$attrs', '$slots', '$props', '$parent', '$root', '$options', '$forceUpdate', '$watch']);

  function scan(fileName, src) {
    const bad = [];
    for (const m of src.matchAll(BINDING)) {
      const attr = m[1] || '{{';
      let expr = m[3] !== undefined ? m[3] : (m[2] || '');
      expr = expr.replace(/'[^']*'/g, '""');                       // 去掉字符串字面量（题干里的 ____ 会误报）
      for (const t of expr.matchAll(/(?<![.\w$])([_$][A-Za-z0-9_$]*)/g)) {
        if (ALLOWED.has(t[1])) continue;
        if (/^_+$/.test(t[1])) continue;                            // 纯下划线是填空占位文本，不是标识符
        bad.push(fileName + ' ' + attr + ' → ' + t[1]);
      }
    }
    return bad;
  }

  it('js/tpl/*.js 全部干净', () => {
    const bad = [];
    for (const f of fs.readdirSync(path.join(ROOT, 'js/tpl')).filter((x) => x.endsWith('.js'))) {
      bad.push(...scan(f, read('js/tpl/' + f)));
    }
    expect(bad).toEqual([]);
  });

  it('题卡模板同样干净', () => {
    expect(scan('question-card.js', read('js/components/question-card.js'))).toEqual([]);
  });

  it('规则确实能抓住 v181 那个写法（自检）', () => {
    expect(scan('t', '<div @touchstart.passive="_bookTouchStart">x</div>')).toEqual(['t @touchstart.passive → _bookTouchStart']);
    expect(scan('t', '<div @touchend="onBookTouchEnd">x</div>')).toEqual([]);
    expect(scan('t', '<b :title="_syncTabStrip()">x</b>').length).toBe(1);
  });

  it('$event / $refs 这类合法用法不误报', () => {
    expect(scan('t', '<i @seg-mode="segActive=$event" />')).toEqual([]);
    expect(scan('t', '<i @click="$refs.f.click()" />')).toEqual([]);
    expect(scan('t', '<i @click="$emit(\'next\')" />')).toEqual([]);
  });

  it('填空题里的 ____ 不误报', () => {
    expect(scan('t', '{{ "____" }}')).toEqual([]);
  });
});
