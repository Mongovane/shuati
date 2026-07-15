import { checkAuth } from './_utils.js';

// GET /api/export —— 导出全部数据为 JSON（备份 / 迁移 / 打印错题用）
// questions 可直接回贴到「导入 → 直接导入 JSON」恢复题库
export async function onRequestGet({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;

  const tables = {
    questions: `SELECT * FROM questions`,
    progress: `SELECT * FROM progress`,
    materials: `SELECT * FROM materials`,
    mock_results: `SELECT * FROM mock_results`,
    mock_answers: `SELECT * FROM mock_answers`,
    subjects: `SELECT * FROM subjects`,
    answer_log: `SELECT * FROM answer_log`,   // 答题流水（热力图历史）
    pdfs: `SELECT * FROM pdfs`,               // PDF 书架元信息（R2 里的文件本体不在备份里）
    ai_usage: `SELECT * FROM ai_usage`,       // Workers AI OCR 每日用量计数
  };
  const out = { exported_at: new Date().toISOString(), version: 2 };
  for (const [name, sql] of Object.entries(tables)) {
    try { out[name] = (await env.DB.prepare(sql).all()).results || []; }
    catch (_) { out[name] = []; } // 表不存在（旧库/未用过该功能）：导出空数组
  }
  // questions 里的 options/answer/tags 是 JSON 字符串，解开成对象方便「直接导入 JSON」原样恢复
  const parse = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
  out.questions = out.questions.map((q) => ({
    ...q,
    options: parse(q.options, []),
    answer: parse(q.answer, []),
    tags: parse(q.tags, []),
  }));

  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return new Response(JSON.stringify(out), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="shuati-backup-${day}.json"`,
      'cache-control': 'no-store',
    },
  });
}
