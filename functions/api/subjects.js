import { json, checkAuth } from './_utils.js';

// subjects 表：code 科目代码 / name 中文名 / sort 排序 / keywords 术语关键词（逗号分隔，供自动判断科目用）
async function ensure(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS subjects (
       code TEXT PRIMARY KEY,
       name TEXT NOT NULL,
       sort INTEGER DEFAULT 0,
       keywords TEXT DEFAULT ''
     )`
  ).run();
  const c = await env.DB.prepare(`SELECT COUNT(*) AS n FROM subjects`).first();
  if (!c || !c.n) {
    const seed = [
      ['politics', '政治理论', 1, '马克思,马克思主义,毛泽东,邓小平,习近平,社会主义,中国共产党,中国特色,辩证唯物,历史唯物,生产关系,生产力,无产阶级,资本主义,党的领导,毛概,马原,史纲,思修,科学发展观,三个代表,实事求是,改革开放,新民主主义'],
      ['english', '英语', 2, '阅读理解,完形,词汇,语法,写作,四级,六级'],
      ['math', '高等数学', 3, '导数,积分,极限,微分,矩阵,行列式,向量,特征值,定积分,不定积分,级数,偏导,微分方程,连续函数,可导,渐近线'],
      ['computer', '计算机基础与程序设计', 4, '算法,数据结构,时间复杂度,空间复杂度,链表,二叉树,操作系统,数据库,指针,数组,哈希,递归,进制转换,源程序,伪代码'],
    ];
    for (const [code, name, sort, kw] of seed) {
      await env.DB.prepare(`INSERT OR IGNORE INTO subjects (code,name,sort,keywords) VALUES (?,?,?,?)`).bind(code, name, sort, kw).run();
    }
  }
}

const normCode = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');

export async function onRequestGet({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  try {
    await ensure(env);
    const r = await env.DB.prepare(`SELECT code, name, sort, keywords FROM subjects ORDER BY sort ASC, code ASC`).all();
    return json({ items: (r.results || []).map((x) => ({ v: x.code, t: x.name, sort: x.sort || 0, keywords: x.keywords || '' })) });
  } catch (e) {
    return json({ error: '读取科目失败：' + e.message }, 500);
  }
}

export async function onRequestPost({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求体解析失败' }, 400); }
  const code = normCode(body.code || body.v);
  const name = String(body.name || body.t || '').trim();
  const sort = Number.isFinite(+body.sort) ? +body.sort : 0;
  const keywords = String(body.keywords || '').trim();
  if (!code) return json({ error: '科目代码只能用小写字母/数字/下划线，且不能为空' }, 400);
  if (!name) return json({ error: '请填写科目名称' }, 400);
  try {
    await ensure(env);
    const exists = await env.DB.prepare(`SELECT code FROM subjects WHERE code = ?`).bind(code).first();
    if (exists) return json({ error: '该科目代码已存在：' + code }, 409);
    await env.DB.prepare(`INSERT INTO subjects (code,name,sort,keywords) VALUES (?,?,?,?)`).bind(code, name, sort, keywords).run();
    return json({ ok: true, code });
  } catch (e) {
    return json({ error: '新增科目失败：' + e.message }, 500);
  }
}

export async function onRequestPatch({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求体解析失败' }, 400); }
  const code = normCode(body.code || body.v);
  if (!code) return json({ error: '缺少科目代码' }, 400);
  const sets = [], vals = [];
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(String(body.name).trim()); }
  if (body.sort !== undefined) { sets.push('sort = ?'); vals.push(Number.isFinite(+body.sort) ? +body.sort : 0); }
  if (body.keywords !== undefined) { sets.push('keywords = ?'); vals.push(String(body.keywords).trim()); }
  if (!sets.length) return json({ error: '没有可更新的字段' }, 400);
  try {
    await ensure(env);
    const r = await env.DB.prepare(`UPDATE subjects SET ${sets.join(', ')} WHERE code = ?`).bind(...vals, code).run();
    const updated = (r && r.meta && r.meta.changes != null) ? r.meta.changes : 0;
    if (!updated) return json({ error: '未找到该科目：' + code }, 404);
    return json({ ok: true, updated });
  } catch (e) {
    return json({ error: '更新科目失败：' + e.message }, 500);
  }
}

export async function onRequestDelete({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  let body;
  try { body = await request.json(); } catch { return json({ error: '请求体解析失败' }, 400); }
  const code = normCode(body.code || body.v);
  if (!code) return json({ error: '缺少科目代码' }, 400);
  try {
    await ensure(env);
    // 可选：把该科目下的题目转到 moveTo 科目；不传则保留旧题（题里仍是旧 code，只是下拉不再显示）
    const moveTo = normCode(body.moveTo);
    if (moveTo) {
      await env.DB.prepare(`UPDATE questions SET subject = ? WHERE subject = ?`).bind(moveTo, code).run();
      try { await env.DB.prepare(`UPDATE materials SET subject = ? WHERE subject = ?`).bind(moveTo, code).run(); } catch (_) {}
    }
    const r = await env.DB.prepare(`DELETE FROM subjects WHERE code = ?`).bind(code).run();
    const deleted = (r && r.meta && r.meta.changes != null) ? r.meta.changes : 0;
    return json({ ok: true, deleted, moved: moveTo || null });
  } catch (e) {
    return json({ error: '删除科目失败：' + e.message }, 500);
  }
}
