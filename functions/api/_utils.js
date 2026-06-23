// 公共工具。文件名以 _ 开头，不会被注册成路由。

export function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

// 校验访问口令（APP_TOKEN）。前端在每次请求头里带 Authorization: Bearer <token>
export function checkAuth(request, env) {
  if (!env.APP_TOKEN) {
    return { ok: false, resp: json({ error: '服务端未设置 APP_TOKEN，请在 Cloudflare 后台配置访问口令' }, 500) };
  }
  const auth = request.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (token !== env.APP_TOKEN) {
    return { ok: false, resp: json({ error: '未授权：请在「设置」里填写正确的访问口令' }, 401) };
  }
  return { ok: true };
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
    note: r.user_note || r.note || '',
  };
}
