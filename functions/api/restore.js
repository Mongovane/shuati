import { json, checkAuth, ensureSrsSchema, batchChunked } from './_utils.js';

// POST /api/restore —— 恢复 /api/export 导出的备份（配套接口，闭环备份链路）
// 请求体：{ mode: 'merge' | 'replace', data: <导出的整个 JSON 对象> }
//   也兼容直接把导出 JSON 当请求体（等价 merge）。
// 语义：
//   merge   （默认）按主键 UPSERT，已有数据保留、同 id 的以备份为准
//   replace  先清空备份里出现的表，再整体写入 —— 恢复到备份时刻的状态
// 说明：
//   · questions/progress/subjects/materials/ai_usage/pdfs 按主键幂等写入，重复恢复不产生重复行
//   · mock_results / mock_answers / answer_log 携带原 id 写入（OR REPLACE），保住模考明细的关联
//   · pdfs 只恢复元信息；R2 里的 PDF 文件本体不在备份里，需重新上传
//   · answer_log 量可能很大，最多恢复最近 RESTORE_LOG_CAP 条（保护 D1 每日写配额）
const RESTORE_LOG_CAP = 30000;

async function ensureTables(env) {
  await ensureSrsSchema(env); // progress 的 SRS 三列 + answer_log / mock_answers 表
  const ddl = [
    `ALTER TABLE questions ADD COLUMN page INTEGER`,   // 老库补列（已存在则报错忽略）
    `ALTER TABLE questions ADD COLUMN status TEXT`,
    `ALTER TABLE mock_results ADD COLUMN score REAL`,
    `CREATE TABLE IF NOT EXISTS subjects (code TEXT PRIMARY KEY, name TEXT NOT NULL, sort INTEGER DEFAULT 0, keywords TEXT DEFAULT '')`,
    `CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY, subject TEXT NOT NULL, title TEXT NOT NULL, source TEXT, page INTEGER, page_image TEXT, content_md TEXT, summary TEXT, tags TEXT, created_at INTEGER DEFAULT (unixepoch()))`,
    `CREATE TABLE IF NOT EXISTS mock_results (id INTEGER PRIMARY KEY AUTOINCREMENT, subject TEXT, total INTEGER, correct INTEGER, duration_seconds INTEGER, score REAL, taken_at INTEGER DEFAULT (unixepoch()))`,
    `CREATE TABLE IF NOT EXISTS pdfs (id TEXT PRIMARY KEY, title TEXT NOT NULL, subject TEXT, size INTEGER, created_at INTEGER DEFAULT (unixepoch()))`,
    `CREATE TABLE IF NOT EXISTS ai_usage (day TEXT PRIMARY KEY, pages INTEGER DEFAULT 0)`,
  ];
  for (const sql of ddl) { try { await env.DB.prepare(sql).run(); } catch (_) { /* 已存在 */ } }
}

const asArr = (x) => (Array.isArray(x) ? x : []);
const asJson = (v, d) => {
  if (v == null) return JSON.stringify(d);
  if (typeof v === 'string') { try { JSON.parse(v); return v; } catch { return JSON.stringify(d); } }
  return JSON.stringify(v); // 导出时 options/answer/tags 已被解析为数组，这里序列化回去
};
const int = (v, d = null) => (v == null || v === '' || !Number.isFinite(+v) ? d : Math.trunc(+v));

