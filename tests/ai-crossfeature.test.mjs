// 「改一处别碰坏别处」的门禁。
//
// 这一轮改了输出预算、自动续写、用量显示，涉及的调用点不止刷题页：
//   刷题页  解题解析 / 知识点卡片 / 追问        js/views/practice.js
//   教材阅读 问 AI（整理笔记）                 js/components/reader.js
//   PDF 原书 问 AI（含视觉）                   js/views/books.js
//   题库    AI 补答案                          js/views/bank.js → answerfill.js（无 max_tokens，不受影响）
//   OCR     拍照识题 / 看图                    cfocr.js / visionocr.js（不走 explain.js）
//
// 另外修了一个我自己引入的回归：aiX.usage 原本是单一字段，生成完知识点卡片再切回
// 解题解析，解析标题下面挂的是卡片那次的用量。reasoning 也有同样的毛病（上游遗留）。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

describe('每个 AI 调用点都带上输出上限（统一走 aiOv）', () => {
  it('aiOv 是唯一出口', () => {
    expect(read('js/app.js')).toContain('o.max_tokens=Math.floor(Number(e.maxTokens))');
  });
  for (const [label, file] of [
    ['刷题页 解析/卡片/追问', 'js/views/practice.js'],
    ['教材阅读 问 AI', 'js/components/reader.js'],
    ['PDF 原书 问 AI', 'js/views/books.js'],
  ]) {
    it(label + ' 走 aiOv', () => {
      expect(read(file)).toMatch(/this\.aiOv\(/);
    });
  }
  it('没有任何调用点还在内联拼 base_url/api_key（那样必然漏新字段）', () => {
    for (const f of ['js/views/practice.js', 'js/components/reader.js', 'js/views/books.js']) {
      expect(read(f)).not.toContain('{base_url:this.explainCfg.base,api_key:this.explainCfg.key}');
    }
  });
});

describe('三个问 AI 入口都能自动续写', () => {
  for (const [label, file, list] of [
    ['刷题页追问', 'js/views/practice.js', null],
    ['教材阅读', 'js/components/reader.js', 'rdAiList'],
    ['PDF 原书', 'js/views/books.js', 'pdfAiList'],
  ]) {
    it(label + ' 接住 finish_reason 并带 continue_from', () => {
      const src = read(file);
      expect(src).toContain("finish_reason==='length'");
      expect(src).toContain('continue_from');
    });
    if (list) {
      it(label + ' 续写时把已写部分作为前缀累加，不覆盖', () => {
        expect(read(file)).toContain('entry.a=base+d.acc;');
      });
      it(label + ' 用户中断时立刻停止续写', () => {
        expect(read(file)).toContain('!ctrl.signal.aborted');
      });
    }
  }
});

describe('解析与卡片两条视图互不污染', () => {
  const app = read('js/app.js');
  const pra = read('js/views/practice.js');
  it('模型名按视图取（上游本来就对）', () => {
    expect(app).toContain("this.aiX.view==='concept' ? (this.aiX.cardsModel||'')");
  });
  it('思维链按视图取（原来只有一份，切回解析会看到卡片的推理）', () => {
    expect(app).toContain("this.aiX.view==='concept' ? (this.aiX.cardsReasoning||'')");
  });
  it('用量按视图取（这条是我引入的回归）', () => {
    expect(app).toContain('curAiUsage()');
    expect(app).toContain("this.aiX.view==='concept' ? (this.aiX.cardsUsage||null)");
  });
  it('写入端也按视图分流，不是只有读取端区分', () => {
    expect(pra).toContain("const RK=isConcept?'cardsReasoning':'reasoning';");
    expect(pra).toContain("const UK=isConcept?'cardsUsage':'usage';");
    expect(pra).toContain('this.aiX[RK]=');
    expect(pra).toContain('this.aiX[UK]=');
  });
  it('别名声明在函数作用域，不能塞进 if(showing()) 块里', () => {
    // 第一版就是这么写的，结果流回调里 UK is not defined，10 条用例全红
    const i = pra.indexOf("const UK=isConcept?'cardsUsage':'usage';");
    const j = pra.indexOf('if(showing()){', pra.indexOf('const showing='));
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(j);
  });
  it('切题时两个视图的思维链和用量都清空', () => {
    expect(app).toContain("reasoning:'', cardsReasoning:'', reasonOpen:true, usage:null, cardsUsage:null }");
  });
  it('模板传的是 curAiUsage，不是直接读 aiX.usage', () => {
    const tpl = read('js/tpl/view-practice.js');
    expect(tpl).toContain(':ai-usage="curAiUsage"');
    expect(tpl).not.toContain('aiX.usage||null');
  });
});

describe('没被改动的功能要保持原样', () => {
  // 契约变更：原来这里断言「不设 max_tokens」，但那其实是隐患而不是安全状态——
  // 省略它不等于「用模型最大值」，OpenAI 兼容接口下是「让服务商决定」，
  // 部分中转站会塞一个很小的默认值（512/1024），于是被静默截断；
  // 而这里是 JSON 模式，截断 = 非法 JSON = 8 道题一起废。
  it('AI 补答案要有明确上限，并尊重用户设置', () => {
    const src = read('functions/api/answerfill.js');
    expect(src).toContain('max_tokens:');
    expect(src).toContain('Math.min(32000, Math.max(1024, ovMax))');
    expect(src).toContain('6000 + qs.length * 900');
    // 基数必须覆盖典型思维链（实测 5.4K），否则截断 → 非法 JSON → 整批废掉
    const m = src.match(/Math\.min\((\d+), (\d+) \+ qs\.length \* (\d+)\)/);
    expect(Number(m[2])).toBeGreaterThanOrEqual(6000);
  });
  it('AI 补答案是非流式的，必须有超时，否则一次卡住堵死整轮', () => {
    const src = read('functions/api/answerfill.js');
    expect(src).toContain('AbortSignal.timeout(TIMEOUT_MS)');
    expect(src).toContain('AbortSignal.any([request.signal');
  });
  it('超时和用户主动取消要分开报，别让人以为是自己点了停止', () => {
    const src = read('functions/api/answerfill.js');
    expect(src).toContain('没有返回，已放弃这一批');
    expect(src).toContain("if (request.signal && request.signal.aborted) return json({ error: '已取消' }, 499);");
  });
  it('拍照识题的预算没被动', () => {
    expect(read('functions/api/cfocr.js')).toContain('max_tokens: 2500');
  });
  it('看图 OCR 的预算没被动', () => {
    expect(read('functions/api/visionocr.js')).toContain('max_tokens: 4000');
  });
  it('OCR 两条路都不经过 explain.js，不受预算改动影响', () => {
    for (const f of ['functions/api/cfocr.js', 'functions/api/visionocr.js']) {
      expect(read(f)).not.toContain('_prompts.js');
    }
  });
  it('reading 模式的系统提示词与学科无关，英语也走教材辅导那条', () => {
    expect(read('functions/api/_prompts.js')).toContain('if (reading) return READ_ASK;');
  });
});
