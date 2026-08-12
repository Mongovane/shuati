// 95MB 写库失败的真凶，数据来自线上实际导入的教材（数据结构 严蔚敏 第2版，273 页）。
//
// 实测（通过 /api/materials 读 content_md 统计）：
//   · 整本 content_md 共 6.76 MB
//   · 其中 343 行是 <figure><img src="data:image/...;base64,..."> 内联插图，合计 6.51 MB
//   · 也就是说 96% 的正文体积是 base64 图片
//   · 这 343 行【全部】通过原版 isProseLine 的判定
//
// isProseLine 为什么会认？base64 里全是字母，`(t.match(/[A-Za-z]{2,}/g)||[]).length >= 6`
// 必然成立。于是整块 base64 被当成散文累积进 passageBuf。而 passage 是「每道题都带一份」
// 的字段，138 道题各带一份几 MB 的材料 → 写库时 80 条一批就是 95,036,377 字节，
// 撞上 D1 的「Serialized RPC arguments limited to 32MiB」。
//
// 配套漏洞：_collectDataImages（把 base64 转存 R2、正文里换成短链）扫的是
// stem / analysis / options / answer，唯独漏了 passage —— 所以转存这条路救不了材料字段。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const SRC = fs.readFileSync(path.join(ROOT, 'js/views/ingest.js'), 'utf8');
const M = new Function(SRC + ';return IngestMixin;')().methods;
const ctx = () => Object.assign(Object.create(M), { extractPreview: {}, extractSkippedToc: 0, flash() {} });

// 复刻线上那种插图行：<figure><img src="data:image/png;base64,……"></figure>
const imgBlob = (bytes) => '<figure class="fig"><img src="data:image/png;base64,'
  + 'iVBORw0KGgoAAAANSUhEUg'.repeat(Math.ceil(bytes / 22)).slice(0, bytes) + '"></figure>';
const cjk = (n) => '数据结构逻辑存储线性表算法复杂度分析元素节点指针操作'.repeat(Math.ceil(n / 26)).slice(0, n);

describe('base64 插图不能进材料', () => {
  // 线上最大的一行是 69905 字符（p29）；这里用 8000 足够体现问题又不拖慢测试
  const page = (i) => `## 小节 ${i}\n\n${cjk(120)}\n\n${imgBlob(8000)}\n\n${cjk(90)}`;
  const pages = [page(1), page(2), page(3), `# 习题\n\n1. 简述下列概念：数据、数据元素、数据项。\n2. 试举一个数据结构的例子。`];
  const qs = M._extractWholeBook.call(ctx(), { subject: 'computer', title: '数据结构', pages: pages.map((content_md, i) => ({ page: i + 1, content_md })) });

  it('抽到题了', () => {
    expect(qs.length).toBeGreaterThanOrEqual(2);
  });
  it('没有任何一道题的材料或题干里带 base64', () => {
    for (const q of qs) {
      expect(q.passage || '').not.toContain(';base64,');
      expect(q.stem || '').not.toContain(';base64,');
    }
  });
  it('整批体积回到 KB 量级（原来是 MB 起步）', () => {
    const kb = new TextEncoder().encode(JSON.stringify(qs)).length / 1024;
    expect(kb).toBeLessThan(50);
  });
});

describe('isProseLine 的三条前置拦截', () => {
  // 注意：必须让材料【真的会累积】，否则「材料是空的」这个结果对拦截规则毫无说服力
  //（第一版我用 `## 节 x` 起页，标题本身就会重置材料，四条断言全是假阳性）。
  // 用「阅读下列短文」开启阅读区，散文才会真正进 passageBuf。
  const asPassage = (line) => {
    const md = `阅读下列短文，回答下列问题。\n\n${cjk(120)}\n\n${line}\n\n${cjk(80)}\n\n1. 这是承接材料的题目。\n`;
    const qs = M.mdToQuestions.call(ctx(), md, { subject: 'computer', source: 't', page: 1 });
    return qs.map((q) => q.passage || '').join('');
  };
  it('先确认这个夹具真的会产生材料（防止后面几条是假阳性）', () => {
    expect(asPassage(cjk(300)).length).toBeGreaterThan(200);
  });
  it('HTML 块（<figure> / <img>）不算正文', () => {
    const p = asPassage(imgBlob(4000));
    expect(p.length).toBeGreaterThan(100);      // 正常段落还在
    expect(p).not.toContain('base64');          // 但 blob 没进来
  });
  it('表格行（| … |）不算正文', () => {
    expect(asPassage('| ' + cjk(200) + ' |')).not.toContain('|');
  });
  it('data URI 即使不在行首也要挡', () => {
    expect(asPassage('见下图 data:image/png;base64,' + 'AAAA'.repeat(500))).not.toContain('base64');
  });
  it('超长单行（>1500 字）不算段落，是 blob', () => {
    const marker = '超长行专用标记';
    expect(asPassage(marker + cjk(3000))).not.toContain(marker);
  });
});

