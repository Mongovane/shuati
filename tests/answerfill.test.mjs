// AI 补答案：只返回建议、不写库；前端落库一律标 status='draft' 走待审流程。
// 关键守卫：依赖插图的题必须跳过而不是硬编答案（插图已转存 R2，提示词里模型看不到图）。
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { FakeDB, authedReq, makeEnv, ROOT } from './helpers.mjs';
import { onRequestPost as answerFill } from '../functions/api/answerfill.js';

const env = (extra) => Object.assign(makeEnv(new FakeDB([])), { AI_BASE_URL: 'https://ai.example.com/v1', AI_API_KEY: 'k', AI_MODEL: 'm' }, extra || {});
const req = (body) => authedReq('http://x/api/answerfill', { method: 'POST', body: JSON.stringify(body) });

let sent = [];
function mockAI(content, ok = true, status = 200) {
  global.fetch = async (url, opt) => {
    sent.push({ url, body: JSON.parse(opt.body), auth: opt.headers.authorization });
    return { ok, status, json: async () => ({ choices: [{ message: { content } }] }), text: async () => 'err' };
  };
}
beforeEach(() => { sent = []; });

const Q = (over) => Object.assign({ id: 'q1', type: 'short_answer', stem: '求 $\\lim_{x\\to0}\\frac{\\sin x}{x}$.' }, over || {});

