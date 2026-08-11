// 提示词按学科分流的门禁。
// 背景：原来只有一套提示词（「大学课程解题老师…定理/公式…分步推导」）。英语题走进来
// 会被这套理科口径带偏——不给中英对照、不点词汇语法考点，知识卡片还会硬凑 $...$ 数学公式。
// 这里锁住两件事：① 英语走英语那套；② 其余学科一个字都没变（回归保护）。
import { describe, it, expect } from 'vitest';
import { systemPrompt, isEnglish, FMT_RULE } from '../functions/api/_prompts.js';

const explain = (subject) => systemPrompt({ subject, ask: '', concept: false, reading: false });
const concept = (subject) => systemPrompt({ subject, ask: '', concept: true, reading: false });

describe('isEnglish', () => {
  it('认 english，大小写和空格都容忍', () => {
    expect(isEnglish('english')).toBe(true);
    expect(isEnglish(' English ')).toBe(true);
  });
  it('其余学科和空值都不算', () => {
    for (const s of ['math', 'computer', 'politics', '', null, undefined]) expect(isEnglish(s)).toBe(false);
  });
});

describe('英语解析：中英对照 + 关键点', () => {
  const p = explain('english');
  it('固定小标题齐全', () => {
    for (const h of ['## 答案', '## 关键句', '## 选项分析', '## 考点', '## 易错点']) expect(p).toContain(h);
  });
  it('要求英文原句必须配中文翻译', () => {
    expect(p).toMatch(/每一句英文都必须配中文/);
    expect(p).toContain('中文翻译');
  });
  it('要求逐项分析并归类错误类型', () => {
    for (const t of ['无中生有', '张冠李戴', '以偏概全', '过度推断']) expect(p).toContain(t);
  });
  it('要求点明考点与长难句主干', () => {
    expect(p).toContain('词汇辨析');
    expect(p).toContain('主干');
  });
  it('不把数学公式规则塞给英语', () => {
    expect(p).not.toContain(FMT_RULE);
    expect(p).toContain('不要输出数学公式');
  });
});

describe('英语知识卡片：语法 / 连词 / 搭配', () => {
  const p = concept('english');
  it('覆盖英语知识点门类', () => {
    for (const t of ['时态', '非谓语', '虚拟语气', '从句', '连词', '固定搭配', '词根词缀']) expect(p).toContain(t);
  });
  it('连词要说清逻辑关系，不是只报名字', () => {
    expect(p).toContain('however');
    expect(p).toMatch(/转折、并列还是因果/);
  });
  it('明确禁用 LaTeX，formula 放句型结构', () => {
    expect(p).toContain('禁止使用 $...$ LaTeX');
    expect(p).toContain('formula 字段放的是英语句型结构');
  });
  it('例句要英文 + 中文翻译', () => {
    expect(p).toMatch(/英文例句/);
    expect(p).toContain('中文翻译');
  });
  it('仍然保持可 JSON.parse 且不泄题', () => {
    expect(p).toContain('JSON.parse');
    expect(p).toContain('不要输出本题答案');
  });
});

describe('其余学科：一个字都不能变（回归保护）', () => {
  it('解析仍是原来的理科口径', () => {
    for (const s of ['math', 'computer', 'politics', '', undefined]) {
      const p = explain(s);
      expect(p).toContain('完整分步推导');
      expect(p).toContain(FMT_RULE);
      expect(p).not.toContain('中英对照');
    }
  });
  it('知识卡片仍要求 LaTeX 公式', () => {
    const p = concept('math');
    expect(p).toContain('用 $...$ 包裹的 LaTeX');
    expect(p).not.toContain('定语从句');
  });
  it('math 和 computer 拿到的是同一份（没有意外分叉）', () => {
    expect(explain('math')).toBe(explain('computer'));
    expect(concept('math')).toBe(concept('politics'));
  });
});

describe('追问与阅读辅导', () => {
  it('英语追问也要求引用英文必附翻译', () => {
    const p = systemPrompt({ subject: 'english', ask: '这里为什么不选 B', concept: false, reading: false });
    expect(p).toContain('附中文翻译');
  });
  it('非英语追问保持原文案', () => {
    const p = systemPrompt({ subject: 'math', ask: '再讲讲第二步', concept: false, reading: false });
    expect(p).toContain(FMT_RULE);
    expect(p).not.toContain('附中文翻译');
  });
  it('reading 模式与学科无关，英语也走教材辅导那条', () => {
    const a = systemPrompt({ subject: 'english', ask: '这段讲什么', reading: true });
    const b = systemPrompt({ subject: 'math', ask: '这段讲什么', reading: true });
    expect(a).toBe(b);
    expect(a).toContain('阅读教材/资料');
  });
});
