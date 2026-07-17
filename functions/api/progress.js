import { json, checkAuth, ensureSrsSchema, batchChunked } from './_utils.js';

let _pruneDay = ''; // answer_log 清理的「每天一次」守卫（isolate 级）

// GET /api/progress —— 统计面板（含 SRS 到期数、答题热力图）
// GET /api/progress?mock_id=N —— 某次模拟考的逐题记录（错题回顾用）
export async function onRequestGet({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  await ensureSrsSchema(env);

  const p = new URL(request.url).searchParams;

  // —— 模考逐题记录 ——
  const mockId = parseInt(p.get('mock_id') || '', 10);
  if (Number.isInteger(mockId)) {
    try {
      const rs = await env.DB.prepare(
        `SELECT question_id, is_correct FROM mock_answers WHERE mock_id = ? ORDER BY id ASC`
      ).bind(mockId).all();
      return json({ items: rs.results || [] });
    } catch (e) {
      return json({ error: '查询模考记录失败：' + e.message }, 500);
    }
  }

  try {
    const bySubject = await env.DB.prepare(
      `SELECT q.subject,
              COUNT(*) AS total_q,
              SUM(CASE WHEN pr.right_count > 0 OR pr.wrong_count > 0 THEN 1 ELSE 0 END) AS seen,
              SUM(IFNULL(pr.right_count, 0)) AS right_sum,
              SUM(IFNULL(pr.wrong_count, 0)) AS wrong_sum,
              SUM(CASE WHEN pr.last_correct = 1 THEN 1 ELSE 0 END) AS right_q,
              SUM(CASE WHEN pr.wrong_count > 0 AND IFNULL(pr.mastered,0)=0 THEN 1 ELSE 0 END) AS wrong_open,
              SUM(CASE WHEN IFNULL(pr.mastered, 0) = 1 THEN 1 ELSE 0 END) AS mastered,
              SUM(CASE WHEN IFNULL(pr.favorited, 0) = 1 THEN 1 ELSE 0 END) AS favorited,
              SUM(CASE WHEN IFNULL(pr.mastered,0)=0 AND pr.due_at IS NOT NULL AND pr.due_at <= unixepoch() THEN 1 ELSE 0 END) AS due
       FROM questions q LEFT JOIN progress pr ON pr.question_id = q.id
       WHERE IFNULL(q.status,'') <> 'draft'
       GROUP BY q.subject`
    ).all();

    const mocks = await env.DB.prepare(
      `SELECT id, subject, total, correct, score, duration_seconds, taken_at
       FROM mock_results ORDER BY taken_at DESC LIMIT 20`
    ).all();

    // 近 20 周答题热力图（按天聚合；'+8 hours' = Asia/Shanghai，本项目面向国内备考）
    let heat = [];
    try {
      const h = await env.DB.prepare(
        `SELECT date(ts, 'unixepoch', '+8 hours') AS d, COUNT(*) AS n, SUM(is_correct) AS r
         FROM answer_log WHERE ts >= unixepoch() - 86400 * 140 GROUP BY d`
      ).all();
      heat = h.results || [];
    } catch (_) {}

    // 近 90 天各题型平均作答用时（有 duration_ms 的记录才计入；老数据无此列时静默为空）
    let dur = [];
    try {
      const r = await env.DB.prepare(
        `SELECT q.type, COUNT(*) AS n, CAST(AVG(a.duration_ms) AS INTEGER) AS avg_ms
         FROM answer_log a JOIN questions q ON q.id = a.question_id
         WHERE a.duration_ms IS NOT NULL AND a.ts >= unixepoch() - 86400 * 90
         GROUP BY q.type`
      ).all();
      dur = r.results || [];
    } catch (_) {}

    // answer_log 惰性清理：只保留最近 400 天（热力图 140 天 + 富余），每个 isolate 每天最多跑一次
    try {
      const day = new Date().toISOString().slice(0, 10);
      if (_pruneDay !== day) { _pruneDay = day; await env.DB.prepare(`DELETE FROM answer_log WHERE ts < unixepoch() - 86400 * 400`).run(); }
    } catch (_) {}

    return json({ bySubject: bySubject.results, mocks: mocks.results, heat, dur });
  } catch (e) {
    return json({ error: '统计失败：' + e.message }, 500);
  }
}

// —— 简化 SM-2 间隔重复（v48 起支持 Anki 式四档）——
// grade: 'again' 重来 | 'hard' 困难 | 'good' 良好 | 'easy' 简单；不传时按 correct 映射 good/again（与旧版行为完全一致）
//   again: interval → 0，10 分钟后回炉，ease −0.2（下限 1.3）
//   hard : interval 小步前进（×1.2 且至少 +1 天），ease −0.05
//   good : 1 → 3 → ×ease（旧版「答对」曲线），ease +0.05
//   easy : 2 → 5 → ×ease×1.3，ease +0.1（上限 3.0）；间隔一律封顶 365 天
// （导出以便单元测试；Pages Functions 只把 onRequest* 当路由，额外导出无副作用）
export function nextSrs(cur, correct, grade) {
  let ease = (cur && Number(cur.ease)) || 2.5;
  let interval = (cur && Number(cur.interval_days)) || 0;
  const g = ['again', 'hard', 'good', 'easy'].includes(grade) ? grade : (correct ? 'good' : 'again');
  if (g === 'again') {
    ease = Math.max(1.3, ease - 0.2);
    interval = 0;
  } else if (g === 'hard') {
    interval = interval < 1 ? 1 : Math.min(365, Math.max(interval + 1, interval * 1.2));
    ease = Math.max(1.3, ease - 0.05);
  } else if (g === 'easy') {
    interval = interval < 1 ? 2 : (interval < 3 ? 5 : Math.min(365, interval * ease * 1.3));
    ease = Math.min(3.0, ease + 0.1);
  } else { // good
    interval = interval < 1 ? 1 : (interval < 3 ? 3 : Math.min(365, interval * ease));
    ease = Math.min(3.0, ease + 0.05);
  }
  // again 10 分钟后即再次到期（本场就能回炉）；其余按天
  const dueAt = Math.floor(Date.now() / 1000) + (g === 'again' ? 600 : Math.round(interval * 86400));
  return { ease: Math.round(ease * 100) / 100, interval, dueAt };
}

// POST /api/progress —— 记录各类学习动作
export async function onRequestPost({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  await ensureSrsSchema(env);

  let b;
  try { b = await request.json(); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }
  const action = b.action;

  try {
    if (action === 'mock') {
      const score = Number.isFinite(+b.score) ? Math.round(+b.score * 10) / 10 : null;
      const r = await env.DB.prepare(
        `INSERT INTO mock_results (subject, total, correct, duration_seconds, score) VALUES (?,?,?,?,?)`
      ).bind(b.subject || 'all', b.total | 0, b.correct | 0, b.duration_seconds | 0, score).run();
      const mockId = r && r.meta ? r.meta.last_row_id : null;
      // 逐题明细（可选）：[{question_id, is_correct}] —— 1 对 / 0 错 / 0.5 多选少选半分 / null 主观未判
      const details = Array.isArray(b.details) ? b.details.slice(0, 500) : [];
      if (mockId && details.length) {
        await env.DB.batch(details.map((d) =>
          env.DB.prepare(`INSERT INTO mock_answers (mock_id, question_id, is_correct) VALUES (?,?,?)`)
            .bind(mockId, String(d.question_id || ''), d.is_correct == null ? null : +d.is_correct)
        ));
      }
      return json({ ok: true, mock_id: mockId });
    }

    // —— 复盘自评回写：主观题在复盘阶段自评后，把结果补进这次模考的逐题明细（错题回顾才能包含它们）——
    if (action === 'mock_grade') {
      const mid = parseInt(b.mock_id, 10);
      const qid2 = String(b.question_id || '');
      if (!Number.isInteger(mid) || !qid2) return json({ error: '缺少 mock_id / question_id' }, 400);
      await env.DB.prepare(`UPDATE mock_answers SET is_correct = ? WHERE mock_id = ? AND question_id = ?`)
        .bind(b.is_correct == null ? null : (b.is_correct ? 1 : 0), mid, qid2).run();
      return json({ ok: true });
    }

    // —— 批量作答记账（模拟考交卷用）：items = [{question_id, is_correct}] ——
    // 一次 SELECT 拉齐现有 SRS 状态，逐条演进后分块批量 UPSERT + 写流水；同一题出现多次时串联演进
    if (action === 'answers_bulk') {
      const items = (Array.isArray(b.items) ? b.items : []).slice(0, 500)
        .filter((x) => x && x.question_id != null && x.is_correct != null)
        .map((x) => ({ qid: String(x.question_id), correct: +x.is_correct >= 1 ? 1 : 0 })); // 0.5 半分：SRS 按「需复习」计错
      if (!items.length) return json({ error: '缺少 items（[{question_id, is_correct}]）' }, 400);

      const ids = [...new Set(items.map((x) => x.qid))];
      const curMap = new Map();
      for (let i = 0; i < ids.length; i += 90) {
        const chunk = ids.slice(i, i + 90);
        const ph = chunk.map(() => '?').join(',');
        const rs = await env.DB.prepare(
          `SELECT question_id, interval_days, ease FROM progress WHERE question_id IN (${ph})`
        ).bind(...chunk).all();
        for (const r of (rs.results || [])) curMap.set(String(r.question_id), { interval_days: r.interval_days, ease: r.ease });
      }

      const upsert = `INSERT INTO progress (question_id, right_count, wrong_count, last_correct, due_at, interval_days, ease, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
         ON CONFLICT(question_id) DO UPDATE SET
           right_count = right_count + ?,
           wrong_count = wrong_count + ?,
           last_correct = ?,
           due_at = ?,
           interval_days = ?,
           ease = ?,
           updated_at = unixepoch()`;
      const stmts = [];
      for (const it of items) {
        const srs = nextSrs(curMap.get(it.qid), !!it.correct);
        curMap.set(it.qid, { interval_days: srs.interval, ease: srs.ease }); // 同题多次：下一次基于本次结果继续演进
        stmts.push(env.DB.prepare(upsert).bind(
          it.qid, it.correct, 1 - it.correct, it.correct, srs.dueAt, srs.interval, srs.ease,
          it.correct, 1 - it.correct, it.correct, srs.dueAt, srs.interval, srs.ease));
        stmts.push(env.DB.prepare(`INSERT INTO answer_log (question_id, is_correct) VALUES (?, ?)`).bind(it.qid, it.correct));
      }
      await batchChunked(env, stmts, 80);
      return json({ ok: true, count: items.length });
    }

    const qid = b.question_id;
    if (!qid) return json({ error: '缺少 question_id' }, 400);

    if (action === 'answer') {
      // 四档自评（可选）：传了 grade 时以 grade 为准校准对错（again=错，其余=对）
      const grade = ['again', 'hard', 'good', 'easy'].includes(b.grade) ? b.grade : null;
      const correct = grade ? (grade === 'again' ? 0 : 1) : (b.is_correct ? 1 : 0);
      const dur = Number.isFinite(+b.duration_ms) ? Math.min(600000, Math.max(0, Math.trunc(+b.duration_ms))) : null;
      const cur = await env.DB.prepare(
        `SELECT interval_days, ease FROM progress WHERE question_id = ?`
      ).bind(qid).first();
      const srs = nextSrs(cur, !!correct, grade || undefined);
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO progress (question_id, right_count, wrong_count, last_correct, due_at, interval_days, ease, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
           ON CONFLICT(question_id) DO UPDATE SET
             right_count = right_count + ?,
             wrong_count = wrong_count + ?,
             last_correct = ?,
             due_at = ?,
             interval_days = ?,
             ease = ?,
             updated_at = unixepoch()`
        ).bind(qid, correct, 1 - correct, correct, srs.dueAt, srs.interval, srs.ease,
               correct, 1 - correct, correct, srs.dueAt, srs.interval, srs.ease),
        env.DB.prepare(`INSERT INTO answer_log (question_id, is_correct, duration_ms) VALUES (?, ?, ?)`).bind(qid, correct, dur),
      ]);
      return json({ ok: true, due_in_days: correct ? srs.interval : 0 });
    }

    if (action === 'favorite' || action === 'master') {
      const col = action === 'favorite' ? 'favorited' : 'mastered';
      const val = b.value ? 1 : 0;
      await env.DB.prepare(
        `INSERT INTO progress (question_id, ${col}, updated_at) VALUES (?, ?, unixepoch())
         ON CONFLICT(question_id) DO UPDATE SET ${col} = ?, updated_at = unixepoch()`
      ).bind(qid, val, val).run();
      return json({ ok: true });
    }

    if (action === 'note') {
      const note = (b.note || '').slice(0, 4000);
      await env.DB.prepare(
        `INSERT INTO progress (question_id, note, updated_at) VALUES (?, ?, unixepoch())
         ON CONFLICT(question_id) DO UPDATE SET note = ?, updated_at = unixepoch()`
      ).bind(qid, note, note).run();
      return json({ ok: true });
    }

    return json({ error: '未知 action' }, 400);
  } catch (e) {
    return json({ error: '写入失败：' + e.message }, 500);
  }
}

// DELETE /api/progress?mock_id=X —— 删除一条模考历史记录（及其逐题明细）
// 只动 mock_results / mock_answers，不碰题库与 SRS 进度，属安全操作
export async function onRequestDelete({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  const mid = parseInt(new URL(request.url).searchParams.get('mock_id') || '', 10);
  if (!Number.isInteger(mid)) return json({ error: '缺少 mock_id' }, 400);
  try {
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM mock_answers WHERE mock_id = ?`).bind(mid),
      env.DB.prepare(`DELETE FROM mock_results WHERE id = ?`).bind(mid),
    ]);
    return json({ ok: true });
  } catch (e) {
    return json({ error: '删除失败：' + e.message }, 500);
  }
}