describe('基本行为', () => {
  it('返回规范化后的答案，不碰数据库', async () => {
    mockAI(JSON.stringify({ items: [{ id: 'q1', answer: ['原式 $=1$'], analysis: '等价无穷小' }] }));
    const db = new FakeDB([]);
    const res = await answerFill({ request: req({ questions: [Q()] }), env: Object.assign(env(), { DB: db }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.items).toEqual([{ id: 'q1', answer: ['原式 $=1$'], analysis: '等价无穷小' }]);
    expect(db.log.length).toBe(0);                      // 不写库
    expect(sent[0].body.response_format).toEqual({ type: 'json_object' });
  });

  it('选择题答案只留合法选项字母（复用 normalizeAnswer）', async () => {
    mockAI(JSON.stringify({ items: [{ id: 'q1', answer: ['b'] }] }));
    const q = Q({ type: 'single_choice', options: [{ key: 'A', text: '甲' }, { key: 'B', text: '乙' }] });
    const body = await (await answerFill({ request: req({ questions: [q] }), env: env() })).json();
    expect(body.items[0].answer).toEqual(['B']);
  });

  it('单选给了多个答案时只取第一个并带 warn', async () => {
    mockAI(JSON.stringify({ items: [{ id: 'q1', answer: ['A', 'C'] }] }));
    const q = Q({ type: 'single_choice', options: [{ key: 'A', text: '甲' }, { key: 'C', text: '丙' }] });
    const body = await (await answerFill({ request: req({ questions: [q] }), env: env() })).json();
    expect(body.items[0].answer).toEqual(['A']);
    expect(body.items[0].warn).toBeTruthy();
  });

  it('判断题归一成 T / F', async () => {
    mockAI(JSON.stringify({ items: [{ id: 'q1', answer: ['正确'] }] }));
    const body = await (await answerFill({ request: req({ questions: [Q({ type: 'true_false' })] }), env: env() })).json();
    expect(body.items[0].answer).toEqual(['T']);
  });
});

describe('不许硬编：依赖插图 / 题干不全要跳过', () => {
  it('模型给了 skip 就如实返回空答案 + 原因', async () => {
    mockAI(JSON.stringify({ items: [{ id: 'q1', answer: [], skip: '依赖插图' }] }));
    const body = await (await answerFill({ request: req({ questions: [Q({ stem: '对图 1-9 所示的函数，下列哪些对？' })] }), env: env() })).json();
    expect(body.items[0].answer).toEqual([]);
    expect(body.items[0].skip).toBe('依赖插图');
  });

  it('模型没给答案也没给 skip 时，补一个 skip 原因，不留空壳', async () => {
    mockAI(JSON.stringify({ items: [{ id: 'q1', answer: [] }] }));
    const body = await (await answerFill({ request: req({ questions: [Q()] }), env: env() })).json();
    expect(body.items[0].answer).toEqual([]);
    expect(body.items[0].skip).toBeTruthy();
  });

  it('题干里的图片链接换成占位，不让模型误以为看得到图', async () => {
    mockAI(JSON.stringify({ items: [{ id: 'q1', answer: ['x'] }] }));
    await answerFill({ request: req({ questions: [Q({ stem: '看图 ![](/api/qimg?k=qimg/a.png) 求值' })] }), env: env() });
    const prompt = sent[0].body.messages[1].content;
    expect(prompt).not.toContain('qimg/a.png');
    expect(prompt).toContain('未提供');
  });

  it('提示词明确要求依赖插图时返回 skip', () => {
    const src = fs.readFileSync(path.join(ROOT, 'functions/api/answerfill.js'), 'utf8');
    expect(src).toMatch(/不要猜/);
    expect(src).toMatch(/skip/);
  });
});

describe('防串号与容错', () => {
  it('模型编造的 id 被丢掉，缺的 id 报在 missing 里', async () => {
    mockAI(JSON.stringify({ items: [{ id: '不存在', answer: ['x'] }, { id: 'q1', answer: ['y'] }] }));
    const body = await (await answerFill({ request: req({ questions: [Q(), Q({ id: 'q2' })] }), env: env() })).json();
    expect(body.items.map((i) => i.id)).toEqual(['q1']);
    expect(body.missing).toEqual(['q2']);
  });

  it('裹了 ``` 围栏 / 直接返回数组都能解析', async () => {
    mockAI('```json\n[{"id":"q1","answer":["ok"]}]\n```');
    const body = await (await answerFill({ request: req({ questions: [Q()] }), env: env() })).json();
    expect(body.items[0].answer).toEqual(['ok']);
  });

  it('解析不出任何条目时报 422 并回传原文片段', async () => {
    mockAI('我不知道');
    const res = await answerFill({ request: req({ questions: [Q()] }), env: env() });
    expect(res.status).toBe(422);
    expect((await res.json()).raw).toContain('我不知道');
  });

  it('一次最多 8 题', async () => {
    mockAI(JSON.stringify({ items: [] }));
    const qs = Array.from({ length: 20 }, (_, i) => Q({ id: 'q' + i }));
    await answerFill({ request: req({ questions: qs }), env: env() }).catch(() => {});
    expect(sent[0].body.messages[1].content).toContain('8 道题');
  });

  it('没有题干的条目被过滤掉；全空报 400', async () => {
    mockAI(JSON.stringify({ items: [] }));
    const res = await answerFill({ request: req({ questions: [{ id: 'a', stem: '  ' }, { stem: 'x' }] }), env: env() });
    expect(res.status).toBe(400);
  });
});

describe('中转站安全守卫（与 explain / visionocr 一致）', () => {
  it('自带 base_url 却不带 api_key → 400，绝不拿服务端密钥去打别人家', async () => {
    const res = await answerFill({ request: req({ questions: [Q()], base_url: 'https://x.com/v1' }), env: env() });
    expect(res.status).toBe(400);
  });

  it('自带 base_url 必须 https', async () => {
    const res = await answerFill({ request: req({ questions: [Q()], base_url: 'http://x.com/v1', api_key: 'k' }), env: env() });
    expect(res.status).toBe(400);
  });

  it('自带中转站时用的是自带的 key，而不是服务端的', async () => {
    mockAI(JSON.stringify({ items: [{ id: 'q1', answer: ['x'] }] }));
    await answerFill({ request: req({ questions: [Q()], base_url: 'https://mine.com/v1', api_key: 'MYKEY' }), env: env() });
    expect(sent[0].url).toBe('https://mine.com/v1/chat/completions');
    expect(sent[0].auth).toBe('Bearer MYKEY');
  });

  it('完全没配 AI → 400 且给出配置指引', async () => {
    const res = await answerFill({ request: req({ questions: [Q()] }), env: makeEnv(new FakeDB([])) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/AI_BASE_URL/);
  });
});

describe('前端：落库标草稿、跳过不落库', () => {
  const Bank = new Function(fs.readFileSync(path.join(ROOT, 'js/views/bank.js'), 'utf8') + ';return BankMixin;')();

  function ctx(items, aiResp) {
    const calls = [];
    return Object.assign(Object.create(Bank.methods), {
      calls, flashes: [], token: 't', offline: false,
      bank: { items, sel: [] },
      bankAiFill: { busy: false, prog: '' },
      aiOv: () => ({}),
      flash(m, bad) { this.flashes.push([m, !!bad]); },
      async api(p, o) { const body = JSON.parse((o && o.body) || '{}'); calls.push({ p, body }); return p === '/api/answerfill' ? aiResp : { ok: true }; },
    });
  }

  it('有答案的落库时带 status=draft，并就地更新本页', async () => {
    global.confirm = () => true;
    const items = [{ id: 'q1', type: 'short_answer', stem: 's', answer: [] }];
    const c = ctx(items, { items: [{ id: 'q1', answer: ['A1'], analysis: '思路' }] });
    await Bank.methods.bankAiFillAnswers.call(c);
    const patch = c.calls.find((x) => x.p === '/api/questions');
    expect(patch.body).toMatchObject({ ids: ['q1'], answer: ['A1'], analysis: '思路', status: 'draft' });
    expect(items[0].answer).toEqual(['A1']);
    expect(items[0].status).toBe('draft');
    expect(c.flashes[0][0]).toMatch(/已补 1 题/);
    expect(c.flashes[0][0]).toMatch(/待审/);
  });

  it('被跳过的题不发 PATCH，计入 skipped 并在提示里说明', async () => {
    global.confirm = () => true;
    const items = [{ id: 'q1', type: 'short_answer', stem: 's', answer: [] }];
    const c = ctx(items, { items: [{ id: 'q1', answer: [], skip: '依赖插图' }] });
    await Bank.methods.bankAiFillAnswers.call(c);
    expect(c.calls.filter((x) => x.p === '/api/questions').length).toBe(0);
    expect(items[0].answer).toEqual([]);
    expect(c.flashes[0][0]).toMatch(/跳过 1 题/);
  });

  it('只挑没答案的题，已有答案的不送去花钱', async () => {
    global.confirm = () => true;
    const items = [{ id: 'a', answer: ['有'] }, { id: 'b', answer: [] }, { id: 'c', answer: [] }];
    const c = ctx(items, { items: [] });
    await Bank.methods.bankAiFillAnswers.call(c);
    const ids = c.calls.find((x) => x.p === '/api/answerfill').body.questions.map((q) => q.id);
    expect(ids).toEqual(['b', 'c']);
  });

  it('有勾选时只处理勾选中缺答案的题', async () => {
    global.confirm = () => true;
    const items = [{ id: 'a', answer: [] }, { id: 'b', answer: [] }];
    const c = ctx(items, { items: [] });
    c.bank.sel = ['b'];
    await Bank.methods.bankAiFillAnswers.call(c);
    expect(c.calls.find((x) => x.p === '/api/answerfill').body.questions.map((q) => q.id)).toEqual(['b']);
  });

  it('取消确认不发请求；离线直接拒绝', async () => {
    global.confirm = () => false;
    const c = ctx([{ id: 'a', answer: [] }], { items: [] });
    await Bank.methods.bankAiFillAnswers.call(c);
    expect(c.calls.length).toBe(0);

    global.confirm = () => true;
    const c2 = ctx([{ id: 'a', answer: [] }], { items: [] });
    c2.offline = true;
    await Bank.methods.bankAiFillAnswers.call(c2);
    expect(c2.calls.length).toBe(0);
  });

  it('本页没有缺答案的题时提示并且不花钱', async () => {
    global.confirm = () => true;
    const c = ctx([{ id: 'a', answer: ['有'] }], { items: [] });
    await Bank.methods.bankAiFillAnswers.call(c);
    expect(c.calls.length).toBe(0);
    expect(c.flashes[0][1]).toBe(true);
  });

  it('结束后复位 busy，按钮不会卡死', async () => {
    global.confirm = () => true;
    const c = ctx([{ id: 'a', answer: [] }], { items: [] });
    await Bank.methods.bankAiFillAnswers.call(c);
    expect(c.bankAiFill.busy).toBe(false);
  });
});
