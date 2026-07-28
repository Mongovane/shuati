// schema.sql 完整性守卫：
// 后端会用 ALTER TABLE ADD COLUMN 给老库补列、用 CREATE TABLE 兜底建表。
// 新库是直接跑 schema.sql 建的——若 schema.sql 漏了这些表/列，新库就会缺东西。
// 本测试保证两者始终同步（历史上 subjects 表与 4 个列曾漏同步）。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const schema = fs.readFileSync(path.join(ROOT, 'schema.sql'), 'utf8');

// 读取 functions/ 下所有后端源码
function backendSources() {
  const dir = path.join(ROOT, 'functions/api');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
}
const backend = backendSources();

// 去掉 SQL 注释行后的 schema，避免"列名只出现在注释里"造成误判
const schemaNoComments = schema.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

// 取出 schema.sql 里某张表的 CREATE TABLE 正文
function tableBody(name) {
  const m = schemaNoComments.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${name}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'));
  return m ? m[1] : '';
}

describe('schema.sql 与后端迁移保持同步', () => {
  it('后端 ALTER TABLE 补的列，schema.sql 的建表语句里都要有', () => {
    const re = /ALTER TABLE\s+(\w+)\s+ADD COLUMN\s+(\w+)/gi;
    const missing = [];
    let m;
    while ((m = re.exec(backend)) !== null) {
      const [, table, col] = m;
      const body = tableBody(table);
      // 列定义形如：  col_name  TYPE ...
      if (!new RegExp(`^\\s*${col}\\s+\\w+`, 'mi').test(body)) missing.push(`${table}.${col}`);
    }
    expect(missing, `schema.sql 缺少这些列（新库会缺字段）: ${missing.join(', ')}`).toEqual([]);
  });

  it('后端 CREATE TABLE 的表，schema.sql 里都要有', () => {
    const re = /CREATE TABLE IF NOT EXISTS\s+(\w+)/gi;
    const inBackend = new Set();
    let m;
    while ((m = re.exec(backend)) !== null) inBackend.add(m[1]);
    const inSchema = new Set([...schema.matchAll(/CREATE TABLE IF NOT EXISTS\s+(\w+)/gi)].map((x) => x[1]));
    const missing = [...inBackend].filter((t) => !inSchema.has(t));
    expect(missing, `schema.sql 缺少这些表: ${missing.join(', ')}`).toEqual([]);
  });

  it('关键列存在性抽查（回归历史缺失项）', () => {
    expect(tableBody('questions')).toMatch(/^\s*status\s+TEXT/mi);
    expect(tableBody('questions')).toMatch(/^\s*ai_cards\s+TEXT/mi);
    expect(tableBody('answer_log')).toMatch(/^\s*duration_ms\s+INTEGER/mi);
    expect(tableBody('mock_results')).toMatch(/^\s*score\s+REAL/mi);
    expect(tableBody('subjects')).toMatch(/^\s*code\s+TEXT/mi);
  });
});
