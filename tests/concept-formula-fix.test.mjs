// 知识卡片公式反斜杠修复：AI 返回 JSON 里 LaTeX 单反斜杠未转义时能救回，且不破坏合法转义
import { describe, it, expect } from 'vitest';

const fixBackslash = (str) => str.replace(/\\\\|\\u[0-9a-fA-F]{4}|\\([a-zA-Z])/g, (m, c) => (c ? '\\\\' + c : m));
const tryParse = (str) => { try { const r = JSON.parse(str); return Array.isArray(r) ? r : null; } catch (_) { return null; } };
function parse(raw) {
  let s = String(raw || '').trim();
  const a = s.indexOf('['), b = s.lastIndexOf(']');
  if (a >= 0 && b > a) s = s.slice(a, b + 1);
  const arr = tryParse(fixBackslash(s)) || tryParse(s);
  if (!arr) return [];
  return arr.map((x) => ({ term: String(x.term || '').trim(), formula: String(x.formula || '').trim(), plain: String(x.plain || '').trim() }));
}
const BS = String.fromCharCode(92);

describe('公式反斜杠修复', () => {
  it('合法转义保持不变', () => {
    const good = '[{"term":"导数","formula":"$' + BS + BS + 'frac{a}{b}$"}]';
    const r = parse(good);
    expect(r.length).toBe(1);
    expect(r[0].formula).toBe('$' + BS + 'frac{a}{b}$');
  });
  it('未转义单反斜杠命令能救回', () => {
    const bad = '[{"term":"积分","formula":"$' + BS + 'int_0^1$","plain":"设 $' + BS + 'xi$ 与 $' + BS + 'alpha$"}]';
    expect(tryParse(bad)).toBeNull();
    const r = parse(bad);
    expect(r.length).toBe(1);
    expect(r[0].formula).toContain(BS + 'int');
    expect(r[0].plain).toContain(BS + 'xi');
    expect(r[0].plain).toContain(BS + 'alpha');
  });
  it('控制符类命令修复后无控制字符', () => {
    for (const cmd of ['frac', 'beta', 'nabla', 'right']) {
      const bad = '[{"formula":"$' + BS + cmd + '$"}]';
      const r = parse(bad);
      expect(r.length).toBe(1);
      expect(r[0].formula.charCodeAt(1)).toBe(92);
      expect(/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(r[0].formula)).toBe(false);
      expect(r[0].formula).toContain(cmd);
    }
  });
  it('非法且无法修复的返回空数组', () => {
    expect(parse('这不是JSON')).toEqual([]);
  });
});
