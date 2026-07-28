// PDF 超限预处理（>100MB 无法直传 Cloudflare 时用）：
//   1) 先探测这本 PDF 有没有「文字层」——决定推荐哪种处理
//   2) 有文字层 → 推荐【无损拆分】（保住 问AI / 目录解析 所依赖的文字）
//      无文字层 → 推荐【压缩】（纯扫描图，拍平成 JPEG 零损失可用性）
//   3) 处理完直接走原有上传通道（每份都 <100MB）
const PdfToolMixin = {
  data() {
    return {
      pdfPrep: {
        open: false, file: null, buf: null, name: '', sizeMB: 0, pages: 0,
        probing: false, hasText: null, charsPerPage: 0,
        mode: '',                 // 'compress' | 'split'
        quality: 0.72, targetW: 1400, parts: 2,
        busy: false, pct: 0, msg: '', results: [],
      },
    };
  },
  methods: {
    // —— 外部库按需加载（与 ensurePdfjs 同一套 loadScript）——
    async ensureJsPdf() {
      if (window.jspdf && window.jspdf.jsPDF) return;
      await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
    },
    async ensurePdfLib() {
      if (window.PDFLib) return;
      await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js');
    },

    // 打开预处理面板：读文件 → 解析 → 探测文字层
    async pdfPrepOpen(file) {
      const P = this.pdfPrep;
      P.open = true; P.file = file; P.name = file.name; P.sizeMB = file.size / 1048576;
      P.buf = null; P.doc = null; P.pages = 0; P.hasText = null; P.charsPerPage = 0;
      P.mode = ''; P.results = []; P.busy = false; P.pct = 0;
      P.probing = true; P.msg = '读取文件…';
      try {
        await this.ensurePdfjs();
        P.buf = await file.arrayBuffer();
        P.msg = '解析 PDF…';
        // 注意：pdf.js 会「转移」传入的 ArrayBuffer，这里给它副本，原始 buf 留给拆分用
        const doc = await window.pdfjsLib.getDocument({ data: P.buf.slice(0) }).promise;
        this._prepDoc = doc; P.pages = doc.numPages;
        P.msg = '检测文字层…';
        const probe = await this._pdfProbeText(doc);
        P.charsPerPage = probe.perPage;
        P.hasText = probe.perPage >= 40;      // 每页平均 40 字符以上才算有可用文字层
        P.mode = P.hasText ? 'split' : 'compress';   // 默认选推荐项
        P.msg = '';
      } catch (e) {
        P.msg = '解析失败：' + (e.message || e);
      }
      P.probing = false;
    },
    pdfPrepClose() {
      const P = this.pdfPrep;
      if (P.busy) { if (!confirm('正在处理，确定中断？')) return; }
      P.open = false; P.file = null; P.buf = null; P.results = [];
      try { if (this._prepDoc) this._prepDoc.destroy(); } catch (_) {}
      this._prepDoc = null;
    },

    // 抽样若干页统计字符数，判断有无文字层
    async _pdfProbeText(doc) {
      const n = doc.numPages;
      const picks = [...new Set([1, Math.ceil(n * 0.3), Math.ceil(n * 0.55), Math.ceil(n * 0.8), n]
        .filter((p) => p >= 1 && p <= n))];
      let chars = 0;
      for (const p of picks) {
        try {
          const page = await doc.getPage(p);
          const tc = await page.getTextContent();
          chars += (tc.items || []).reduce((s, it) => s + ((it.str || '').length), 0);
        } catch (_) { /* 单页失败不影响判断 */ }
      }
      return { chars, perPage: picks.length ? chars / picks.length : 0 };
    },

    // —— 压缩：逐页渲染成 JPEG 重新拼 PDF（拍平，丢文字层）——
    async _pdfCompress() {
      const P = this.pdfPrep;
      await this.ensureJsPdf();
      const { jsPDF } = window.jspdf;
      const doc = this._prepDoc;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { alpha: false });
      let out = null;
      for (let i = 1; i <= doc.numPages; i++) {
        if (!P.busy) throw new Error('已取消');
        const page = await doc.getPage(i);
        const base = page.getViewport({ scale: 1 });
        const scale = Math.min(1, P.targetW / base.width);
        const vp = page.getViewport({ scale });
        canvas.width = Math.max(1, Math.round(vp.width));
        canvas.height = Math.max(1, Math.round(vp.height));
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        const jpg = canvas.toDataURL('image/jpeg', P.quality);
        const w = canvas.width, h = canvas.height;
        const orient = w > h ? 'l' : 'p';
        if (!out) out = new jsPDF({ unit: 'px', format: [w, h], orientation: orient, compress: true });
        else out.addPage([w, h], orient);
        out.addImage(jpg, 'JPEG', 0, 0, w, h);
        page.cleanup && page.cleanup();
        P.pct = Math.round(i / doc.numPages * 100);
        P.msg = '压缩中 ' + i + ' / ' + doc.numPages + ' 页';
        if (i % 5 === 0) await new Promise((r) => setTimeout(r, 0));  // 让出主线程，避免页面卡死
      }
      canvas.width = canvas.height = 0;
      const ab = out.output('arraybuffer');
      return [{ buf: ab, suffix: '' }];
    },

    // —— 拆分：按页范围无损切成 N 份（保留文字层）——
    async _pdfSplit() {
      const P = this.pdfPrep;
      await this.ensurePdfLib();
      const { PDFDocument } = window.PDFLib;
      P.msg = '载入 PDF…';
      const src = await PDFDocument.load(P.buf.slice(0), { ignoreEncryption: true });
      const total = src.getPageCount();
      const parts = Math.max(2, Math.min(6, parseInt(P.parts, 10) || 2));
      const per = Math.ceil(total / parts);
      const outs = [];
      for (let i = 0; i < parts; i++) {
        if (!P.busy) throw new Error('已取消');
        const from = i * per, to = Math.min((i + 1) * per, total);
        if (from >= to) break;
        const d = await PDFDocument.create();
        const idx = []; for (let p = from; p < to; p++) idx.push(p);
        const pages = await d.copyPages(src, idx);
        pages.forEach((pg) => d.addPage(pg));
        const bytes = await d.save();
        outs.push({ buf: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          suffix: '（' + (from + 1) + '-' + to + ' 页）' });
        P.pct = Math.round((i + 1) / parts * 100);
        P.msg = '拆分中 ' + (i + 1) + ' / ' + parts;
        await new Promise((r) => setTimeout(r, 0));
      }
      return outs;
    },

    // 执行处理 → 逐份上传
    async pdfPrepRun() {
      const P = this.pdfPrep;
      if (!P.buf || P.busy) return;
      P.busy = true; P.pct = 0; P.results = [];
      try {
        const parts = P.mode === 'compress' ? await this._pdfCompress() : await this._pdfSplit();
        const over = parts.filter((x) => x.buf.byteLength > 100 * 1048576);
        if (over.length) {
          P.msg = '';
          const mb = (over[0].buf.byteLength / 1048576).toFixed(1);
          throw new Error('处理后仍有分片 ' + mb + 'MB 超过 100MB 上限。'
            + (P.mode === 'compress' ? '请把「目标宽度」或「画质」调低些再试。' : '请把份数调大些再试。'));
        }
        const baseTitle = (this.ingest.bookTitle || '').trim() || P.name.replace(/\.pdf$/i, '');
        const subject = this.guessSubject(P.name) || this.ingest.subject || 'computer';
        for (let i = 0; i < parts.length; i++) {
          P.msg = '上传 ' + (i + 1) + ' / ' + parts.length + '…'; P.pct = 0;
          await this._pdfPutBuf(parts[i].buf, baseTitle + parts[i].suffix, subject, (pc) => { P.pct = pc; });
          P.results.push(baseTitle + parts[i].suffix);
        }
        P.msg = '';
        this.flash('已完成：' + P.results.length + ' 个文件已上传到云端');
        await this.loadPdfShelf();
        P.busy = false;
        this.pdfPrepClose();
      } catch (e) {
        P.msg = e.message || String(e);
        this.flash(P.msg, true);
        P.busy = false;
      }
    },

    // 复用上传通道（带进度回调）
    _pdfPutBuf(buf, title, subject, onPct) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', '/api/pdfs?title=' + encodeURIComponent(title) + '&subject=' + encodeURIComponent(subject));
        xhr.setRequestHeader('authorization', 'Bearer ' + this.token);
        xhr.setRequestHeader('content-type', 'application/pdf');
        xhr.upload.onprogress = (ev) => { if (ev.lengthComputable && onPct) onPct(Math.round(ev.loaded / ev.total * 100)); };
        xhr.onload = () => {
          const ct = xhr.getResponseHeader('content-type') || '';
          let d = null; if (ct.includes('json')) { try { d = JSON.parse(xhr.responseText); } catch (_) {} }
          if (xhr.status === 401) { this.token = ''; localStorage.removeItem('zb_token'); this.view = 'settings'; reject(new Error('访问码无效')); return; }
          if (xhr.status === 413) { reject(new Error('分片仍超过 100MB 上限，请调低画质或增加份数')); return; }
          if (xhr.status === 404) { reject(new Error('上传接口不可用：请确认已部署 functions/api/pdfs.js，并绑定 R2（PDF_BUCKET）后重新部署一次')); return; }
          if (!ct.includes('json')) { reject(new Error('上传失败（HTTP ' + xhr.status + '）：服务端返回非 JSON')); return; }
          if (xhr.status < 200 || xhr.status >= 300) { reject(new Error((d && d.error) || ('上传失败 HTTP ' + xhr.status))); return; }
          resolve(d);
        };
        xhr.onerror = () => reject(new Error('网络错误，上传中断'));
        xhr.send(buf);
      });
    },
  },
};
