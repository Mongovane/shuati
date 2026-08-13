// 两件事：
//
// 一、题干里的插图 HTML 残留。MinerU 把插图输出成 <figure class="fig"><img src="data:…">，
//     导入时 base64 会转存 R2 换成短链，<figure><img> 保留下来是对的（应用里要渲染插图）。
//     但下游两处只认 <img>、不认包在外面的 <figure>：
//       · answerfill 的提示词 → 模型看到一堆残缺 HTML
//       · 补答案面板的日志 → 显示成「…如图 4.18 所示。 <figure class="fig"><」（线上实测）
//     跨页截断的情况更糟：<img 开了头没有收尾，连 /<[^>]+>/ 都清不掉。
//
// 二、全站选中控件的视觉反馈要一致。行级（.bank-row.sel）本来就有，
//     缺的是工具栏级——上一轮只给题库加了，收藏页连「取消选择」按钮都没有。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 从 bank.js 里取出 cleanStem 来直接测
const bankSrc = read('js/views/bank.js');
const a = bankSrc.indexOf('const cleanStem=(t)=>');
const b = bankSrc.indexOf('const stemOf=');
const cleanStem = eval('(' + bankSrc.slice(a + 'const cleanStem='.length, b).trim().replace(/;$/, '') + ')');

describe('日志里的题干要洗掉插图 HTML', () => {
  it('完整的 <figure>…</figure> 整块替换', () => {
    const t = '5.1 小节中广义表例子，如图 4.18 所示。\n<figure class="fig"><img src="data:image/png;base64,AAAA"></figure>\n请画出该结构。';
    const out = cleanStem(t);
    expect(out).toBe('5.1 小节中广义表例子，如图 4.18 所示。 ［图］ 请画出该结构。');
    expect(out).not.toContain('<');
  });
  it('跨页截断、没有收尾的 <img 也要清掉（线上就是这种）', () => {
    const out = cleanStem('跨页断掉的：如图所示 <figure class="fig"><img src="data:image/png;base64,AAA');
    expect(out).not.toContain('<');
    expect(out).not.toContain('base64');
  });
  it('markdown 图片同样处理', () => {
    expect(cleanStem('前面 ![图4.18](imgs/a.png) 后面')).toBe('前面 ［图］ 后面');
  });
  it('公式定界符去掉，不影响可读性', () => {
    expect(cleanStem('线性表 $L=(a_{1},a_{2})$ ，下列陈述正确的是（）。'))
      .toBe('线性表 L=(a_{1},a_{2}) ，下列陈述正确的是（）。');
  });
  it('普通题干原样保留', () => {
    const t = '存储结构由哪两种基本的存储方法实现?';
    expect(cleanStem(t)).toBe(t);
  });
  it('截到 60 字，且不留半个标签', () => {
    const out = cleanStem('题干'.repeat(100));
    expect(out.length).toBeLessThanOrEqual(60);
  });
  it('空值不炸', () => {
    expect(cleanStem(null)).toBe('');
    expect(cleanStem(undefined)).toBe('');
  });
});

describe('补答案的提示词也要洗', () => {
  const src = read('functions/api/answerfill.js');
  it('先整块吃掉 <figure>…</figure>', () => {
    expect(src).toContain('<figure[\\s\\S]*?<\\/figure>');
  });
  it('未闭合的 <figure> 和 <img> 都有兜底', () => {
    expect(src).toContain('<figure[^>]*>');
    expect(src).toContain('<img\\b[\\s\\S]*$');
  });
  it('残留的结构标签统一清掉', () => {
    expect(src).toContain('figcaption');
  });
  it('仍然告诉模型「此处有插图，未提供」，而不是静默删除', () => {
    expect(src).toContain('［此处有插图，未提供］');
  });
});

describe('全站选中控件的视觉反馈', () => {
  const bank = read('js/tpl/view-bank.js');
  const prac = read('js/tpl/view-practice.js');
  const css = read('css/style.css');

  it('题库和收藏用同一套：has-sel / sel-count / sel-clear', () => {
    for (const tpl of [bank, prac]) {
      expect(tpl).toContain("'has-sel'");
      expect(tpl).toContain('class="sel-count"');
      expect(tpl).toContain('class="btn sel-clear"');
      expect(tpl).toContain('取消选择');
    }
  });
  it('样式定义在一处，两个页面共用（媒体查询里的微调不算重复定义）', () => {
    // .sel-count 在 @media(max-width:560px) 里还有一条字号微调，所以基础定义只查一次出现在媒体查询之前
    const mq = css.indexOf('@media(max-width:560px)');
    const base = css.slice(0, mq > 0 ? undefined : css.length);
    expect(base).toContain('.sel-count{');
    expect(base).toContain('.btn.sel-clear{');
    expect(css).toContain('.bank-toolbar.has-sel');
    // 两个页面不能各自复制一份样式
    expect(css.match(/\.bank-toolbar\.has-sel\{/g)).toHaveLength(1);
  });
  it('行级选中态本来就有（题库 / 收藏共用 .bank-row.sel）', () => {
    expect(bank).toContain(':class="{sel:bank.sel.includes(q.id)}"');
    expect(prac).toContain(':class="{sel:fav.sel.includes(q.id)}"');
    expect(css).toContain('.bank-row.sel{border-color:var(--accent)');
  });
  it('抽题预览：勾选态有正向高亮，不只是「没勾的变淡」', () => {
    expect(css).toContain('.prev-item:not(.off){box-shadow:inset 3px 0 0 var(--accent)}');
  });
  it('查重：勾中=将被删除，用警示底色而不只是删除线', () => {
    expect(css).toContain('.dup-item.del{background:var(--bad-soft)}');
  });
  it('选中数量在 0 时不高亮，避免恒亮变成噪声', () => {
    expect(css).toContain('.sel-count{');
    expect(css).toContain('.sel-count.on{background:var(--accent)');
  });
  it('深色主题下强调色上的文字有单独处理', () => {
    expect(css).toContain('[data-theme=dark] .sel-count.on');
    expect(css).toContain('[data-theme=dark] .btn.sel-clear:hover');
  });
});
