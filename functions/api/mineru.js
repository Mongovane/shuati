import { json, checkAuth } from './_utils.js';

const MINERU_BASE_URL = 'https://mineru.net/api/v4';

export async function onRequest(context) {
  const { request, env } = context;
  
  // 鉴权拦截（保护你的接口不被白嫖）
  const auth = checkAuth(request, env);
  if (!auth.ok) return auth.resp;

  // 使用你提供的 Key（建议未来在 Cloudflare 后台设置环境变量 MINERU_API_KEY）
  const token = env.MINERU_API_KEY || "rzb2ml4kowredxq3b5dpgxo8r7ojagkxqv1ydvjz";
  
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  try {
    // 动作 1：获取云端直传的 OSS URL (前端直传，不占 Worker 内存)
    if (request.method === 'POST' && action === 'get_upload_url') {
      const body = await request.json();
      const res = await fetch(`${MINERU_BASE_URL}/file-urls/batch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ files: [{ filename: body.filename || "book.pdf", data_id: "1" }] })
      });
      return json(await res.json());
    }
    
    // 动作 2：触发 MinerU 开始解析任务
    if (request.method === 'POST' && action === 'start_task') {
      const body = await request.json();
      if (!body.file_url) return json({error: "缺少 file_url"}, 400);

      const res = await fetch(`${MINERU_BASE_URL}/extract/task`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url: body.file_url,
          is_ocr: true,          // 必须开启 OCR
          enable_formula: true   // 必须开启公式识别
        })
      });
      return json(await res.json());
    }
    
    // 动作 3：查询任务进度
    if (request.method === 'GET' && action === 'status') {
      const taskId = url.searchParams.get('task_id');
      if (!taskId) return json({error: "缺少 task_id"}, 400);
      
      const res = await fetch(`${MINERU_BASE_URL}/extract/task/${taskId}`, {
        method: 'GET',
        headers
      });
      return json(await res.json());
    }

    return json({error: "无效的 Action"}, 400);
  } catch (err) {
    return json({error: err.message}, 500);
  }
}
