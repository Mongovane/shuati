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
