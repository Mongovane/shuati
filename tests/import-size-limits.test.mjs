// 线上报错：导入 138 题时 `D1_ERROR: Serialized RPC arguments or return values are
// limited to 32MiB, but the size of this value was: 95036377 bytes`。
//
// 两层原因，两层都要修：
//  ① passage 被无限累积。上一轮我把「区外标题重置材料」的行为一并去掉了，
//     教材正文于是跨节累积；而 passage 是每道题都带一份的字段，138 份就是 95MB。
//  ② batchChunked 只按条数分块。80 条一批，每条几百 KB 就能到 90MB —— 就算 passage
//     合理，一本带整页 data URL 截图的教材照样能撞上限。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { batchChunked, rowBytes, D1_BATCH_BYTES, ROOT } from './helpers.mjs';

// —— ① 材料长度有界 ——
const M = new Function(fs.readFileSync(path.join(ROOT, 'js/views/ingest.js'), 'utf8') + ';return IngestMixin;')().methods;
const ctx = () => Object.assign(Object.create(M), { extractPreview: {}, extractSkippedToc: 0, flash() {} });

const para = (tag, n) => Array.from({ length: n }, (_, i) =>
  `早期的计算机主要用于数值计算，而现在的计算机主要用于非数值计算，包括对字符、表格和图像等具有一定结构的数据进行处理，只有分清楚数据的内在联系才能有效处理。${tag}-${i}。`
).join('\n\n');

// 教材形态：章内多个不带编号的小标题 + 章末习题
const textbook = () => {
  const pages = [];
  for (let ch = 1; ch <= 10; ch++) {
    pages.push(`# 第${ch}章 绪论\n\n## 数据结构的研究内容\n\n${para('A' + ch, 30)}`);
    pages.push(`## 基本概念和术语\n\n${para('B' + ch, 30)}\n\n## 抽象数据类型\n\n${para('C' + ch, 30)}`);
    pages.push(`# 习题\n\n1. 简述下列概念：数据、数据元素、数据项、数据对象。\n\n2. 试举一个数据结构的例子。`);
  }
  return { subject: 'computer', title: '数据结构', pages: pages.map((content_md, i) => ({ page: i + 1, content_md })) };
};

describe('教材：材料不再跨节无限累积', () => {
  const qs = M._extractWholeBook.call(ctx(), textbook());
  it('抽到题了（前提没被改坏）', () => {
    expect(qs.length).toBe(20);
  });
  it('每道题的材料都在硬上限内', () => {
    for (const q of qs) expect((q.passage || '').length).toBeLessThanOrEqual(2400);
  });
  it('整批序列化后的体积回到正常量级（原来是这里炸的）', () => {
    const kb = new TextEncoder().encode(JSON.stringify(qs)).length / 1024;
    expect(kb).toBeLessThan(200);
  });
  it('教材习题不该硬塞一份整章正文当「阅读材料」', () => {
    // 章内小标题会重置材料，习题段本身没有散文行，所以这里应当没有材料
    expect(qs.every((q) => !(q.passage || '').includes('数值计算'))).toBe(true);
  });
});

describe('英语真题：阅读材料照旧关联', () => {
  const md = `# 第一节\n\n阅读下列短文，从每题所给的四个选项中选出最佳选项。\n\n# A\n\n`
    + `If you are conducting businesses in foreign markets, it is necessary to know the customs and traditions of the locals when it comes to New Year celebrations.\n\n`
    + `# Greece\n\nPeople in Greece bake a special cake with a coin hidden inside it, and whoever finds it will be lucky.\n\n`
    + `1. What might Greeks find in the cake?\nA. A grape.\nB. A ring.\nC. A coin.\nD. A tooth.\n`;
  const qs = M.mdToQuestions.call(ctx(), md, { subject: 'english', source: 'x', page: 1 });
  it('题目挂上了短文', () => {
    expect(qs).toHaveLength(1);
    expect(qs[0].passage).toContain('coin hidden inside');
  });
  it('短文里的国家小标题仍然保留（阅读区内才追加）', () => {
    expect(qs[0].passage).toContain('Greece');
  });
});

// —— ② 批量提交按字节预算切块 ——
class FakeBatchDB {
  constructor() { this.batches = []; }
  prepare() { return { bind: () => ({ _s: 1 }) }; }
  async batch(list) { this.batches.push(list.length); return list.map(() => ({})); }
}
const stmts = (n) => Array.from({ length: n }, (_, i) => ({ _s: i }));

describe('batchChunked：条数与字节双重上限', () => {
  it('没有 weights 时保持原行为，只按条数切', async () => {
    const db = new FakeBatchDB();
    await batchChunked({ DB: db }, stmts(170), 80);
    expect(db.batches).toEqual([80, 80, 10]);
  });
  it('空数组直接返回，不发空 batch', async () => {
    const db = new FakeBatchDB();
    await batchChunked({ DB: db }, [], 80);
    expect(db.batches).toEqual([]);
  });
  it('体积超预算时提前切块', async () => {
    const db = new FakeBatchDB();
    const n = 10;
    const per = D1_BATCH_BYTES / 4;              // 每 4 条就到预算
    await batchChunked({ DB: db }, stmts(n), 80, Array(n).fill(per));
    expect(db.batches).toEqual([4, 4, 2]);
  });
  it('单条就超预算 → 独自成批，不连累同批其它题', async () => {
    const db = new FakeBatchDB();
    const w = [10, D1_BATCH_BYTES * 3, 10];
    await batchChunked({ DB: db }, stmts(3), 80, w);
    expect(db.batches).toEqual([1, 1, 1]);
  });
  it('条数上限仍然生效（体积很小也不会超过 size）', async () => {
    const db = new FakeBatchDB();
    await batchChunked({ DB: db }, stmts(5), 2, Array(5).fill(1));
    expect(db.batches).toEqual([2, 2, 1]);
  });
  it('所有语句都发出去了，一条不漏', async () => {
    const db = new FakeBatchDB();
    const n = 37;
    await batchChunked({ DB: db }, stmts(n), 8, Array(n).fill(D1_BATCH_BYTES / 3));
    expect(db.batches.reduce((a, b) => a + b, 0)).toBe(n);
  });
});

describe('rowBytes：量级对就够用', () => {
  it('中文按 3 字节估，不会低估', () => {
    const s = '数据结构'.repeat(1000);           // 4000 个汉字 = UTF-8 12000 字节
    expect(rowBytes(s)).toBeGreaterThanOrEqual(new TextEncoder().encode(s).length);
  });
  it('null / undefined 不炸', () => {
    expect(rowBytes(null, undefined, '')).toBeGreaterThan(0);
  });
  it('非字符串也能算', () => {
    expect(rowBytes(123, true)).toBeGreaterThan(0);
  });
  it('真实一题的量级：几 KB，不是几百 KB', () => {
    const n = rowBytes('材料'.repeat(600), '题干'.repeat(50), '[]', '["A"]', '解析'.repeat(100), '[]', '第1章', 'src');
    expect(n).toBeGreaterThan(4000);
    expect(n).toBeLessThan(20000);
  });
});

describe('导入链路确实带上了体积估算', () => {
  const src = fs.readFileSync(path.join(ROOT, 'functions/api/process.js'), 'utf8');
  it('questions 批量传了 weights', () => {
    expect(src).toMatch(/80, cleanedQ\.map\(\(q\) => rowBytes\(/);
  });
  it('materials 批量也传了（page_image 是 data URL，更容易超标）', () => {
    expect(src).toMatch(/80, cleanedM\.map\(\(m\) => rowBytes\(/);
  });
});
