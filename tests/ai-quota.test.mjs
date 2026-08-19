// 线上现象：解析和追问都报「Workspace allocated quota exceeded, please increase your quota limit.」
//
// 这条错误来自【中转站账号的配额】，不是本站的限制。用户以为「不设 max_tokens = 无限制」——
// 那只是去掉了【我们这边】的单次输出上限，中转站/模型厂商的账号额度还在。
// 而且去掉上限之后每次生成的 token 更多，反而烧得更快。
//
// 代码上有三个真问题要修：
//  ① 配额耗尽常以 429 返回 → 命中「限流重试」被反复打。重试不可能成功，还继续耗额度。
//  ② 自动续写会在失败后再发请求 —— 同理，只会再失败一次。
//  ③ 直接把英文原文甩给用户，没告诉他该去哪儿加额度。
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './helpers.mjs';

const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const app = read('js/app.js');

const pick = (name) => {
  const SIG = name + '(msg){';
  const i = app.indexOf(SIG);
  const st = i + SIG.length - 1;
  let d = 0, j = st;
  for (; j < app.length; j++) { if (app[j] === '{') d++; else if (app[j] === '}') { d--; if (!d) break; } }
  return eval('(function(msg)' + app.slice(st, j + 1) + ')');
};
const isQuota = pick('_isQuotaErr');
const quotaHint = pick('_quotaHint');

describe('配额错误的识别', () => {
  it('线上那条原文', () => {
    expect(isQuota('Workspace allocated quota exceeded, please increase your quota limit.')).toBe(true);
  });
  it('各家常见说法都认', () => {
    for (const m of ['Insufficient balance', 'You exceeded your current quota', '账户余额不足', '额度已用完', '配额不足', 'billing hard limit reached']) {
      expect(isQuota(m)).toBe(true);
    }
  });
  it('普通限流不能误判成配额（那个该重试）', () => {
    for (const m of ['429 Too Many Requests', 'rate limit exceeded', '当前分组上游负载已饱和']) {
      expect(isQuota(m)).toBe(false);
    }
  });
  it('网络错误、空值不误判', () => {
    for (const m of ['Failed to fetch', 'NetworkError', '', null, undefined]) expect(isQuota(m)).toBe(false);
  });
});

describe('提示要能照着做', () => {
  const t = quotaHint('Workspace allocated quota exceeded, please increase your quota limit.');
  it('点明这是中转站的配额，不是本站限制', () => {
    expect(t).toContain('中转站账号的配额');
    expect(t).toContain('不是本站的限制');
  });
  it('给出两条出路', () => {
    expect(t).toContain('加额度');
    expect(t).toMatch(/换一个还有额度的/);
  });
  it('保留原文供排查，但截断避免刷屏', () => {
    expect(t).toContain('Workspace allocated quota');
    expect(quotaHint('x'.repeat(500)).length).toBeLessThan(300);
  });
});

describe('配额耗尽时不能重试、不能续写', () => {
  it('题库 AI 补答案：配额错误排除在重试之外', () => {
    const src = read('js/views/bank.js');
    expect(src).toContain('const quota=this._isQuotaErr&&this._isQuotaErr((e&&e.message)||\'\');');
    expect(src).toMatch(/const retryable=!quota &&/);
  });
  it('插图转存：同样排除', () => {
    const src = read('js/views/ingest.js');
    expect(src).toMatch(/const retryable=!quota &&/);
  });
  it('解析的自动续写：配额错误直接跳出循环', () => {
    expect(read('js/views/practice.js')).toContain("if(this._isQuotaErr && this._isQuotaErr(r.errText||'' ))break;");
  });
  it('追问的自动续写：同样不继续', () => {
    expect(read('js/views/practice.js')).toMatch(/!\(this\._isQuotaErr && this\._isQuotaErr\(\(entry\.a\)\|\|''\)\)/);
  });
});

describe('服务端用 402 把配额和普通错误区分开', () => {
  const src = read('functions/api/explain.js');
  it('有独立的识别函数', () => {
    expect(src).toContain('const isQuota = (t) =>');
  });
  it('配额走 402，其余保持 502', () => {
    expect(src.match(/isQuota\(msg\) \? 402 : 502/g)).toHaveLength(2);
  });
  it('响应体带 quota 标记，前端不用再猜', () => {
    expect(src).toContain('quota: isQuota(msg)');
  });
});

describe('前端把配额错误单独呈现', () => {
  const src = read('js/views/practice.js');
  it('解析失败时给的是可操作提示，不是英文原文', () => {
    expect(src).toContain("throw new Error(this._quotaHint((r&&r.errText)||''));");
  });
  it('追问失败时同样', () => {
    expect(src).toContain("if(this._isQuotaErr && this._isQuotaErr(msg)){");
    expect(src).toContain("this.flash('AI 额度用完了',true)");
  });
});
