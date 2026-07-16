// AI 模型列表代理（functions/api/aimodels.js）——桩掉 global.fetch，不联网
import { describe, it, expect, afterEach, vi } from 'vitest';
import { onRequestPost as aimodels } from '../functions/api/aimodels.js';
import { authedReq, makeEnv, FakeDB } from './helpers.mjs';

const call = (body, env = makeEnv(new FakeDB())) =>
  aimodels({ request: authedReq('http://x/api/aimodels', { method: 'POST', body: JSON.stringify(body) }), env });

function stubFetch(handler) { global.fetch = vi.fn(handler); }
afterEach(() => { vi.restoreAllMocks(); });

const okResp = (obj) => ({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });

describe('aimodels 安全守卫', () => {
  it('填了 base 没填 key → 400，且不发起任何请求', async () => {
    stubFetch(() => { throw new Error('不该被调用'); });
    const res = await call({ base_url: 'https://relay.example/v1' });
    expect(res.status).toBe(400);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('base 非 https → 400', async () => {
    const res = await call({ base_url: 'http://relay.example/v1', api_key: 'sk-x' });
    expect(res.status).toBe(400);
  });
  it('既无自定义 base、服务端也没配 → 400', async () => {
    const res = await call({});
    expect(res.status).toBe(400);
  });
});

describe('aimodels 请求构造与归一化', () => {
  it('base 已含 /v1 → 拼 /models；带 Bearer 头', async () => {
    let seenUrl, seenAuth;
    stubFetch((url, opt) => { seenUrl = url; seenAuth = opt.headers.authorization; return okResp({ data: [{ id: 'gpt-4o' }] }); });
    const res = await call({ base_url: 'https://relay.example/v1', api_key: 'sk-abc' });
    expect(seenUrl).toBe('https://relay.example/v1/models');
    expect(seenAuth).toBe('Bearer sk-abc');
    expect((await res.json()).models).toEqual(['gpt-4o']);
  });
  it('base 缺 /v1 → 自动补 /v1/models', async () => {
    let seenUrl;
    stubFetch((url) => { seenUrl = url; return okResp({ data: [{ id: 'm' }] }); });
    await call({ base_url: 'https://relay.example', api_key: 'sk-abc' });
    expect(seenUrl).toBe('https://relay.example/v1/models');
  });
  it('OpenAI 风格 { data:[{id}] }：去重 + 排序', async () => {
    stubFetch(() => okResp({ data: [{ id: 'zeta' }, { id: 'alpha' }, { id: 'alpha' }] }));
    expect((await (await call({ base_url: 'https://r/v1', api_key: 'k' })).json()).models).toEqual(['alpha', 'zeta']);
  });
  it('兼容直接返回数组 / { models:[...] } / 字符串数组', async () => {
    stubFetch(() => okResp(['b', 'a']));
    expect((await (await call({ base_url: 'https://r/v1', api_key: 'k' })).json()).models).toEqual(['a', 'b']);
    stubFetch(() => okResp({ models: [{ name: 'x-model' }] }));
    expect((await (await call({ base_url: 'https://r/v1', api_key: 'k' })).json()).models).toEqual(['x-model']);
  });
  it('服务端已配 AI_BASE_URL/AI_API_KEY，用户只点拉取（不带自定义）→ 用服务端配置', async () => {
    let seenUrl, seenAuth;
    stubFetch((url, opt) => { seenUrl = url; seenAuth = opt.headers.authorization; return okResp({ data: [{ id: 'srv' }] }); });
    const env = { DB: new FakeDB(), APP_TOKEN: 'testtoken', AI_BASE_URL: 'https://srv.example/v1', AI_API_KEY: 'sk-srv' };
    await call({}, env);
    expect(seenUrl).toBe('https://srv.example/v1/models');
    expect(seenAuth).toBe('Bearer sk-srv');
  });
});

describe('aimodels 上游错误映射', () => {
  it('上游 401 → 502 且提示 Key 问题', async () => {
    stubFetch(() => ({ ok: false, status: 401, text: async () => 'unauthorized' }));
    const res = await call({ base_url: 'https://r/v1', api_key: 'bad' });
    expect(res.status).toBe(502);
    expect((await res.json()).error).toMatch(/401/);
  });
  it('上游 404 → 提示可能不支持 /v1/models', async () => {
    stubFetch(() => ({ ok: false, status: 404, text: async () => 'not found' }));
    expect((await (await call({ base_url: 'https://r/v1', api_key: 'k' })).json()).error).toMatch(/不支持/);
  });
  it('列表为空 → 502', async () => {
    stubFetch(() => okResp({ data: [] }));
    expect((await call({ base_url: 'https://r/v1', api_key: 'k' })).status).toBe(502);
  });
  it('连接异常 → 502', async () => {
    stubFetch(() => { throw new Error('ECONNREFUSED'); });
    expect((await call({ base_url: 'https://r/v1', api_key: 'k' })).status).toBe(502);
  });
});
