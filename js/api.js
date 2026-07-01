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

    // —— 离线存储（IndexedDB）——
    _offDB() {
      return this.__offDB || (this.__offDB = new Promise((res, rej) => {
        try {
          const r = indexedDB.open('zb_offline', 1);
          r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('get')) db.createObjectStore('get'); if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { autoIncrement: true }); };
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
    _setOffline(v) { if (this.offline !== v) { this.offline = v; if (!v) this._offFlush(); } },
  }
};
