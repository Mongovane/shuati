// 语法门禁：
//  · functions/api/*.js 全部能被 import（后端是 ES 模块，import 失败=语法/依赖问题）
//  · 非 _ 开头的路由文件必须导出至少一个 onRequest* 处理器
//  · 前端脚本 + sw.js 用 new Function 做纯解析检查（不执行）
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT } from './helpers.mjs';

describe('后端模块', () => {
  it('functions/api/*.js 全部可 import，路由文件导出 onRequest*', async () => {
    const dir = path.join(ROOT, 'functions/api');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort();
    expect(files.length).toBeGreaterThan(8);
    for (const f of files) {
      const mod = await import(pathToFileURL(path.join(dir, f)).href);
      if (!f.startsWith('_')) {
        const handlers = Object.keys(mod).filter((k) => /^onRequest/.test(k));
        expect(handlers.length, `${f} 应导出至少一个 onRequest* 处理器`).toBeGreaterThan(0);
      }
    }
  });
});

describe('前端脚本', () => {
  it('js/**/*.js 与 sw.js 语法全部可解析', () => {
    const list = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.js')) list.push(p);
      }
    };
    walk(path.join(ROOT, 'js'));
    list.push(path.join(ROOT, 'sw.js'));
    expect(list.length).toBeGreaterThan(10);
    for (const p of list) {
      const src = fs.readFileSync(p, 'utf8');
      expect(() => new Function(src), path.relative(ROOT, p)).not.toThrow();
    }
  });
});
