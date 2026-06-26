import { json, checkAuth } from './_utils.js';

const MINERU_BASE_URL = 'https://mineru.net/api/v4';

export async function onRequest(context) {
  const { request, env } = context;
  
  // 1. 鉴权保护
  const auth = checkAuth(request, env);
  if (!auth.ok) return auth.resp;

  // 2. 获取 MinerU JWT Token 
  // 请在 Cloudflare Pages 设置里添加环境变量 MINERU_API_KEY
  const token = env.MINERU_API_KEY || "rzb2ml4kowredxq3b5dpgxo8r7ojagkxqv1ydvjz";
  
  const headers = {
    "Authorization": `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  try {
    if (request.method === 'POST' && action === 'get_upload_url') {
      const body = await request.json();
      const res = await fetch(`${MINERU_BASE_URL}/file-urls/batch`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ files: [{ filename: body.filename || "book.pdf", data_id: "1" }] })
      });
      return json(await res.json());
    }
    
    if (request.method === 'POST' && action === 'start_task') {
      const body = await request.json();
      if (!body.file_url) return json({error: "缺少 file_url"}, 400);

      const res = await fetch(`${MINERU_BASE_URL}/extract/task`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          url: body.file_url,
          is_ocr: true,          
          enable_formula: true   
        })
      });
      return json(await res.json());
    }
    
    if (request.method === 'GET' && action === 'status') {
      const taskId = url.searchParams.get('task_id');
      const res = await fetch(`${MINERU_BASE_URL}/extract/task/${taskId}`, { method: 'GET', headers });
      return json(await res.json());
    }

    return json({error: "无效的 action 参数"}, 400);
  } catch (err) {
    return json({error: err.message}, 500);
  }
}