export async function onRequestPost({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;

  let body;
  try { body = await request.json(); } catch { return json({ error: '请求体不是合法 JSON（请上传 /api/export 导出的备份文件）' }, 400); }
  const mode = body && body.mode === 'replace' ? 'replace' : 'merge';
  const d = body && body.data && typeof body.data === 'object' ? body.data : body;
  if (!d || typeof d !== 'object') return json({ error: '备份内容为空' }, 400);
  if (d.version != null && ![1, 2].includes(Number(d.version))) {
    return json({ error: '不认识的备份版本 ' + d.version + '（本服务支持 v1 / v2）' }, 400);
  }

  const questions = asArr(d.questions).filter((q) => q && q.id != null && q.stem != null);
  const progress = asArr(d.progress).filter((r) => r && r.question_id != null);
  const materials = asArr(d.materials).filter((m) => m && m.id != null);
  const mockResults = asArr(d.mock_results).filter((m) => m && m.id != null);
  const mockAnswers = asArr(d.mock_answers).filter((m) => m && m.id != null);
  const subjects = asArr(d.subjects).filter((s) => s && s.code);
  const pdfs = asArr(d.pdfs).filter((p) => p && p.id != null);
  const aiUsage = asArr(d.ai_usage).filter((u) => u && u.day);
  let answerLog = asArr(d.answer_log).filter((a) => a && a.id != null);
  const notes = [];
  if (answerLog.length > RESTORE_LOG_CAP) {
    answerLog = answerLog.slice(-RESTORE_LOG_CAP);
    notes.push(`answer_log 超过 ${RESTORE_LOG_CAP} 条，只恢复了最近 ${RESTORE_LOG_CAP} 条（保护每日写配额）`);
  }
  if (pdfs.length) notes.push('pdfs 只恢复了书架元信息，PDF 文件本体需重新上传到 R2');

  const totalRows = questions.length + progress.length + materials.length + mockResults.length +
    mockAnswers.length + subjects.length + pdfs.length + aiUsage.length + answerLog.length;
  if (!totalRows) return json({ error: '备份里没有可恢复的数据' }, 422);

  try {
    await ensureTables(env);

    // —— replace：先清空备份中出现的表（键存在即视为要镜像，空数组也清）——
    if (mode === 'replace') {
      const wipe = [];
      if (Array.isArray(d.progress)) wipe.push('progress');
      if (Array.isArray(d.mock_answers)) wipe.push('mock_answers');
      if (Array.isArray(d.mock_results)) wipe.push('mock_results');
      if (Array.isArray(d.answer_log)) wipe.push('answer_log');
      if (Array.isArray(d.questions)) wipe.push('questions');
      if (Array.isArray(d.materials)) wipe.push('materials');
      if (Array.isArray(d.subjects)) wipe.push('subjects');
      if (Array.isArray(d.pdfs)) wipe.push('pdfs');
      if (Array.isArray(d.ai_usage)) wipe.push('ai_usage');
      for (const t of wipe) { try { await env.DB.prepare(`DELETE FROM ${t}`).run(); } catch (_) {} }
    }

    const stmts = [];

    // 1) subjects（先于题目：题目科目依赖它的存在感知，纯展示层面无硬约束）
    for (const s of subjects) {
      stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO subjects (code, name, sort, keywords) VALUES (?,?,?,?)`)
        .bind(String(s.code), String(s.name || s.code), int(s.sort, 0), String(s.keywords || '')));
    }

    // 2) questions（UPSERT 保 rowid / FTS 触发器正常联动；保留备份里的 created_at 以维持顺序刷题的次序）
    const qSql = `INSERT INTO questions (id, subject, chapter, type, difficulty, source, page, passage, stem, options, answer, analysis, tags, status, created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?, unixepoch()))
      ON CONFLICT(id) DO UPDATE SET
        subject=excluded.subject, chapter=excluded.chapter, type=excluded.type,
        difficulty=excluded.difficulty, source=excluded.source, page=excluded.page,
        passage=excluded.passage, stem=excluded.stem, options=excluded.options,
        answer=excluded.answer, analysis=excluded.analysis, tags=excluded.tags,
        status=excluded.status, created_at=excluded.created_at`;
    const qIds = new Set();
    for (const q of questions) {
      qIds.add(String(q.id));
      stmts.push(env.DB.prepare(qSql).bind(
        String(q.id), String(q.subject || 'computer'), q.chapter ?? null, String(q.type || 'single_choice'),
        int(q.difficulty, 3), q.source ?? null, int(q.page, null), q.passage ?? null, String(q.stem),
        asJson(q.options, []), asJson(q.answer, []), q.analysis ?? null, asJson(q.tags, []),
        q.status === 'draft' ? 'draft' : (q.status ?? null), int(q.created_at, null)
      ));
    }

    // 3) progress（question_id 有外键：merge 模式下备份里没有对应题、库里也没有的孤儿行要剔除，否则整块 batch 失败）
    let progressRows = progress;
    if (mode !== 'replace' || !Array.isArray(d.questions)) {
      const orphan = progress.map((r) => String(r.question_id)).filter((id) => !qIds.has(id));
      const exists = new Set();
      for (let i = 0; i < orphan.length; i += 90) {
        const chunk = [...new Set(orphan.slice(i, i + 90))];
        if (!chunk.length) continue;
        const ph = chunk.map(() => '?').join(',');
        const rs = await env.DB.prepare(`SELECT id FROM questions WHERE id IN (${ph})`).bind(...chunk).all();
        for (const r of rs.results || []) exists.add(String(r.id));
      }
      progressRows = progress.filter((r) => qIds.has(String(r.question_id)) || exists.has(String(r.question_id)));
      const dropped = progress.length - progressRows.length;
      if (dropped > 0) notes.push(`progress 有 ${dropped} 条找不到对应题目，已跳过`);
    }
    const pSql = `INSERT INTO progress (question_id, wrong_count, right_count, last_correct, favorited, mastered, note, due_at, interval_days, ease, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,COALESCE(?, unixepoch()))
      ON CONFLICT(question_id) DO UPDATE SET
        wrong_count=excluded.wrong_count, right_count=excluded.right_count, last_correct=excluded.last_correct,
        favorited=excluded.favorited, mastered=excluded.mastered, note=excluded.note,
        due_at=excluded.due_at, interval_days=excluded.interval_days, ease=excluded.ease, updated_at=excluded.updated_at`;
    for (const r of progressRows) {
      stmts.push(env.DB.prepare(pSql).bind(
        String(r.question_id), int(r.wrong_count, 0), int(r.right_count, 0),
        r.last_correct == null ? null : (r.last_correct ? 1 : 0),
        r.favorited ? 1 : 0, r.mastered ? 1 : 0, r.note ?? null,
        int(r.due_at, null), Number.isFinite(+r.interval_days) ? +r.interval_days : 0,
        Number.isFinite(+r.ease) ? +r.ease : 2.5, int(r.updated_at, null)
      ));
    }

    // 4) materials
    for (const m of materials) {
      stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO materials (id, subject, title, source, page, page_image, content_md, summary, tags, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,COALESCE(?, unixepoch()))`).bind(
        String(m.id), String(m.subject || 'computer'), String(m.title || '教材整理'), m.source ?? null,
        int(m.page, null), m.page_image ?? null, m.content_md ?? '', m.summary ?? null, asJson(m.tags, []), int(m.created_at, null)
      ));
    }

    // 5) 模考成绩 + 逐题明细 + 答题流水（都带原 id，保关联；重复恢复覆盖同 id 行）
    for (const m of mockResults) {
      stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO mock_results (id, subject, total, correct, duration_seconds, score, taken_at)
        VALUES (?,?,?,?,?,?,COALESCE(?, unixepoch()))`).bind(
        int(m.id), m.subject ?? 'all', int(m.total, 0), int(m.correct, 0), int(m.duration_seconds, 0),
        Number.isFinite(+m.score) && m.score != null ? +m.score : null, int(m.taken_at, null)));
    }
    for (const a of mockAnswers) {
      stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO mock_answers (id, mock_id, question_id, is_correct) VALUES (?,?,?,?)`)
        .bind(int(a.id), int(a.mock_id, null), a.question_id == null ? null : String(a.question_id),
          a.is_correct == null ? null : (a.is_correct ? 1 : 0)));
    }
    for (const a of answerLog) {
      stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO answer_log (id, question_id, is_correct, ts) VALUES (?,?,?,COALESCE(?, unixepoch()))`)
        .bind(int(a.id), a.question_id == null ? null : String(a.question_id),
          a.is_correct == null ? null : (a.is_correct ? 1 : 0), int(a.ts, null)));
    }

    // 6) 其他小表
    for (const p of pdfs) {
      stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO pdfs (id, title, subject, size, created_at) VALUES (?,?,?,?,COALESCE(?, unixepoch()))`)
        .bind(String(p.id), String(p.title || '未命名'), p.subject ?? null, int(p.size, null), int(p.created_at, null)));
    }
    for (const u of aiUsage) {
      stmts.push(env.DB.prepare(`INSERT OR REPLACE INTO ai_usage (day, pages) VALUES (?,?)`).bind(String(u.day), int(u.pages, 0)));
    }

    await batchChunked(env, stmts, 80);

    return json({
      ok: true, mode, notes,
      counts: {
        questions: questions.length, progress: progressRows.length, materials: materials.length,
        mock_results: mockResults.length, mock_answers: mockAnswers.length,
        answer_log: answerLog.length, subjects: subjects.length, pdfs: pdfs.length, ai_usage: aiUsage.length,
      },
    });
  } catch (e) {
    return json({ error: '恢复失败：' + e.message }, 500);
  }
}
