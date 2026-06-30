import { json, checkAuth, rowToQuestion } from './_utils.js';

export async function onRequestGet({ request, env }) {
  const auth = checkAuth(request, env);
  if (!auth.ok) return auth.resp;

  const p = new URL(request.url).searchParams;

  // —— meta：给前端筛选器用的科目 / 章节清单 ——
  if (p.get('meta')) {
    const subjStmt = env.DB.prepare(
      `SELECT subject, COUNT(*) AS n FROM questions GROUP BY subject`
    );
    const chapStmt = env.DB.prepare(
      `SELECT subject, chapter, COUNT(*) AS n FROM questions
       WHERE chapter IS NOT NULL AND chapter <> '' GROUP BY subject, chapter ORDER BY subject, chapter`
    );
    const [subs, chaps] = await Promise.all([subjStmt.all(), chapStmt.all()]);
    return json({ subjects: subs.results, chapters: chaps.results });
  }

  const subject = p.get('subject');
  const chapter = p.get('chapter');
  const type = p.get('type');
  const mode = p.get('mode') || 'all';
  const search = p.get('q');
  const order = p.get('order') === 'seq' ? 'seq' : 'random';
  const limit = Math.min(parseInt(p.get('limit') || '20', 10) || 20, 200);
  const offset = parseInt(p.get('offset') || '0', 10) || 0;

  const where = [];
  const binds = [];
  if (subject && subject !== 'all') { where.push('q.subject = ?'); binds.push(subject); }
  if (chapter) { where.push('q.chapter = ?'); binds.push(chapter); }
  if (type) { where.push('q.type = ?'); binds.push(type); }
  if (search) { where.push('(q.stem LIKE ? OR q.chapter LIKE ?)'); binds.push(`%${search}%`, `%${search}%`); }

  if (mode === 'wrong') where.push('pr.wrong_count > 0 AND IFNULL(pr.mastered, 0) = 0');
  else if (mode === 'favorite') where.push('IFNULL(pr.favorited, 0) = 1');
  else if (mode === 'mastered') where.push('IFNULL(pr.mastered, 0) = 1');
  else if (mode === 'unseen') where.push('pr.question_id IS NULL');

  const orderBy = order === 'seq' ? 'q.created_at ASC, q.id ASC' : 'RANDOM()';
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const sql = `SELECT q.*, pr.wrong_count, pr.right_count, pr.favorited, pr.mastered, pr.note AS user_note
               FROM questions q
               LEFT JOIN progress pr ON pr.question_id = q.id
               ${whereSql}
               ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  binds.push(limit, offset);

  const countSql = `SELECT COUNT(*) AS total FROM questions q
                    LEFT JOIN progress pr ON pr.question_id = q.id ${whereSql}`;

  try {
    const [list, cnt] = await Promise.all([
      env.DB.prepare(sql).bind(...binds).all(),
      env.DB.prepare(countSql).bind(...binds.slice(0, binds.length - 2)).first(),
    ]);
    return json({ items: list.results.map(rowToQuestion), total: cnt?.total ?? list.results.length });
  } catch (e) {
    return json({ error: '查询失败：' + e.message }, 500);
  }
}

// —— 删除题目（按 id 批量）——
export async function onRequestDelete({ request, env }) {
  const auth = checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求体解析失败' }, 400); }
  const ids = Array.isArray(body && body.ids) ? body.ids.filter(Boolean) : (body && body.id ? [body.id] : []);
  if (!ids.length) return json({ error: '缺少要删除的题目 id' }, 400);
  try {
    const ph = ids.map(() => '?').join(',');
    await env.DB.prepare(`DELETE FROM progress WHERE question_id IN (${ph})`).bind(...ids).run();
    const r = await env.DB.prepare(`DELETE FROM questions WHERE id IN (${ph})`).bind(...ids).run();
    const deleted = (r && r.meta && r.meta.changes != null) ? r.meta.changes : ids.length;
    return json({ ok: true, deleted });
  } catch (e) {
    return json({ error: '删除失败：' + e.message }, 500);
  }
}

// —— 更新题目字段（按 id 批量；可改 科目/章节/题干/解析/题型/难度）——
export async function onRequestPatch({ request, env }) {
  const auth = checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求体解析失败' }, 400); }
  const ids = Array.isArray(body && body.ids) ? body.ids.filter(Boolean) : (body && body.id ? [body.id] : []);
  if (!ids.length) return json({ error: '缺少题目 id' }, 400);
  const ALLOWED = ['subject', 'chapter', 'type', 'difficulty', 'stem', 'passage', 'analysis', 'options', 'answer', 'tags'];
  const JSON_FIELDS = new Set(['options', 'answer', 'tags']);
  const sets = [], vals = [];
  for (const k of ALLOWED) {
    if (body[k] !== undefined && body[k] !== null) {
      sets.push(`${k} = ?`);
      if (k === 'difficulty') vals.push(Number(body[k]) || 3);
      else if (JSON_FIELDS.has(k)) vals.push(JSON.stringify(Array.isArray(body[k]) ? body[k] : (body[k] === '' ? [] : [body[k]])));
      else vals.push(String(body[k]));
    }
  }
  if (!sets.length) return json({ error: '没有可更新的字段' }, 400);
  try {
    const ph = ids.map(() => '?').join(',');
    const r = await env.DB.prepare(`UPDATE questions SET ${sets.join(', ')} WHERE id IN (${ph})`).bind(...vals, ...ids).run();
    const updated = (r && r.meta && r.meta.changes != null) ? r.meta.changes : ids.length;
    return json({ ok: true, updated });
  } catch (e) {
    return json({ error: '更新失败：' + e.message }, 500);
  }
}
