#!/usr/bin/env node
// 给 index.html 里的 cdnjs 静态资源补 SRI（integrity + crossorigin="anonymous"）。
// 用途：CDN 被劫持/投毒时，浏览器校验哈希不匹配会直接拒绝执行，防被注入恶意脚本。
//
// 用法（本机联网环境，Node ≥ 18）：
//   node tools/gen-sri.mjs
// 会抓取每个 cdnjs 资源、计算 sha384、写回 index.html（已有 integrity 的会刷新）。
// 升级任何 CDN 库版本后需要重跑一次，否则哈希不匹配页面会拒绝加载该资源。
//
// 注意：pdf.js（教材阅读）与 SheetJS/xlsx（Excel 导入）是运行时按需 <script> 动态注入的，
// 不在 index.html 里、挂不了 SRI；脚本结尾会打印它们当前的哈希，供你备查 / 钉版本。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const idxPath = path.join(ROOT, 'index.html');
let html = fs.readFileSync(idxPath, 'utf8');

const urls = [...new Set([...html.matchAll(/https:\/\/cdnjs\.cloudflare\.com\/[^"']+/g)].map((m) => m[0]))];
if (!urls.length) { console.log('index.html 里没有 cdnjs 资源，无需处理'); process.exit(0); }

// 运行时动态加载、无法挂 SRI 的库（打印哈希备查）
const dynamicOnly = [
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js',
];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function sri(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return 'sha384-' + crypto.createHash('sha384').update(buf).digest('base64');
}

console.log(`共 ${urls.length} 个 cdnjs 资源，抓取并计算 sha384 …\n`);
let patched = 0;
for (const url of urls) {
  const hash = await sri(url);
  const re = new RegExp(`(<(?:script|link)\\b[^>]*?${esc(url)}[^>]*?)(\\s*/?>)`, 'g');
  const before = html;
  html = html.replace(re, (_m, head, tail) => {
    const clean = head
      .replace(/\s+integrity="[^"]*"/g, '')
      .replace(/\s+crossorigin(?:="[^"]*")?/g, '');
    return `${clean} integrity="${hash}" crossorigin="anonymous"${tail}`;
  });
  const ok = html !== before || html.includes(hash);
  console.log(`  ${ok ? '✓' : '✗ 未匹配到标签'} ${url}\n      ${hash}`);
  if (ok) patched++;
}
fs.writeFileSync(idxPath, html);
console.log(`\n✓ 已写回 index.html（${patched}/${urls.length}）。`);

console.log('\n以下动态加载库无法挂 SRI，打印当前哈希备查：');
for (const u of dynamicOnly) {
  try { console.log(`   ${u}\n      ${await sri(u)}`); }
  catch (e) { console.log(`   ${u}  抓取失败：${e.message}`); }
}
console.log('\n提交前请本地打开页面确认资源正常加载（SRI 不匹配会被浏览器拒绝执行）。');
