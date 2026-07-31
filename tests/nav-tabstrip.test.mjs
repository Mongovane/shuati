// 窄屏导航条：9 项在 500px 宽只放得下 6 项，靠 .tabs 的 overflow-x:auto 横滚。
// 实测两个问题：切到靠右的项后条子仍停在最左（激活项不可见，像「什么都没选中」），
// 且滚动条被 scrollbar-width:none 藏了、没有任何「右边还有内容」的提示。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const appSrc = read('js/app.js');
const css = read('css/style.css');

// 从 app.js 里取出两个方法真身来跑（它们只依赖 document，用假 DOM 即可）
function methods() {
  const a = appSrc.indexOf('_syncTabStrip(){');
  const b = appSrc.indexOf('applyTheme(', a);          // 必须从 a 之后找：applyTheme 在文件更早处也出现过
  const body = appSrc.slice(a, b).replace(/,\s*$/, '');
  return new Function('return {' + body + '};')();
}

// 极简假 DOM：一个可横滚的 .tabs + 若干 .tab
function fakeStrip({ clientWidth = 500, scrollWidth = 752, scrollLeft = 0, activeLeft = 631, activeWidth = 109 }) {
  const cls = new Set();
  const strip = {
    clientWidth, scrollWidth, scrollLeft,
    classList: { toggle: (n, on) => { if (on) cls.add(n); else cls.delete(n); }, has: (n) => cls.has(n) },
    getBoundingClientRect: () => ({ left: 0, right: clientWidth, width: clientWidth }),
    querySelector: (sel) => sel === '.tab.active' ? {
      getBoundingClientRect: () => ({ left: activeLeft - strip.scrollLeft, right: activeLeft - strip.scrollLeft + activeWidth, width: activeWidth }),
    } : null,
    _cls: cls,
  };
  global.document = { querySelector: (s) => (s === '.tabs' ? strip : null) };
  return strip;
}

describe('激活项滚入可视区', () => {
  const M = methods();

  it('激活项在右侧屏外时会把它滚进来（原来 scrollLeft 一直是 0）', () => {
    const strip = fakeStrip({ activeLeft: 631, activeWidth: 109 });   // Settings
    M._syncTabStrip.call(M);
    expect(strip.scrollLeft).toBeGreaterThan(0);
    const r = strip.querySelector('.tab.active').getBoundingClientRect();
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(strip.clientWidth);
  });

  it('激活项已在可视区内时不动（不制造无谓跳动）', () => {
    const strip = fakeStrip({ activeLeft: 12, activeWidth: 70 });     // Home
    M._syncTabStrip.call(M);
    expect(strip.scrollLeft).toBe(0);
  });

  it('不用 scrollIntoView —— 它会连带滚动祖先，把整个页面顶走', () => {
    const a = appSrc.indexOf('_syncTabStrip(){');
    const body = appSrc.slice(a, appSrc.indexOf('applyTheme(', a));
    expect(body).not.toMatch(/scrollIntoView/);
    expect(body).toMatch(/scrollLeft \+=/);
  });

  it('没有 .tabs 或没有激活项时安全返回，不抛错', () => {
    global.document = { querySelector: () => null };
    expect(() => M._syncTabStrip.call(M)).not.toThrow();
    const strip = fakeStrip({});
    strip.querySelector = () => null;
    expect(() => M._syncTabStrip.call(M)).not.toThrow();
  });
});

describe('横滚渐变提示', () => {
  const M = methods();

  it('停在最左：只提示右侧还有内容', () => {
    const s = fakeStrip({ scrollLeft: 0, scrollWidth: 752, clientWidth: 500 });
    M._syncTabFade.call(M, s);
    expect(s._cls.has('more-r')).toBe(true);
    expect(s._cls.has('more-l')).toBe(false);
  });

  it('滚到中间：两侧都提示', () => {
    const s = fakeStrip({ scrollLeft: 100, scrollWidth: 752, clientWidth: 500 });
    M._syncTabFade.call(M, s);
    expect(s._cls.has('more-l')).toBe(true);
    expect(s._cls.has('more-r')).toBe(true);
  });

  it('滚到最右：只提示左侧', () => {
    const s = fakeStrip({ scrollLeft: 252, scrollWidth: 752, clientWidth: 500 });
    M._syncTabFade.call(M, s);
    expect(s._cls.has('more-l')).toBe(true);
    expect(s._cls.has('more-r')).toBe(false);
  });

  it('宽屏放得下全部时两侧都不提示', () => {
    const s = fakeStrip({ scrollLeft: 0, scrollWidth: 752, clientWidth: 752 });
    M._syncTabFade.call(M, s);
    expect(s._cls.has('more-l')).toBe(false);
    expect(s._cls.has('more-r')).toBe(false);
  });

  it('CSS 里有对应的遮罩规则（含 -webkit- 前缀，Safari 要）', () => {
    expect(css).toMatch(/\.tabs\.more-r\{mask-image/);
    expect(css).toMatch(/\.tabs\.more-l\{mask-image/);
    expect(css).toMatch(/\.tabs\.more-l\.more-r\{mask-image/);
    expect(css).toMatch(/-webkit-mask-image/);
  });
});

describe('接线与触屏点击区', () => {
  it('view 变化与首屏都会同步导航条', () => {
    const i = appSrc.indexOf('view(v){');
    expect(i).toBeGreaterThan(-1);
    expect(appSrc.slice(i, i + 260)).toMatch(/_syncTabStrip/);
    // 用 indexOf 而不是固定字符窗口：mounted 里后续还会插别的初始化逻辑，
    // 卡死一个 500 字符的窗口会让这条断言随无关改动而误红（已经发生过一次）
    const mi = appSrc.indexOf('mounted()');
    expect(mi).toBeGreaterThan(-1);
    expect(appSrc.slice(mi).indexOf('_syncTabStrip')).toBeGreaterThan(-1);
  });

  it('监听 tabs 滚动与窗口尺寸变化，且是 passive', () => {
    expect(appSrc).toMatch(/addEventListener\('scroll',\s*\(\)=>this\._syncTabFade\(t\),\s*\{passive:true\}\)/);
    expect(appSrc).toMatch(/addEventListener\('resize',\s*\(\)=>this\._syncTabStrip\(\),\s*\{passive:true\}\)/);
  });

  it('触屏下导航项至少 44px 高（原来只有 35px）', () => {
    const coarse = css.slice(css.indexOf('@media (pointer:coarse){'), css.indexOf('@media (pointer:coarse){') + 400);
    expect(coarse).toMatch(/\.tab\{min-height:44px/);
    expect(coarse).toMatch(/font-size:16px !important/);   // iOS 自动放大那条别被改掉
  });
});

describe('版本号：模板里不许再出现写死的版本字面量', () => {
  it('导航里的 Settings 用 appVer，不是写死的 v46', () => {
    const tpl = read('js/tpl/shell-open.js');
    expect(tpl).toMatch(/Settings <span[^>]*>\{\{ appVer \}\}<\/span>/);
    expect(tpl).not.toMatch(/>v\d+</);
  });

  it('全部模板里都没有形如 v46 / v170 的硬编码版本号', () => {
    const bad = [];
    for (const f of fs.readdirSync(path.join(ROOT, 'js/tpl'))) {
      const s = read('js/tpl/' + f);
      for (const m of s.matchAll(/[>\s"']v(\d{2,4})[<\s"']/g)) bad.push(f + ' → v' + m[1]);
    }
    expect(bad).toEqual([]);
  });
});
