// token 用量可观测。
//
// 起因：我把「推理占满了 token 预算」当成结论说了出去，但代码从来没有读过 usage,
// 这个判断纯属推断。而 reasoning token 到底算不算进输出上限，各家实现不一样：
//   · OpenAI o 系列：reasoning 按 output token 计费，且计入 completion 预算
//     （正是为此把 max_tokens 换成了 max_completion_tokens）
//   · DeepSeek 官方 reasoner：max_tokens 只约束 CoT 之后的最终回答，CoT 另有额度
//   · 走中转站时取决于它怎么翻译字段，无法预设
// 所以别猜，把数字摆出来。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const QC = new Function('RichText', read('js/constants.js') + '\n' + read('js/components/question-card.js') + '\nreturn QuestionCard;')({});
const card = (aiUsage) => {
  const self = { aiUsage };
  for (const k of ['usageText', 'usageTitle']) Object.defineProperty(self, k, { get() { return QC.computed[k].call(self); } });
  return self;
};

describe('用量小标的文案', () => {
  it('推理吃掉大头时一眼能看出来', () => {
    expect(card({ prompt: 900, completion: 8192, reasoning: 7900, rounds: 2 }).usageText)
      .toBe('输出 8.2k（推理 7.9k） · 2 轮');
  });
  it('非推理模型只显示输出量', () => {
    expect(card({ prompt: 900, completion: 1200, reasoning: 0, rounds: 1 }).usageText).toBe('输出 1.2k');
  });
  it('单轮不显示轮数（少一个噪声）', () => {
    expect(card({ completion: 500, rounds: 1 }).usageText).not.toContain('轮');
  });
  it('中转站不返回用量时整块不显示，而不是显示 0', () => {
    expect(card({ prompt: 900, completion: 0, reasoning: 0, rounds: 1 }).usageText).toBe('');
    expect(card(null).usageText).toBe('');
    expect(card(undefined).usageText).toBe('');
  });
  it('tooltip 给出明细，并注明「算不算上限取决于服务商」', () => {
    const t = card({ prompt: 900, completion: 8192, reasoning: 7900, rounds: 2 }).usageTitle;
    expect(t).toContain('输入 900 token');
    expect(t).toContain('其中推理 7900 token');
    expect(t).toContain('取决于服务商');
  });
});

