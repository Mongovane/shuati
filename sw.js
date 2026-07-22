/* 刷题文档 Service Worker
   策略：
   - 应用外壳（本站 html/css/js/图标）：预缓存 + 网络优先(3.5s 超时)回退缓存 → 联网时拿最新，弱网/离线时秒开缓存
   - CDN 静态资源（Vue / marked / highlight.js / KaTeX 的 CSS·JS·字体）：缓存优先 → 只下一次，之后离线可用
   - /api/*：始终走网络（题目/统计等动态数据、带鉴权，不缓存）
   改了应用文件想强制刷新预缓存时，把下面 VERSION 加一即可（联网时其实已自动拿最新）。 */
const VERSION = 'v113';
const CACHE = 'shuati-' + VERSION;
const CDN_ORIGIN = 'https://cdnjs.cloudflare.com';
const CORE = [
  './', './index.html', './manifest.json',
  './css/style.css?v=113',
  './js/constants.js?v=113',
  './js/components/rich-text.js?v=113',
  './js/components/question-card.js?v=113',
  './js/api.js?v=113',
  './js/components/reader.js?v=113',
  './js/views/practice.js?v=113',
  './js/views/bank.js?v=113',
  './js/views/saved.js?v=113',
  './js/views/mock-stats.js?v=113',
  './js/views/ingest.js?v=113',
  './js/views/mineru.js?v=113',
  './js/views/books.js?v=113',
  './js/views/settings.js?v=113',
  './js/tpl/shell-open.js?v=113',
  './js/tpl/view-practice.js?v=113',
  './js/tpl/view-books.js?v=113',
  './js/tpl/view-mock.js?v=113',
  './js/tpl/view-bank.js?v=113',
  './js/tpl/view-stats.js?v=113',
  './js/tpl/view-ingest.js?v=113',
  './js/tpl/view-settings.js?v=113',
  './js/tpl/shell-close.js?v=113',
  './js/app-template.js?v=113',
  './js/app.js?v=113',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-180.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // 单个资源缺失不应导致整体安装失败
    await Promise.all(CORE.map((u) => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('shuati-') && k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) {
    const c = await caches.open(CACHE);
    c.put(req, res.clone());
  }
  return res;
}

async function networkFirst(req) {
  const c = await caches.open(CACHE);
  try {
    const res = await Promise.race([
      fetch(req, { cache: 'no-cache' }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3500))
    ]);
    if (res && res.ok) c.put(req, res.clone());
    return res;
  } catch (err) {
    const cached = await c.match(req);
    if (cached) return cached;
    if (req.mode === 'navigate') {
      const idx = (await c.match('./index.html')) || (await c.match('./'));
      if (idx) return idx;
    }
    throw err;
  }
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                 // 非 GET 直接放行
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return; // API 走网络
  if (url.origin === CDN_ORIGIN) { e.respondWith(cacheFirst(req)); return; }           // CDN/字体：缓存优先
  if (url.origin === self.location.origin) { e.respondWith(networkFirst(req)); return; } // 本站外壳：网络优先回退缓存
  // 其他跨域请求交给浏览器默认处理
});
