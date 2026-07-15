// 近似查重指纹（js/views/bank.js 的 simhash64 / hamming64 / _dsNorm）
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const src = fs.readFileSync(path.join(ROOT, 'js/views/bank.js'), 'utf8');
const { simhash64, hamming64, bigramJac, _dsNorm } = new Function(src + ';return { simhash64, hamming64, bigramJac, _dsNorm };')();

describe('查重归一化 _dsNorm', () => {
  it('大小写 / 空白 / 中英标点全部剔除后等价', () => {
    expect(_dsNorm('设 X，为。？（栈）！')).toBe(_dsNorm('设x为栈'));
    expect(_dsNorm('Hello,  World—_·…')).toBe('helloworld');
  });
});

describe('simhash64 + 汉明距离', () => {
  it('同串距离 0；空串安全返回 [0,0]', () => {
    expect(hamming64(simhash64('abc def'), simhash64('abc def'))).toBe(0);
    expect(simhash64('')).toEqual([0, 0]);
    expect(simhash64('，。！')).toEqual([0, 0]);   // 全标点归一后为空
  });
  it('OCR 级小差异（标点/个别错字）：汉明 ≤10 且 bigram Jaccard ≥0.72 → 双闸判相似', () => {
    const a = '下列关于二叉树的说法正确的是：先序遍历的第一个访问节点一定是根节点，中序遍历不是';
    const b = '下列关于二叉树的说法正确的是，先序遍历的第一个访问结点一定是根节点。中序遍历不是';
    expect(hamming64(simhash64(a), simhash64(b))).toBeLessThanOrEqual(10);
    expect(bigramJac(_dsNorm(a), _dsNorm(b))).toBeGreaterThanOrEqual(0.72);
  });
  it('内容不同的题 → 距离显著大', () => {
    const a = '下列关于二叉树先序遍历的说法哪些是正确的请选择';
    const b = '已知矩阵 A 的特征值为 1 和 2，求行列式 |A| 的值等于多少';
    expect(hamming64(simhash64(a), simhash64(b))).toBeGreaterThan(12);
  });
  it('同套话头、不同题尾：即便汉明进 5~10 区间，Jaccard 复核 <0.72 拦下误并', () => {
    const a = '下列关于操作系统进程调度的说法正确的是先来先服务算法平均等待时间最短';
    const b = '下列关于操作系统进程调度的说法正确的是时间片轮转适合分时系统交互场景';
    expect(bigramJac(_dsNorm(a), _dsNorm(b))).toBeLessThan(0.72);
  });
});
