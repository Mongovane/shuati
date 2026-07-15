// 稳定题目 ID（functions/api/process.js 的 stableQid）——同题重复导入靠它去重
import { describe, it, expect } from 'vitest';
import { stableQid } from '../functions/api/process.js';

describe('stableQid', () => {
  it('同科目同题干 → 同 id；空白差异（多空格/换行）归一后不影响', () => {
    const a = stableQid('math', '求  极限\n的值');
    const b = stableQid('math', '求 极限 的值');
    const c = stableQid('math', '  求 极限 的值  ');
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
  it('固定 16 位十六进制格式', () => {
    expect(stableQid('math', '题目')).toMatch(/^[0-9a-f]{16}$/);
  });
  it('不同题干 / 不同科目 → 不同 id', () => {
    expect(stableQid('math', '题目A')).not.toBe(stableQid('math', '题目B'));
    expect(stableQid('math', '题目A')).not.toBe(stableQid('english', '题目A'));
  });
  it('对空值稳健（不抛错，仍产出合法 id）', () => {
    expect(stableQid('', '')).toMatch(/^[0-9a-f]{16}$/);
    expect(stableQid(null, undefined)).toMatch(/^[0-9a-f]{16}$/);
  });
});
