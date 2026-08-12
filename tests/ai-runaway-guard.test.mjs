// 输出上限：默认不传，用中转站/模型自己的最大值。
//
// 为什么放弃预设数字：给小了推理模型会把预算全花在思维链上（实测一次推理 5.4K，
// 且计入 completion_tokens），正文一个字写不出来；给大了又被上游以「超过模型上限」
// 拒掉。各家模型真实上限从 8K 到 128K 都有，服务端没法替所有人猜。
//
// 代价是失去了「跑飞」的硬止损，所以改在流层面兜——我们自己持有 reader，
// 能看着内容判断，比预设一个 token 数更精确：
//   · 复读检测：尾部连续 3 段完全相同就中止，保留已生成内容
//   · 硬字数上限：40 万字，最后一道闸
//   · 非流式的 answerfill 检测不了复读，仍然靠超时
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const app = read('js/app.js');

// 把 _isLooping 整体求值成函数（只取函数体会让里面的 break 脱离循环）
const SIG = '_isLooping(acc){';
const i = app.indexOf(SIG);
const st = i + SIG.length - 1;
let depth = 0, j = st;
for (; j < app.length; j++) { if (app[j] === '{') depth++; else if (app[j] === '}') { depth--; if (!depth) break; } }
const isLooping = eval('(function(acc)' + app.slice(st, j + 1) + ')');

const LOOP = '因此公共部分的面积等于四分之三派减去二分之一乘以 a 的平方，这是最终答案。';
const NORMAL = '第一步将两圆方程化为极坐标形式，第二步比较极径大小确定包络线，第三步分段积分，第四步合并化简，第五步验证端点取值。';

describe('复读检测：该拦的拦住', () => {
  it('同一句反复吐 20 次', () => {
    expect(isLooping(LOOP.repeat(20))).toBe(true);
  });
  it('前面正常、尾部才开始打转', () => {
    expect(isLooping(NORMAL.repeat(8) + LOOP.repeat(8))).toBe(true);
  });
  it('几百个连续相同字符也算跑飞', () => {
    expect(isLooping(NORMAL.repeat(6) + '。'.repeat(300))).toBe(true);
  });
  it('周期是任意长度都能找到（不是猜固定值）', () => {
    // 第一版写死了候选周期 [60,100,160,240]，而实际复读单元往往是一整句（几十字），
    // 对不上于是一次都没触发。改成从 20 到 400 逐个搜索真实周期。
    for (const unit of ['短句复读测试用例内容。', '中等长度的复读单元，用来验证周期搜索是否覆盖到这个长度区间。']) {
      const times = Math.ceil(900 / unit.length) + 3;
      expect(isLooping(unit.repeat(times))).toBe(true);
    }
  });
});

describe('复读检测：不该拦的别拦', () => {
  it('正常长解析（每句都不同）', () => {
    const t = Array.from({ length: 24 }, (_, k) => `第 ${k + 1} 步：这一步做的事情和前后都完全不同，编号是 ${k * 7 + 3}，得出的结论也各不相同。`).join('');
    expect(t.length).toBeGreaterThan(600);
    expect(isLooping(t)).toBe(false);
  });
  it('只重复 2 次不算打转', () => {
    expect(isLooping(NORMAL.repeat(6) + LOOP.repeat(2))).toBe(false);
  });
  it('选项列表反复出现（多道同构选择题）', () => {
    const t = 'A. 动态结构和静态结构\nB. 紧凑结构和非紧凑结构\nC. 线性结构和非线性结构\nD. 内部结构和外部结构\n'.repeat(6);
    expect(isLooping(t)).toBe(false);
  });
  it('数学推导里高度相似但逐行不同', () => {
    const t = Array.from({ length: 20 }, (_, k) => `当 n = ${k} 时，代入递推式得 a_${k} = ${k * 2 + 1}，与前一项相差 2。`).join('\n');
    expect(t.length).toBeGreaterThan(600);
    expect(isLooping(t)).toBe(false);
  });
  it('内容还短时一律不判，避免开头误伤', () => {
    expect(isLooping(LOOP.repeat(5))).toBe(false);      // < 600 字
    expect(isLooping('答案是 C。')).toBe(false);
    expect(isLooping('')).toBe(false);
    expect(isLooping(null)).toBe(false);
  });
  it('纯空白不算（unit.trim() 挡掉）', () => {
    expect(isLooping(' '.repeat(1000))).toBe(false);
    expect(isLooping('\n'.repeat(1000))).toBe(false);
  });
});

describe('流循环里接上了防护', () => {
  it('每积累约 400 字查一次，不是每个 chunk 都查', () => {
    expect(app).toContain('if(acc.length - lastGuard >= 400)');
  });
  it('有硬字数上限作为最后一道闸', () => {
    expect(app).toContain('LOOP_MAX_CHARS=400000');
  });
  it('命中后停止读流并保留已生成内容（不 throw）', () => {
    expect(app).toContain("onDelta({runawayStop:'loop'})");
    expect(app).toContain('if(stopped){ try{ await reader.cancel(); }catch(_){} return { res, text:acc, ok:true, runaway:true }; }');
  });
});

describe('默认不传 max_tokens', () => {
  it('explain 只在用户显式设置时才带', () => {
    const src = read('functions/api/explain.js');
    expect(src).toContain('if (ovMax > 0) payload.max_tokens =');
    expect(src).not.toMatch(/max_tokens: capOut\(/);
  });
  it('answerfill 同样', () => {
    const src = read('functions/api/answerfill.js');
    expect(src).toContain('...(ovMax > 0 ? { max_tokens:');
  });
  it('answerfill 检测不了复读，所以超时必须保留', () => {
    const src = read('functions/api/answerfill.js');
    expect(src).toContain('AbortSignal.timeout(TIMEOUT_MS)');
  });
  it('用户覆盖值仍然被钳在合理区间', () => {
    for (const f of ['functions/api/explain.js', 'functions/api/answerfill.js']) {
      expect(read(f)).toContain('Math.min(200000, Math.max(256, ovMax))');
    }
  });
});

describe('三个入口都告知停止原因', () => {
  for (const [label, file] of [
    ['刷题页', 'js/views/practice.js'],
    ['教材阅读', 'js/components/reader.js'],
    ['PDF 原书', 'js/views/books.js'],
  ]) {
    it(label + ' 提示「模型开始重复输出」而不是让人以为断网', () => {
      expect(read(file)).toContain('模型开始重复输出');
    });
  }
  it('刷题页命中后不再自动续写（续了还是会打转）', () => {
    expect(read('js/views/practice.js')).toContain('if(d.runawayStop && showing()){ truncated=false;');
  });
  it('两个阅读入口命中后也不续写', () => {
    for (const f of ['js/components/reader.js', 'js/views/books.js']) {
      expect(read(f)).toContain('if(d.runawayStop){ cut=false;');
    }
  });
});
