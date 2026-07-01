// 统一管理对 /api/ 的请求、401 鉴权拦截，以及离线读写（Vue mixin，合并进主应用）
// 离线层：
//  - GET 成功 → 写入 IndexedDB(zb_offline/get)；断网(fetch 抛错) → 回退读缓存 → 已加载过的题/教材离线可读
//  - POST /api/progress 断网 → 入队(zb_offline/queue)，联网后自动补传（答题/收藏/掌握/笔记/模考不丢）
//  - 其他 POST 离线仍失败（导入等本就无法离线）
const ApiMixin = {
  methods: {
    async api(path, opts = {}) {
      const method = (opts.method || 'GET').toUpperCase();
      const headers = Object.assign({ 'authorization': 'Bearer ' + this.token }, opts.headers || {});
      if (opts.body) headers['content-type'] = 'application/json';
      let res;
      try {
        res = await fetch(path, { ...opts, headers });
      } catch (netErr) {
        // 网络不可用（离线）
        this._setOffline(true);
        if (method === 'GET') {
          const synth = await this._offSynth(path);
          if (synth !== undefined) return synth;
          const cached = await this._offGet(path);
          if (cached !== undefined) return cached;
        } else if (method === 'POST' && path.indexOf('/api/progress') === 0) {
          await this._offQueue(path, opts);
          this.offlineQueued = (this.offlineQueued || 0) + 1;
          return { queued: true, offline: true };
        }
        throw new Error('网络不可用（离线）');
      }
      let data = null; try { data = await res.json(); } catch (e) {}
      if (res.status === 401) { this.token = ''; localStorage.removeItem('zb_token'); this.view = 'settings'; this.flash('访问码无效，请重新输入', true); throw new Error('unauth'); }
      if (!res.ok) throw new Error((data && data.error) || ('请求失败 ' + res.status));
      this._setOffline(false);
      if (method === 'GET') this._offPut(path, data);
      return data;
    },

    // 带进度的下载：流式读取，回调报告已下载大小/百分比，最后解析 JSON。网络失败会抛错，交由调用方回退到离线层
    async _fetchProgress(path, onProgress) {
      const res = await fetch(path, { headers: { authorization: 'Bearer ' + this.token } });
      if (res.status === 401) { this.token = ''; try { localStorage.removeItem('zb_token'); } catch (_) {} this.view = 'settings'; throw new Error('unauth'); }
      if (!res.ok) throw new Error('请求失败 ' + res.status);
      const total = parseInt(res.headers.get('content-length') || '0', 10) || 0;
      if (!res.body || !res.body.getReader) { const d = await res.json(); this._setOffline(false); return d; }
      const reader = res.body.getReader(); const chunks = []; let loaded = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); loaded += value.length;
        if (onProgress) { const mb = loaded / 1048576; let m = mb >= 1 ? mb.toFixed(1) + ' MB' : Math.max(1, Math.round(loaded / 1024)) + ' KB'; if (total && loaded <= total) m += ' · ' + Math.round(loaded / total * 100) + '%'; onProgress(m); }
      }
      let size = 0; for (const c of chunks) size += c.length;
      const buf = new Uint8Array(size); let off = 0; for (const c of chunks) { buf.set(c, off); off += c.length; }
      this._setOffline(false);
      return JSON.parse(new TextDecoder('utf-8').decode(buf));
    },

    // —— 离线存储（IndexedDB）——
    _offDB() {
      return this.__offDB || (this.__offDB = new Promise((res, rej) => {
        try {
          const r = indexedDB.open('zb_offline', 2);
          r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('get')) db.createObjectStore('get'); if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { autoIncrement: true }); if (!db.objectStoreNames.contains('bulk')) db.createObjectStore('bulk'); };
          r.onsuccess = () => res(r.result);
          r.onerror = () => rej(r.error);
        } catch (e) { rej(e); }
      }));
    },
    async _offPut(path, data) {
      try { const db = await this._offDB(); await new Promise((res, rej) => { const tx = db.transaction('get', 'readwrite'); tx.objectStore('get').put({ data, ts: Date.now() }, path); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch (_) {}
    },
    async _offGet(path) {
      try { const db = await this._offDB(); return await new Promise((res) => { const tx = db.transaction('get', 'readonly'); const rq = tx.objectStore('get').get(path); rq.onsuccess = () => res(rq.result ? rq.result.data : undefined); rq.onerror = () => res(undefined); }); } catch (_) { return undefined; }
    },
    async _offQueue(path, opts) {
      try { const db = await this._offDB(); await new Promise((res, rej) => { const tx = db.transaction('queue', 'readwrite'); tx.objectStore('queue').put({ path, body: opts.body || '', ts: Date.now() }); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch (_) {}
    },
    async _offQueueCount() {
      try { const db = await this._offDB(); return await new Promise((res) => { const tx = db.transaction('queue', 'readonly'); const rq = tx.objectStore('queue').count(); rq.onsuccess = () => res(rq.result || 0); rq.onerror = () => res(0); }); } catch (_) { return 0; }
    },
    async _offFlush() {
      if (this._flushing || !this.token) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      this._flushing = true;
      try {
        const db = await this._offDB();
        const items = await new Promise((res) => { const tx = db.transaction('queue', 'readonly'); const out = []; const cur = tx.objectStore('queue').openCursor(); cur.onsuccess = (e) => { const c = e.target.result; if (c) { out.push({ key: c.key, val: c.value }); c.continue(); } else res(out); }; cur.onerror = () => res(out); });
        let done = 0;
        for (const it of items) {
          try {
            const r = await fetch(it.val.path, { method: 'POST', headers: { 'authorization': 'Bearer ' + this.token, 'content-type': 'application/json' }, body: it.val.body });
            if (r.ok || r.status === 401) { await new Promise((res) => { const tx = db.transaction('queue', 'readwrite'); tx.objectStore('queue').delete(it.key); tx.oncomplete = res; tx.onerror = res; }); done++; }
            else break; // 服务端错误：留着下次再补
          } catch (_) { break; } // 又断网了：停止
        }
        if (done > 0) { this.offlineQueued = await this._offQueueCount(); this.flash('已补传 ' + done + ' 条离线作答记录'); this.loadStats && this.loadStats(); }
      } catch (_) {}
      this._flushing = false;
    },
    async _offBulk(key) {
      try { const db = await this._offDB(); return await new Promise((res) => { const tx = db.transaction('bulk', 'readonly'); const rq = tx.objectStore('bulk').get(key); rq.onsuccess = () => res(rq.result != null ? rq.result : null); rq.onerror = () => res(null); }); } catch (_) { return null; }
    },
    async _offBulkPut(key, val) {
      try { const db = await this._offDB(); await new Promise((res, rej) => { const tx = db.transaction('bulk', 'readwrite'); tx.objectStore('bulk').put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); }); } catch (_) {}
    },
    // 离线合成：用预下载的全量数据，在断网时"造出"接口响应（题库/教材/筛选/统计）
    async _offSynth(path) {
      let url; try { url = new URL(path, location.origin); } catch (_) { return undefined; }
      const P = url.pathname, q = url.searchParams;
      if (P.startsWith('/api/materials')) {
        const mats = await this._offBulk('materials'); if (!mats) return undefined;
        return { items: mats, total: mats.length, _offline: true };
      }
      if (P.startsWith('/api/progress')) {
        const all = await this._offBulk('questions'); if (!all) return undefined;
        const m = new Map();
        for (const x of all) { const s = x.subject || ''; if (!m.has(s)) m.set(s, { subject: s, total_q: 0, seen: 0, wrong_open: 0, mastered: 0, favorited: 0, right_sum: 0, wrong_sum: 0 }); const o = m.get(s); const w = x.wrong_count || 0, r = x.right_count || 0; o.total_q++; if (w > 0 || r > 0) o.seen++; if (w > 0 && !x.mastered) o.wrong_open++; if (x.mastered) o.mastered++; if (x.favorited) o.favorited++; o.right_sum += r; o.wrong_sum += w; }
        return { bySubject: [...m.values()], _offline: true };
      }
      if (P.startsWith('/api/questions')) {
        const all = await this._offBulk('questions'); if (!all) return undefined;
        if (q.get('meta')) {
          const subMap = new Map(), chSet = new Set(), chaps = [];
          for (const x of all) { subMap.set(x.subject, (subMap.get(x.subject) || 0) + 1); if (x.chapter) { const k = x.subject + '|' + x.chapter; if (!chSet.has(k)) { chSet.add(k); chaps.push({ subject: x.subject, chapter: x.chapter }); } } }
          return { subjects: [...subMap].map(([subject, n]) => ({ subject, n })), chapters: chaps, _offline: true };
        }
        const subject = q.get('subject'), chapter = q.get('chapter'), type = q.get('type'), mode = q.get('mode') || 'all', order = q.get('order') || 'random', kw = (q.get('q') || '').trim();
        let arr = all.filter((x) => {
          if (subject && subject !== 'all' && x.subject !== subject) return false;
          if (chapter && x.chapter !== chapter) return false;
          if (type && x.type !== type) return false;
          const w = x.wrong_count || 0, r = x.right_count || 0;
          if (mode === 'unseen' && (w > 0 || r > 0 || x.favorited || x.mastered)) return false;
          if (mode === 'wrong' && !(w > 0 && !x.mastered)) return false;
          if (mode === 'favorite' && !x.favorited) return false;
          if (mode === 'mastered' && !x.mastered) return false;
          if (kw && !String(x.stem || '').includes(kw)) return false;
          return true;
        });
        const total = arr.length;
        if (order === 'random') { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } }
        else if (order === 'weak') { arr = arr.slice().sort((a, b) => ((b.wrong_count || 0) - (a.wrong_count || 0)) || ((a.right_count || 0) - (b.right_count || 0))); }
        const offset = parseInt(q.get('offset') || '0', 10) || 0, limit = parseInt(q.get('limit') || '30', 10) || 30;
        return { items: arr.slice(offset, offset + limit), total, _offline: true };
      }
      return undefined;
    },
    _setOffline(v) { if (this.offline !== v) { this.offline = v; if (!v) this._offFlush(); } },
  }
};
