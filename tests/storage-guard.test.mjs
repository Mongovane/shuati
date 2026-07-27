// 存储保护：接近 5GB 免费上限时拒绝导入
import { describe, it, expect } from 'vitest';
import { FakeDB, authedReq, makeEnv } from './helpers.mjs';

describe('存储用量估算与阈值', () => {
  it('checkStorage: 用量低时不阻止', async () => {
    const { checkStorage } = await import('../functions/api/_utils.js');
    const sc = await checkStorage(makeEnv(new FakeDB()), 0);
    expect(sc.blocked).toBe(false);
    expect(sc.limit).toBe(5 * 1024 * 1024 * 1024);
  });
  it('导出的阈值常量正确（block < limit，warn < block）', async () => {
    const { STORAGE_LIMIT, STORAGE_BLOCK, STORAGE_WARN } = await import('../functions/api/_utils.js');
    expect(STORAGE_BLOCK).toBeLessThan(STORAGE_LIMIT);
    expect(STORAGE_WARN).toBeLessThan(STORAGE_BLOCK);
    expect(STORAGE_LIMIT).toBe(5 * 1024 * 1024 * 1024);
  });
  it('materials 批量导入：用量低时正常插入（不被拦）', async () => {
    const { onRequestPost } = await import('../functions/api/materials.js');
    const db = new FakeDB();
    const items = [{ subject: 'math', title: 't', content_md: 'c', page: 1 }];
    const res = await onRequestPost({ request: authedReq('http://x/api/materials', { method: 'POST', body: JSON.stringify({ items }) }), env: makeEnv(db) });
    expect(res.status).toBe(200); // 用量估算为0，不拦
  });
  it('storage 查询接口返回用量与百分比', async () => {
    const { onRequestGet } = await import('../functions/api/storage.js');
    const db = new FakeDB();
    const res = await onRequestGet({ request: authedReq('http://x/api/storage'), env: makeEnv(db) });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d).toHaveProperty('used');
    expect(d).toHaveProperty('limit');
    expect(d).toHaveProperty('pct');
  });
});
