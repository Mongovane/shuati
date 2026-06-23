import { json, checkAuth } from './_utils.js';

// GET /api/progress —— 统计面板
export async function onRequestGet({ request, env }) {
  const auth = checkAuth(request, env);
  if (!auth.ok) return auth.resp;

  try {
    const bySubject = await env.DB.prepare(
      `SELECT q.subject,
              COUNT(*) AS total_q,
              SUM(CASE WHEN pr.right_count > 0 OR pr.wrong_count > 0 THEN 1 ELSE 0 END) AS seen,
              SUM(IFNULL(pr.right_count, 0)) AS right_sum,
              SUM(IFNULL(pr.wrong_count, 0)) AS wrong_sum,
              SUM(CASE WHEN pr.wrong_count > 0 AND IFNULL(pr.mastered,0)=0 THEN 1 ELSE 0 END) AS wrong_open,
              SUM(CASE WHEN IFNULL(pr.mastered, 0) = 1 THEN 1 ELSE 0 END) AS mastered,
              SUM(CASE WHEN IFNULL(pr.favorited, 0) = 1 THEN 1 ELSE 0 END) AS favorited
       FROM questions q LEFT JOIN progress pr ON pr.question_id = q.id
       GROUP BY q.subject`
    ).all();

    const mocks = await env.DB.prepare(
      `SELECT subject, total, correct, duration_seconds, taken_at
       FROM mock_results ORDER BY taken_at DESC LIMIT 20`
    ).all();

    return json({ bySubject: bySubject.results, mocks: mocks.results });
  } catch (e) {
    return json({ error: '统计失败：' + e.message }, 500);
  }
}

// POST /api/progress —— 记录各类学习动作
export async function onRequestPost({ request, env }) {
  const auth = checkAuth(request, env);
  if (!auth.ok) return auth.resp;

  let b;
  try { b = await request.json(); } catch { return json({ error: '请求体不是合法 JSON' }, 400); }
  const action = b.action;

  try {
    if (action === 'mock') {
      await env.DB.prepare(
        `INSERT INTO mock_results (subject, total, correct, duration_seconds) VALUES (?,?,?,?)`
      ).bind(b.subject || 'all', b.total | 0, b.correct | 0, b.duration_seconds | 0).run();
      return json({ ok: true });
    }

    const qid = b.question_id;
    if (!qid) return json({ error: '缺少 question_id' }, 400);

    if (action === 'answer') {
      const correct = b.is_correct ? 1 : 0;
      await env.DB.prepare(
        `INSERT INTO progress (question_id, right_count, wrong_count, last_correct, updated_at)
         VALUES (?, ?, ?, ?, unixepoch())
         ON CONFLICT(question_id) DO UPDATE SET
           right_count = right_count + ?,
           wrong_count = wrong_count + ?,
           last_correct = ?,
           updated_at = unixepoch()`
      ).bind(qid, correct, 1 - correct, correct, correct, 1 - correct, correct).run();
      return json({ ok: true });
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
