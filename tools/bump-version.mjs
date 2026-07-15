#!/usr/bin/env node
// 缓存版本号统一升级（根治「?v= 十几处手工同步、漏一处缓存错乱」）：
//   · index.html 里的全部 ?v=N（样式 + 脚本引用）
//   · sw.js 的 const VERSION = 'vN' 与 CORE 预缓存清单里的 ?v=N
//   · js/constants.js 的 APP_VERSION（界面显示 / 排查缓存用）
// 用法：
//   node tools/bump-version.mjs        自动 +1（读 index.html 现有 ?v=N）
//   node tools/bump-version.mjs 47     指定版本（可带可不带 v 前缀）
//   npm run bump [-- 47]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const write = (p, s) => fs.writeFileSync(path.join(ROOT, p), s);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const idx = read('index.html');
const m = idx.match(/\?v=([A-Za-z0-9._-]+)/);
if (!m) { console.error('✗ index.html 里找不到 ?v= 版本号'); process.exit(1); }
const cur = m[1];

let next = (process.argv[2] || '').trim().replace(/^v/i, '');
if (!next) {
  const n = parseInt(cur, 10);
  if (!Number.isFinite(n)) { console.error(`✗ 现有版本「${cur}」不是数字，无法自动 +1，请显式传入新版本号`); process.exit(1); }
  next = String(n + 1);
}
if (next === cur) { console.error(`✗ 新版本与现有版本相同（${cur}），未做任何修改`); process.exit(1); }

const jobs = [
  ['index.html',      (s) => s.split(`?v=${cur}`).join(`?v=${next}`)],
  ['sw.js',           (s) => s.split(`?v=${cur}`).join(`?v=${next}`).replace(/const VERSION = '[^']*'/, `const VERSION = 'v${next}'`)],
  ['js/constants.js', (s) => s.replace(/const APP_VERSION='[^']*'/, `const APP_VERSION='v${next}'`)],
];

console.log(`版本号 ${cur} → ${next}`);
for (const [p, fn] of jobs) {
  const before = read(p);
  const after = fn(before);
  if (before === after && p !== 'js/constants.js') { console.error(`✗ ${p} 没有任何改动，请检查`); process.exit(1); }
  const hits = (before.match(new RegExp(esc(`?v=${cur}`), 'g')) || []).length;
  write(p, after);
  const extra = p === 'sw.js' ? '（另含 VERSION 常量）' : p === 'js/constants.js' ? '（APP_VERSION 常量）' : '';
  console.log(`  ${p}: ${hits} 处 ?v= ${extra}`);
}

// 自检：不应再残留旧版本引用
let leftover = 0;
for (const p of ['index.html', 'sw.js']) leftover += (read(p).match(new RegExp(esc(`?v=${cur}`), 'g')) || []).length;
if (read('sw.js').includes(`VERSION = 'v${cur}'`)) leftover++;
if (read('js/constants.js').includes(`APP_VERSION='v${cur}'`)) leftover++;
if (leftover) { console.error(`✗ 仍有 ${leftover} 处旧版本残留，请手工检查`); process.exit(1); }
console.log('✓ 完成，无旧版本残留');
