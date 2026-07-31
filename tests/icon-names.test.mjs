// 图标名门禁：图标是内联的（CDN 挂了也能显示），所以 <icon name="X"> 里的 X
// 必须在 LUCIDE_ICONS 里存在。不存在不会报错，只是**静默渲染成空白** ——
// 这一轮我就写了 name="repeat" 和 name="arrow-down"，两个都不在集合里。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const ICONS = new Function(read('js/components/icon.js') + ';return LUCIDE_ICONS;')();
const names = new Set(Object.keys(ICONS));

// 收集所有 <icon name="..."> 的字面量用法，以及 :name="表达式" 里的字符串字面量
function usages() {
  const files = [
    ...fs.readdirSync(path.join(ROOT, 'js/tpl')).filter((x) => x.endsWith('.js')).map((f) => 'js/tpl/' + f),
    'js/components/question-card.js', 'js/components/reader.js',
  ].filter((f) => fs.existsSync(path.join(ROOT, f)));
  const out = [];
  for (const f of files) {
    const s = read(f);
    for (const m of s.matchAll(/<icon[^>]*\sname="([a-z0-9-]+)"/g)) out.push([path.basename(f), m[1]]);
    // :name="cond ? 'a' : 'b'" —— 取里面的字符串字面量。
    // 但要先去掉「比较用」的字面量：theme==='dark' 里的 'dark' 是判断条件，不是图标名。
    for (const m of s.matchAll(/<icon[^>]*\s:name="([^"]+)"/g)) {
      const expr = m[1].replace(/[!=]==?\s*'[^']*'/g, '');
      for (const lit of expr.matchAll(/'([a-z0-9-]+)'/g)) out.push([path.basename(f), lit[1]]);
    }
  }
  return out;
}

describe('内联图标集完整性', () => {
  const used = usages();

  it('扫到的图标用法数量合理（正则失效时不空跑）', () => {
    expect(used.length).toBeGreaterThan(40);
  });

  it('模板里用到的每个图标名都在 LUCIDE_ICONS 里', () => {
    const missing = [...new Set(used.filter(([, n]) => !names.has(n)).map(([f, n]) => f + ' → ' + n))];
    expect(missing).toEqual([]);
  });

  it('每个图标的数据都是可渲染的子元素数组', () => {
    for (const [n, v] of Object.entries(ICONS)) {
      expect(Array.isArray(v), n + ' 不是数组').toBe(true);
      expect(v.length, n + ' 是空数组').toBeGreaterThan(0);
      for (const child of v) {
        expect(Array.isArray(child) && typeof child[0] === 'string' && child[1] && typeof child[1] === 'object', n + ' 的子元素格式不对').toBe(true);
      }
    }
  });

  it('这次新增的 arrow-down 存在且是 arrow-up 的镜像方向', () => {
    expect(names.has('arrow-down')).toBe(true);
    const d = JSON.stringify(ICONS['arrow-down']);
    expect(d).toContain('M12 5v14');        // 竖线自上而下
    expect(d).toContain('m19 12-7 7-7-7');  // 箭头朝下
  });

  it('门禁确实能抓住不存在的图标名（自检）', () => {
    expect(names.has('repeat')).toBe(false);          // 我原本误用的那个
    expect(names.has('definitely-not-an-icon')).toBe(false);
    // 把这条规则套在一段伪模板上，必须报出来
    const fake = '<icon name="repeat" /><icon :name="x?\'nope-icon\':\'star\'" />';
    const found = [];
    for (const m of fake.matchAll(/<icon[^>]*\sname="([a-z0-9-]+)"/g)) found.push(m[1]);
    for (const m of fake.matchAll(/<icon[^>]*\s:name="([^"]+)"/g)) {
      const e = m[1].replace(/[!=]==?\s*'[^']*'/g, '');
      for (const lit of e.matchAll(/'([a-z0-9-]+)'/g)) found.push(lit[1]);
    }
    expect(found.filter((n) => !names.has(n))).toEqual(['repeat', 'nope-icon']);
  });

  it("比较用的字面量不会被误报成图标名（theme===dark 那种）", () => {
    expect([...new Set(used.map(([, n]) => n))]).not.toContain('dark');
    expect([...new Set(used.map(([, n]) => n))]).not.toContain('auto');
  });
});
