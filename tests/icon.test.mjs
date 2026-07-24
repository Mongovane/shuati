// Icon 组件：内联 Lucide 数据生成 SVG
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

// 加载 icon.js，取出 Icon 组件
const code = fs.readFileSync(path.join(ROOT, 'js/components/icon.js'), 'utf8');
const Icon = new Function(code + '; return Icon;')();

describe('Icon 组件', () => {
  it('已知图标生成含图形元素的 SVG', () => {
    for (const name of ['sparkles', 'book-open', 'rotate-cw', 'save', 'x', 'check', 'arrow-right']) {
      const svg = Icon.computed.svg.call({ name, size: 16, stroke: 2 });
      expect(svg.startsWith('<svg')).toBe(true);
      expect(/<(path|circle|rect|line|polyline|polygon)/.test(svg)).toBe(true); // 有图形
      expect(svg).toContain('currentColor'); // 颜色跟随
    }
  });
  it('size / stroke 属性生效', () => {
    const svg = Icon.computed.svg.call({ name: 'x', size: 24, stroke: 1.5 });
    expect(svg).toContain('width="24"');
    expect(svg).toContain('stroke-width="1.5"');
  });
  it('未知图标名返回空 SVG（不报错、不显示碎图标）', () => {
    const svg = Icon.computed.svg.call({ name: 'no-such-icon-xyz', size: 16, stroke: 2 });
    expect(svg.startsWith('<svg')).toBe(true);
    expect(/<(path|circle|rect)/.test(svg)).toBe(false); // 内部无图形
  });
});