describe('材料长度硬上限', () => {
  it('再怎么累积也不超过 2400 字', () => {
    const pages = Array.from({ length: 6 }, (_, i) => `${cjk(900)}\n\n${cjk(900)}`);
    pages.push('# 习题\n\n1. 承接材料的题目。');
    const qs = M._extractWholeBook.call(ctx(), { subject: 'computer', title: 't', pages: pages.map((content_md, i) => ({ page: i + 1, content_md })) });
    for (const q of qs) expect((q.passage || '').length).toBeLessThanOrEqual(2400);
  });
});

describe('图片转存 R2 的扫描范围要含 passage', () => {
  it('_collectDataImages 扫 stem / analysis / options / answer / passage 五处', () => {
    const found = M._collectDataImages.call(ctx(), {
      stem: 'S ' + imgBlob(100),
      analysis: 'A ' + imgBlob(100),
      passage: 'P ' + imgBlob(100),
      options: [{ key: 'A', text: 'O ' + imgBlob(100) }],
      answer: ['R ' + imgBlob(100)],
    });
    expect(found).toHaveLength(5);
  });
  it('源码里替换环节也覆盖了 passage', () => {
    expect(SRC).toContain('if(q.passage)q.passage=swap(q.passage);');
  });
  it('没有 base64 时返回空，不做无用功', () => {
    expect(M._collectDataImages.call(ctx(), { stem: '纯文字题干', passage: '纯文字材料' })).toEqual([]);
  });
});

// —— 真实 MinerU 输出的形态（数据结构 p25 逐行读取所得）——
// 与 pdftotext 抽取的关键差异：
//   · 「## 习题」是真的 markdown H2 标题（所以习题分区门控能生效）
//   · 页边竖排书脊文字被 MinerU 的版面分析丢掉了，一行都没有
//   · 编号是半角「1. 」，子题括号全角半角混用（（1）和 (3) 同页并存）
//   · 双列选项已被 MinerU 合并：要么和题干同在一行，要么一个选项独占一行
describe('真实 MinerU 输出（数据结构 p25）', () => {
  const md = `## 习题

1. 简述下列概念：数据、数据元素、数据项、数据对象、数据结构、逻辑结构、存储结构、抽象数据类型。
2. 试举一个数据结构的例子，叙述其逻辑结构和存储结构两个层次的含义及相互关系。
3. 简述逻辑结构的4种基本结构并画出它们的关系图。
4. 存储结构由哪两种基本的存储方法实现?
5. 选择题
（1）在数据结构中，从逻辑上可以把数据结构分成（）。A. 动态结构和静态结构 B. 紧凑结构和非紧凑结构 C. 线性结构和非线性结构 D. 内部结构和外部结构
(3) 通常要求同一逻辑结构中的所有数据元素具有相同的特性, 这意味着（）。
A. 数据具有同一特点
B. 不仅数据元素所包含的数据项的个数要相同, 而且对应数据项的类型要一致
C. 每个数据元素都一样
D. 数据元素所包含的数据项的个数要相等
`;
  const qs = M.mdToQuestions.call(ctx(), md, { subject: 'computer', source: 'ds', page: 25 });
  it('4 道简答 + 2 道选择', () => {
    expect(qs).toHaveLength(6);
    expect(qs.filter((q) => q.type === 'single_choice')).toHaveLength(2);
  });
  it('题干和选项同在一行的，选项要拆出四个', () => {
    const q = qs.find((x) => /从逻辑上可以把数据结构分成/.test(x.stem));
    expect(q.options.map((o) => o.key)).toEqual(['A', 'B', 'C', 'D']);
    expect(q.options[3].text).toBe('内部结构和外部结构');
    expect(q.stem).not.toContain('A.');
  });
  it('选项一个独占一行的，同样四个', () => {
    const q = qs.find((x) => /具有相同的特性/.test(x.stem));
    expect(q.options.map((o) => o.key)).toEqual(['A', 'B', 'C', 'D']);
  });
  it('半角编号「1. 」认得出来', () => {
    expect(qs[0].stem.startsWith('简述下列概念')).toBe(true);
  });
  it('全角（1）和半角 (3) 混用都当成独立选择题', () => {
    expect(qs.filter((q) => q.type === 'single_choice').length).toBe(2);
  });
});
