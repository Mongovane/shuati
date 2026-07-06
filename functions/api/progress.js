import { json, checkAuth, ensureSrsSchema } from './_utils.js';

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
              SUM(CASE WHEN pr.wrong_count > 0 AND IFNULL(pr.mastered,0)=0 THEN 1 ELSE 0 END) AS wrong_open,
              SUM(CASE WHEN IFNULL(pr.mastered, 0) = 1 THEN 1 ELSE 0 END) AS mastered,
              SUM(CASE WHEN IFNULL(pr.favorited, 0) = 1 THEN 1 ELSE 0 END) AS favorited,
              SUM(CASE WHEN IFNULL(pr.mastered,0)=0 AND pr.due_at IS NOT NULL AND pr.due_at <= unixepoch() THEN 1 ELSE 0 END) AS due
       FROM questions q LEFT JOIN progress pr ON pr.question_id = q.id
       GROUP BY q.subject`
    ).all();

    const mocks = await env.DB.prepare(
      `SELECT id, subject, total, correct, duration_seconds, taken_at
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

    return json({ bySubject: bySubject.results, mocks: mocks.results, heat });
  } catch (e) {
    return json({ error: '统计失败：' + e.message }, 500);
  }
}

// —— 简化 SM-2 间隔重复：答对拉长间隔，答错回炉 ——
// interval_days: 0=新/刚错；答对序列 1 → 3 → 3*ease → ...（封顶 365 天）
// ease: 2.5 起步，错-0.2（下限 1.3），对+0.05（上限 3.0）
function nextSrs(cur, correct) {
  let ease = (cur && Number(cur.ease)) || 2.5;
  let interval = (cur && Number(cur.interval_days)) || 0;
  if (correct) {
    interval = interval < 1 ? 1 : (interval < 3 ? 3 : Math.min(365, interval * ease));
    ease = Math.min(3.0, ease + 0.05);
  } else {
    ease = Math.max(1.3, ease - 0.2);
    interval = 0;
  }
  // 答错 10 分钟后即再次到期（本场就能回炉）；答对按天
  const dueAt = Math.floor(Date.now() / 1000) + (correct ? Math.round(interval * 86400) : 600);
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
      const r = await env.DB.prepare(
        `INSERT INTO mock_results (subject, total, correct, duration_seconds) VALUES (?,?,?,?)`
      ).bind(b.subject || 'all', b.total | 0, b.correct | 0, b.duration_seconds | 0).run();
      const mockId = r && r.meta ? r.meta.last_row_id : null;
      // 逐题明细（可选）：[{question_id, is_correct|null(未判分)}]
      const details = Array.isArray(b.details) ? b.details.slice(0, 500) : [];
      if (mockId && details.length) {
        await env.DB.batch(details.map((d) =>
          env.DB.prepare(`INSERT INTO mock_answers (mock_id, question_id, is_correct) VALUES (?,?,?)`)
            .bind(mockId, String(d.question_id || ''), d.is_correct == null ? null : (d.is_correct ? 1 : 0))
        ));
      }
      return json({ ok: true, mock_id: mockId });
    }

    const qid = b.question_id;
    if (!qid) return json({ error: '缺少 question_id' }, 400);

    if (action === 'answer') {
      const correct = b.is_correct ? 1 : 0;
      const cur = await env.DB.prepare(
        `SELECT interval_days, ease FROM progress WHERE question_id = ?`
      ).bind(qid).first();
      const srs = nextSrs(cur, !!correct);
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
        env.DB.prepare(`INSERT INTO answer_log (question_id, is_correct) VALUES (?, ?)`).bind(qid, correct),
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
