// 鉴权限速（functions/api/_utils.js 的 checkAuth）：
//   正确口令零 DB 开销；错误路径内存计数、只在 3/10/20 三个阈值同步 D1；封禁判断内存直断。
// 注意：内存计数是模块级 Map，各用例用不同 cf-connecting-ip 隔离。
import { describe, it, expect } from 'vitest';
import { checkAuth } from '../functions/api/_utils.js';
import { FakeDB, TOKEN } from './helpers.mjs';

const req = (tok, ip) => new Request('http://x/api/q', { headers: { authorization: 'Bearer ' + tok, 'cf-connecting-ip': ip } });
const env = (db) => ({ APP_TOKEN: TOKEN, DB: db });

describe('checkAuth 口令限速', () => {
  it('口令正确：直接放行，零 DB 操作', async () => {
    const db = new FakeDB();
    const r = await checkAuth(req(TOKEN, 'ip-ok'), env(db));
    expect(r.ok).toBe(true);
    expect(db.log.length).toBe(0);
  });

  it('连错 3 次：首错读一次 D1 兜历史，仅第 3 次写库（写入绝对值 n=3）', async () => {
    const db = new FakeDB([{ match: /SELECT n, ts FROM auth_fails/, value: null }]);
    for (let i = 0; i < 3; i++) {
      const r = await checkAuth(req('wrong', 'ip-x3'), env(db));
      expect(r.ok).toBe(false);
      expect(r.resp.status).toBe(401);
    }
    expect(db.stmts(/SELECT n, ts FROM auth_fails/).length).toBe(1);
    const ins = db.stmts(/INSERT INTO auth_fails/);
    expect(ins.length).toBe(1);
    expect(ins[0].binds[1]).toBe(3);
  });

  it('错满 20 次进入封禁：第 20 次即 429；封禁期内请求零 DB 开销；全程只写 3/10/20 三次', async () => {
    const db = new FakeDB([{ match: /SELECT n, ts FROM auth_fails/, value: null }]);
    let last = null;
    for (let i = 0; i < 20; i++) last = await checkAuth(req('wrong', 'ip-burst'), env(db));
    expect(last.resp.status).toBe(429);
    const before = db.log.length;
    const r = await checkAuth(req('wrong', 'ip-burst'), env(db));
    expect(r.resp.status).toBe(429);
    expect(db.log.length).toBe(before);
    expect(db.stmts(/INSERT INTO auth_fails/).length).toBe(3);
  });

  it('跨 isolate 兜底：D1 里窗口内已有 19 次 → 本机首错即封禁并同步写库', async () => {
    const now = Math.floor(Date.now() / 1000);
    const db = new FakeDB([{ match: /SELECT n, ts FROM auth_fails/, value: { n: 19, ts: now } }]);
    const r = await checkAuth(req('wrong', 'ip-cross'), env(db));
    expect(r.resp.status).toBe(429);
    expect(db.stmts(/INSERT INTO auth_fails/).length).toBe(1);
    expect(db.stmts(/INSERT INTO auth_fails/)[0].binds[1]).toBe(20);
  });

  it('D1 记录已过窗口（15 分钟前）→ 不计入，本次按第 1 次错处理', async () => {
    const stale = Math.floor(Date.now() / 1000) - 1000;
    const db = new FakeDB([{ match: /SELECT n, ts FROM auth_fails/, value: { n: 19, ts: stale } }]);
    const r = await checkAuth(req('wrong', 'ip-stale'), env(db));
    expect(r.resp.status).toBe(401);
    expect(db.stmts(/INSERT INTO auth_fails/).length).toBe(0);   // n=1 未到阈值不写
  });

  it('封禁中的 IP 用正确口令依然放行（真用户不被攻击者锁死）', async () => {
    const db = new FakeDB([{ match: /SELECT n, ts FROM auth_fails/, value: null }]);
    for (let i = 0; i < 20; i++) await checkAuth(req('wrong', 'ip-recover'), env(db));
    const ok = await checkAuth(req(TOKEN, 'ip-recover'), env(db));
    expect(ok.ok).toBe(true);
  });
});