describe('服务端要主动索取用量', () => {
  const src = read('functions/api/explain.js');
  it('流式请求带 stream_options.include_usage', () => {
    expect(src).toContain('stream_options: { include_usage: true }');
  });
  it('只在流式时带，非流式请求体不变', () => {
    expect(src).toMatch(/stream \? \{ \.\.\.payload, stream, stream_options/);
  });
  it('非流式的两个返回也带 usage', () => {
    expect(src.match(/usage: \(d && d\.usage\) \|\| null/g)).toHaveLength(2);
  });
});

describe('客户端解析用量：字段名各家不同，要全收', () => {
  const src = read('js/app.js');
  it('兼容 prompt_tokens / input_tokens', () => {
    expect(src).toContain('u.prompt_tokens ?? u.input_tokens');
  });
  it('兼容 completion_tokens / output_tokens', () => {
    expect(src).toContain('u.completion_tokens ?? u.output_tokens');
  });
  it('推理 token 从 completion_tokens_details 里取（OpenAI o 系列的位置）', () => {
    expect(src).toContain('completion_tokens_details');
    expect(src).toContain('det.reasoning_tokens');
  });
  it('流式和非流式两条路都解析', () => {
    expect(src.match(/onDelta\(\{ usage:\{/g)).toHaveLength(2);
  });
});

describe('用量按题累加、切题重置', () => {
  const src = read('js/views/practice.js');
  it('多轮（含续写）累加而不是覆盖', () => {
    expect(src).toContain("(a.completion||0)+(u.completion||0)");
    expect(src).toContain("rounds:(a.rounds||0)+1");
  });
  // usage 现在按视图分两个字段（usage / cardsUsage），和 model / cardsModel 一致
  it('开始新生成时清零对应视图的用量', () => {
    expect(src).toContain('this.aiX[UK]=null;');
    expect(src).toContain("const UK=isConcept?'cardsUsage':'usage';");
  });
  it('切题时 aiX 重建把两个视图的用量都清空', () => {
    const app = read('js/app.js');
    expect(app).toContain('usage:null, cardsUsage:null }');
  });
  it('思维链也按视图分开，否则切回解析会看到卡片那次的推理', () => {
    const app = read('js/app.js');
    expect(app).toContain("this.aiX.view==='concept' ? (this.aiX.cardsReasoning||'')");
    expect(app).toContain('curAiUsage()');
  });
  it('失败提示带上实际用量，不再空口断言原因', () => {
    expect(src).toContain('本次用量：输出');
    expect(src).not.toContain('模型一直在推理');
  });
});

describe('诊断文案不能把推断当结论', () => {
  const src = read('js/views/practice.js');
  it('不再声称「推理占满了 token 预算」', () => {
    expect(src).not.toContain('推理占满');
  });
  it('只陈述可观测事实：正文为空 + 已达输出上限', () => {
    expect(src).toContain('只输出了推理、正文为空（已达输出上限）');
  });
});

describe('输出预算：按实测的推理量重新分配', () => {
  const src = read('functions/api/explain.js');
  // 实测 deepseek-v4-flash 一次推理 5.4K，而它算进 completion_tokens。
  // 旧值 ask=4096 比推理量本身还小 → 追问必然空输出；concept=6000 只剩 0.6K 写 JSON。
  const budgets = () => {
    const m = src.match(/max_tokens: capOut\(ask \? (\d+) : \(concept \? (\d+) : \(\(contFrom \|\| b\.continue_kickoff\) \? (\d+) : (\d+)\)\)\)/);
    expect(m).toBeTruthy();
    const [, ask, concept, cont, first] = m.map(Number);
    return { ask, concept, cont, first };
  };
  it('追问的预算必须明显大于典型推理量（旧值 4096 是必然失败的）', () => {
    expect(budgets().ask).toBeGreaterThanOrEqual(10000);
  });
  it('知识点卡片同理（要留出写完整 JSON 的空间）', () => {
    expect(budgets().concept).toBeGreaterThanOrEqual(10000);
  });
  it('解题解析是最长的场景，预算最大', () => {
    const b = budgets();
    expect(b.first).toBeGreaterThanOrEqual(b.ask);
    expect(b.first).toBeGreaterThanOrEqual(b.concept);
  });
  it('用户覆盖值被钳在合理区间，避免设成 100 或 999999', () => {
    expect(src).toContain('Math.min(32000, Math.max(1024, ovMax))');
  });
  it('传 0 / 不传就用默认值', () => {
    expect(src).toContain('ovMax > 0 ?');
  });
  it('上游嫌值太大时自动降档一次，而不是把错误甩给用户', () => {
    expect(src).toContain('tooLarge');
    expect(src).toContain('Math.max(4096, Math.floor(outCap / 2))');
  });
});

describe('设置项接线', () => {
  it('explainCfg 有 maxTokens 字段', () => {
    expect(read('js/app.js')).toContain("model:'', maxTokens:0 }");
  });
  it('aiOv 把它带进每个 AI 请求', () => {
    expect(read('js/app.js')).toContain('o.max_tokens=Math.floor(Number(e.maxTokens))');
  });
  it('practice 统一走 aiOv，不再各处内联拼 ov（否则新增字段必漏）', () => {
    const src = read('js/views/practice.js');
    expect(src).not.toContain('{base_url:this.explainCfg.base,api_key:this.explainCfg.key}');
    expect(src.match(/const ov=this\.aiOv\(\);/g)).toHaveLength(2);
  });
  it('设置界面有这个输入框', () => {
    expect(read('js/tpl/view-settings.js')).toContain('explainCfg.maxTokens');
  });
});
