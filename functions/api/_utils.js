// 公共工具。文件名以 _ 开头，不会被注册成路由。

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

// —— 恒定时间字符串比较：无论在第几位不同都跑满全长，防计时侧信道 ——
function safeEqual(a, b) {
  a = String(a); b = String(b);
  const len = Math.max(a.length, b.length, 1);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// —— 口令爆破限速：同一 IP 15 分钟内错 20 次即拒绝（429）——
const RL_WINDOW = 900;   // 秒
const RL_MAX = 20;

async function rlGet(env, ip) {
  try {
    return await env.DB.prepare(`SELECT n, ts FROM auth_fails WHERE ip = ?`).bind(ip).first();
  } catch (_) { return null; } // 表还不存在等情况：视为无记录
}
async function rlBump(env, ip) {
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS auth_fails (ip TEXT PRIMARY KEY, n INTEGER DEFAULT 0, ts INTEGER)`).run();
    await env.DB.prepare(
      `INSERT INTO auth_fails (ip, n, ts) VALUES (?, 1, unixepoch())
       ON CONFLICT(ip) DO UPDATE SET
         n = CASE WHEN unixepoch() - ts < ${RL_WINDOW} THEN n + 1 ELSE 1 END,
         ts = unixepoch()`
    ).bind(ip).run();
  } catch (_) {}
}
async function rlClear(env, ip) {
  try { await env.DB.prepare(`DELETE FROM auth_fails WHERE ip = ?`).bind(ip).run(); } catch (_) {}
}

// 校验访问口令（APP_TOKEN）。前端在每次请求头里带 Authorization: Bearer <token>
// 注意：现在是 async，调用处需 await checkAuth(request, env)
export async function checkAuth(request, env) {
  if (!env.APP_TOKEN) {
    return { ok: false, resp: json({ error: '服务端未设置 APP_TOKEN，请在 Cloudflare 后台配置访问口令' }, 500) };
  }
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';

  const rl = env.DB ? await rlGet(env, ip) : null;
  const now = Math.floor(Date.now() / 1000);
  if (rl && rl.n >= RL_MAX && now - (rl.ts || 0) < RL_WINDOW) {
    return { ok: false, resp: json({ error: '尝试次数过多，请约 15 分钟后再试' }, 429) };
  }

  if (!safeEqual(token, env.APP_TOKEN)) {
    if (env.DB) await rlBump(env, ip);
    return { ok: false, resp: json({ error: '未授权：请在「设置」里填写正确的访问口令' }, 401) };
  }
  if (env.DB && rl && rl.n) await rlClear(env, ip);
  return { ok: true };
}

// —— SRS / 日志相关的懒迁移：旧库自动补列建表，每个 isolate 只跑一次 ——
let _srsReady = false;
export async function ensureSrsSchema(env) {
  if (_srsReady || !env.DB) return;
  const alters = [
    `ALTER TABLE progress ADD COLUMN due_at INTEGER`,
    `ALTER TABLE progress ADD COLUMN interval_days REAL DEFAULT 0`,
    `ALTER TABLE progress ADD COLUMN ease REAL DEFAULT 2.5`,
  ];
  for (const sql of alters) { try { await env.DB.prepare(sql).run(); } catch (_) { /* duplicate column：已存在 */ } }
  try { await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_pr_due ON progress(due_at)`).run(); } catch (_) {}
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS answer_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id TEXT,
      is_correct INTEGER,
      ts INTEGER DEFAULT (unixepoch())
    )`).run();
  } catch (_) {}
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS mock_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mock_id INTEGER,
      question_id TEXT,
      is_correct INTEGER
    )`).run();
    await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_ma_mock ON mock_answers(mock_id)`).run();
  } catch (_) {}
  _srsReady = true;
}

// 把数据库行还原成前端可用的题目对象
export function rowToQuestion(r) {
  const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
  return {
    id: r.id,
    subject: r.subject,
    chapter: r.chapter,
    type: r.type,
    difficulty: r.difficulty,
    source: r.source,
    page: r.page != null ? r.page : null,
    passage: r.passage || '',
    stem: r.stem,
    options: parse(r.options, []),
    answer: parse(r.answer, []),
    analysis: r.analysis || '',
    tags: parse(r.tags, []),
    wrong_count: r.wrong_count || 0,
    right_count: r.right_count || 0,
    favorited: !!r.favorited,
    mastered: !!r.mastered,
    due_at: r.due_at != null ? r.due_at : null,
    note: r.user_note || r.note || '',
  };
}
