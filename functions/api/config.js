import { json, checkAuth } from './_utils.js';

export async function onRequestGet({ request, env }) {
  const auth = await checkAuth(request, env);
  if (!auth.ok) return auth.resp;
  return json({
    ai_model: env.AI_MODEL || '',
    ai_vision_model: env.AI_VISION_MODEL || env.AI_MODEL || '',
    has_ai: !!(env.AI_BASE_URL && env.AI_API_KEY),
    has_cf_ai: !!env.AI,
  });
}
