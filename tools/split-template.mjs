#!/usr/bin/env node
// 把 900+ 行的单体 js/app-template.js 按视图拆成 js/tpl/*.js 分片（一次性工具，可重复安全执行）。
// 安全机制：拆完立刻把分片装配回来与原文逐字节比对，不一致就恢复原文件并退出非零。
// 拆分后：改哪个视图就编辑哪个分片；js/app-template.js 只负责按 DOM 顺序 join。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MONO = path.join(ROOT, 'js/app-template.js');
const TPL_DIR = path.join(ROOT, 'js/tpl');

const src = fs.readFileSync(MONO, 'utf8');
if (src.includes('TPL_SHELL_OPEN')) { console.log('已是装配模式（js/tpl/ 分片存在），无需重复拆分'); process.exit(0); }

const a = src.indexOf('`');
const b = src.lastIndexOf('`');
if (a < 0 || b <= a) { console.error('✗ 找不到模板字符串边界'); process.exit(1); }
const body = src.slice(a + 1, b);
if (body.includes('`') || body.includes('${')) { console.error('✗ 模板内含反引号或 ${，需先处理转义再拆分'); process.exit(1); }
// 原模板的「求值结果」——分片切的是转义形态的源码，装配后求值必须与它一致
const originalValue = new Function(src + '\nreturn APP_TEMPLATE;')();

// 切点：各视图 section 的开标签（顺序即 DOM 顺序）
const CUTS = [
  ['TPL_VIEW_PRACTICE', `\n    <div v-if="['practice','wrong','favorite'].includes(view)">`],
  ['TPL_VIEW_BOOKS',    `\n    <div v-else-if="view==='books'">`],
  ['TPL_VIEW_MOCK',     `\n    <div v-else-if="view==='mock'">`],
  ['TPL_VIEW_BANK',     `\n    <div v-else-if="view==='bank'">`],
  ['TPL_VIEW_STATS',    `\n    <div v-else-if="view==='stats'">`],
  ['TPL_VIEW_INGEST',   `\n    <div v-else-if="view==='ingest'">`],
  ['TPL_VIEW_SETTINGS', `\n    <div v-else-if="view==='settings'">`],
  ['TPL_SHELL_CLOSE',   `\n  <div v-if="reader.open`],
];
let pos = 0;
const parts = [['TPL_SHELL_OPEN', null]];
for (const [name, marker] of CUTS) {
  const i = body.indexOf(marker, pos);
  if (i < 0) { console.error('✗ 切点未找到：', name); process.exit(1); }
  if (i < pos) { console.error('✗ 切点乱序：', name); process.exit(1); }
  parts.push([name, i]);
  pos = i + 1;
}
// 计算每段范围
const files = [];
for (let k = 0; k < parts.length; k++) {
  const [name] = parts[k];
  const start = k === 0 ? 0 : parts[k][1];
  const end = k + 1 < parts.length ? parts[k + 1][1] : body.length;
  files.push([name, body.slice(start, end)]);
}

const FNAME = {
  TPL_SHELL_OPEN: 'shell-open.js',    TPL_VIEW_PRACTICE: 'view-practice.js',
  TPL_VIEW_BOOKS: 'view-books.js',    TPL_VIEW_MOCK: 'view-mock.js',
  TPL_VIEW_BANK: 'view-bank.js',      TPL_VIEW_STATS: 'view-stats.js',
  TPL_VIEW_INGEST: 'view-ingest.js',  TPL_VIEW_SETTINGS: 'view-settings.js',
  TPL_SHELL_CLOSE: 'shell-close.js',
};

fs.mkdirSync(TPL_DIR, { recursive: true });
for (const [name, chunk] of files) {
  const head = `// 模板分片「${name}」——由 tools/split-template.mjs 从单体 app-template.js 拆出。\n` +
               `// 直接编辑本文件即可；js/app-template.js 按固定顺序装配，勿在分片间搬动结构边界。\n`;
  fs.writeFileSync(path.join(TPL_DIR, FNAME[name]), head + `const ${name} = \`` + chunk + '`;\n');
}

const assembler = `// 主应用模板：由 js/tpl/*.js 分片装配（tools/split-template.mjs 一次性拆分生成）。
// 各分片是同一棵 Vue 模板树按视图切开的连续片段，join 顺序即 DOM 顺序，不能调换、不能漏。
// index.html 与 sw.js 的预缓存清单需与分片文件保持同步（bump 脚本只管版本号，不管清单增删）。
const APP_TEMPLATE = [
  TPL_SHELL_OPEN,
  TPL_VIEW_PRACTICE,
  TPL_VIEW_BOOKS,
  TPL_VIEW_MOCK,
  TPL_VIEW_BANK,
  TPL_VIEW_STATS,
  TPL_VIEW_INGEST,
  TPL_VIEW_SETTINGS,
  TPL_SHELL_CLOSE,
].join('');
`;
fs.writeFileSync(MONO, assembler);

// —— 逐字节校验：装配结果必须与拆分前完全一致 ——
let evalSrc = '';
for (const [name] of files) evalSrc += fs.readFileSync(path.join(TPL_DIR, FNAME[name]), 'utf8') + '\n';
evalSrc += fs.readFileSync(MONO, 'utf8') + '\nreturn APP_TEMPLATE;';
const rebuilt = new Function(evalSrc)();
if (rebuilt !== originalValue) {
  fs.writeFileSync(MONO, src);   // 回滚
  console.error('✗ 装配校验失败（与原文不一致），已回滚 app-template.js；js/tpl/ 请手动清理');
  process.exit(1);
}
console.log('✓ 拆分完成并通过逐字节校验：');
for (const [name, chunk] of files) console.log(`   js/tpl/${FNAME[name]}  ${String(chunk.length).padStart(6)} 字符  (${name})`);
console.log('别忘了把 9 个分片加进 index.html 的 <script> 与 sw.js 的 CORE 预缓存清单（app-template.js 之前）。');
