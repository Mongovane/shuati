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
// 设计（v48 起）：
//   · 正确口令：零 DB 开销（不读不写限速表）
//   · 错误口令：先记内存（isolate 级 Map），只在累计 3 / 10 / 20 次这三个阈值同步到 D1
//     —— 有人拿错口令狂刷时，每 IP 每窗口最多 3 次写，烧不动每日 10 万写配额
//   · 封禁判断：内存命中直接 429（零读）；未命中读一次 D1 兜跨 isolate 的历史失败
const RL_WINDOW = 900;   // 秒
const RL_MAX = 20;
const RL_SYNC_AT = new Set([3, 10, RL_MAX]);
const _rlMem = new Map(); // ip -> { n, ts }
function _rlMemGet(ip) {
  const now = Math.floor(Date.now() / 1000);
  const r = _rlMem.get(ip);
  if (r && now - r.ts >= RL_WINDOW) { _rlMem.delete(ip); return null; }
  return r || null;
}
function _rlMemSet(ip, n, ts) {
  _rlMem.set(ip, { n, ts });
  if (_rlMem.size > 500) { const k = _rlMem.keys().next().value; _rlMem.delete(k); } // 防内存无限涨
}

async function rlGet(env, ip) {
  try {
    return await env.DB.prepare(`SELECT n, ts FROM auth_fails WHERE ip = ?`).bind(ip).first();
  } catch (_) { return null; } // 表还不存在等情况：视为无记录
}
async function rlSync(env, ip, n) {
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS auth_fails (ip TEXT PRIMARY KEY, n INTEGER DEFAULT 0, ts INTEGER)`).run();
    await env.DB.prepare(
      `INSERT INTO auth_fails (ip, n, ts) VALUES (?, ?, unixepoch())
       ON CONFLICT(ip) DO UPDATE SET n = ?, ts = unixepoch()`
    ).bind(ip, n, n).run();
  } catch (_) {}
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

  // 口令正确：直接放行（不再像旧版那样每个请求都先读一次 auth_fails，省全站读放大）
  if (safeEqual(token, env.APP_TOKEN)) {
    if (_rlMem.has(ip)) _rlMem.delete(ip);
    return { ok: true };
  }

  // —— 以下是失败路径 ——
  const now = Math.floor(Date.now() / 1000);
  const mem = _rlMemGet(ip);
  if (mem && mem.n >= RL_MAX) {
    return { ok: false, resp: json({ error: '尝试次数过多，请约 15 分钟后再试' }, 429) };
  }
  // 内存没封：合并 D1 里跨 isolate 的历史失败数（窗口内）
  let base = mem ? mem.n : 0;
  if (env.DB && !mem) {
    const rl = await rlGet(env, ip);
    if (rl && now - (rl.ts || 0) < RL_WINDOW) base = Math.max(base, rl.n || 0);
    if (base >= RL_MAX) {
      _rlMemSet(ip, base, now);
      return { ok: false, resp: json({ error: '尝试次数过多，请约 15 分钟后再试' }, 429) };
    }
  }
  const n = base + 1;
  _rlMemSet(ip, n, mem ? mem.ts : now);
  if (env.DB && RL_SYNC_AT.has(n)) await rlSync(env, ip, n);
  if (n >= RL_MAX) {
    return { ok: false, resp: json({ error: '尝试次数过多，请约 15 分钟后再试' }, 429) };
  }
  return { ok: false, resp: json({ error: '未授权：请在「设置」里填写正确的访问口令' }, 401) };
}

// —— SRS / 日志相关的懒迁移：旧库自动补列建表，每个 isolate 只跑一次 ——
let _srsReady = false;
export async function ensureSrsSchema(env) {
  if (_srsReady || !env.DB) return;
  const alters = [
    `ALTER TABLE progress ADD COLUMN due_at INTEGER`,
    `ALTER TABLE progress ADD COLUMN interval_days REAL DEFAULT 0`,
    `ALTER TABLE progress ADD COLUMN ease REAL DEFAULT 2.5`,
    `ALTER TABLE answer_log ADD COLUMN duration_ms INTEGER`,   // 每题作答用时（毫秒，可空）
    `ALTER TABLE questions ADD COLUMN status TEXT`,            // 'draft' = AI 导入待审核；NULL/'ok' = 已发布
    `ALTER TABLE questions ADD COLUMN page INTEGER`,
    `ALTER TABLE mock_results ADD COLUMN score REAL`,          // 多选半分制得分（可空，旧记录无）
  ];
  for (const sql of alters) { try { await env.DB.prepare(sql).run(); } catch (_) { /* duplicate column：已存在 */ } }
  try { await env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_pr_due ON progress(due_at)`).run(); } catch (_) {}
  try {
    await env.DB.prepare(`CREATE TABLE IF NOT EXISTS answer_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id TEXT,
      is_correct INTEGER,
      duration_ms INTEGER,
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

// —— FTS5 全文检索（trigram 分词，支持中文子串）——
// 免费额度设计：
//   · 外部内容表（content='questions'）：索引不重复存正文，只存 trigram posting，省 D1 存储
//   · 首次搜索时才建表 + rebuild 回填一次（读全表一次，之后由触发器增量维护，不再全表扫）
//   · 平台不支持 trigram / FTS5 时优雅降级：标记 'no'，调用方回退 LIKE
// 'unknown' | 'ok' | 'no'
let _ftsState = 'unknown';
export async function ensureFts(env) {
  if (_ftsState !== 'unknown' || !env.DB) return _ftsState;
  try {
    const t = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='questions_fts'`
    ).first();
    if (!t) {
      await env.DB.prepare(
        `CREATE VIRTUAL TABLE questions_fts USING fts5(stem, analysis, chapter,
           content='questions', content_rowid='rowid', tokenize='trigram')`
      ).run();
    }
    // 触发器幂等创建（表已存在也补齐，防止半初始化状态）
    await env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS trg_qfts_i AFTER INSERT ON questions BEGIN
      INSERT INTO questions_fts(rowid, stem, analysis, chapter) VALUES (new.rowid, new.stem, new.analysis, new.chapter); END`).run();
    await env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS trg_qfts_d AFTER DELETE ON questions BEGIN
      INSERT INTO questions_fts(questions_fts, rowid, stem, analysis, chapter) VALUES('delete', old.rowid, old.stem, old.analysis, old.chapter); END`).run();
    await env.DB.prepare(`CREATE TRIGGER IF NOT EXISTS trg_qfts_u AFTER UPDATE ON questions BEGIN
      INSERT INTO questions_fts(questions_fts, rowid, stem, analysis, chapter) VALUES('delete', old.rowid, old.stem, old.analysis, old.chapter);
      INSERT INTO questions_fts(rowid, stem, analysis, chapter) VALUES (new.rowid, new.stem, new.analysis, new.chapter); END`).run();
    if (!t) {
      // 一次性回填已有题目（老库升级路径）；之后全靠触发器增量同步
      await env.DB.prepare(`INSERT INTO questions_fts(questions_fts) VALUES('rebuild')`).run();
    }
    _ftsState = 'ok';
  } catch (_) {
    _ftsState = 'no'; // FTS5/trigram 不可用：调用方回退 LIKE，功能不受影响
  }
  return _ftsState;
}

// FTS5 关键词安全引用：整词短语匹配，防注入查询语法
export function ftsQuote(kw) {
  return '"' + String(kw).replace(/"/g, '""') + '"';
}

// —— 大批量语句分块提交：D1 单次 batch 语句数有限，超大导入/恢复按块跑 ——
// 注意：跨块不再是单事务；调用方需保证语句幂等（UPSERT / OR REPLACE）
export async function batchChunked(env, stmts, size = 80) {
  for (let i = 0; i < stmts.length; i += size) {
    await env.DB.batch(stmts.slice(i, i + size));
  }
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
