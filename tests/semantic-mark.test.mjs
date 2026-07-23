// AI 解析区块语义高亮的关键词识别
import { describe, it, expect } from 'vitest';

const WARN = /^\s*(?:\u26a0\ufe0f?\s*)?(?:易错|注意|警告|坑|常见错误|误区|陷阱|错误|小心|切记|不要|别|勿)/;
const TIP = /^\s*(?:\ud83d\udca1?\s*)?(?:思路|分析|解析|方法|步骤|技巧|提示|总结|结论|要点|核心|关键在于|本质)/;
const KEY = /^\s*(?:\ud83d\udccc?\s*)?(?:定义|定理|公式|性质|法则|概念|记住|重点)/;
function classify(t) {
  if (WARN.test(t)) return 'warn';
  if (TIP.test(t)) return 'tip';
  if (KEY.test(t)) return 'key';
  return '';
}

describe('区块语义分类', () => {
  it('易错/注意 → warn（红）', () => {
    expect(classify('易错点：混淆数列与函数极限')).toBe('warn');
    expect(classify('注意符号不要丢')).toBe('warn');
    expect(classify('⚠️ 常见错误：漏写绝对值')).toBe('warn');
  });
  it('思路/方法/结论 → tip（蓝）', () => {
    expect(classify('思路：先对位移求导')).toBe('tip');
    expect(classify('总结：三步走')).toBe('tip');
  });
  it('定义/定理/公式 → key（黄）', () => {
    expect(classify('定义：连续函数')).toBe('key');
    expect(classify('定理：介值定理')).toBe('key');
  });
  it('普通句子不标记', () => {
    expect(classify('这道题选 A')).toBe('');
    expect(classify('接下来代入计算')).toBe('');
  });
});
