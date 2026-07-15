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
      'bp-row', 'ms-chip', 'dur-grid', 'seg-badge', 'print-area', 'dup-group', 'st-chip', `ingest.tab==='excel'`,
    ]) {
      expect(APP_TEMPLATE.includes(marker), '缺少标记: ' + marker).toBe(true);
    }
  });
});
