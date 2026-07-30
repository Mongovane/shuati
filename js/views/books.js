// 教材阅读（Books）与 PDF 书架 / PDF 阅读器
// —— 由 app.js 按功能域拆分而来；与其余 mixin 合并进同一个 Vue 实例，this.* 跨文件可用 ——
// 正在补正文的 material id（模块级，不放实例上——同 app.js 的 qCache 用法）：
// loadMaterials 结尾会补一次，currentBookId 的 watcher 也会补一次，用它去重避免同批重复下载。
const matFilling = new Map();   // id -> 正在拉这一页的 Promise
const BooksMixin = { methods: {
bookKeyOf(m){ const s=String(m.source||'').replace(/[-_\s]*P\d+\s*$/i,'').trim(); if(s)return s; const t=String(m.title||'').replace(/\s*·?\s*第\s*\d+\s*页\s*$/,'').trim(); return t||'未命名教材'; },
async setBookSubject(subj){ const b=this.currentBook; if(!b)return; await this._setBookSubjectPages(b,subj); },
// 书架层级改科目：对任意一本书（不必打开）修改其所有页的科目
async setBookSubjectByKey(book,subj){ if(!book||!subj)return; await this._setBookSubjectPages(book,subj); },
// 从科目选择弹窗确认
async pickBookSubject(subj){ const b=this.bookSubjPick.book; const val=String(subj||'').trim(); if(!val){ this.flash('请输入分类名',true); return; } this.bookSubjPick.open=false; this.bookSubjPick.custom=''; if(!b||b.subject===val)return; await this._setBookSubjectPages(b,val); },
async _setBookSubjectPages(b,subj){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } const ids=(b.pages||[]).map(m=>m.id).filter(Boolean); if(!ids.length)return; this.materials.loading=true; try{ await this.api('/api/materials',{method:'PATCH',body:JSON.stringify({ids,subject:subj})}); this.flash('已将《'+b.title+'》归到「'+this.subjName(subj)+'」'); await this.loadMaterials(); }catch(e){ if(e.message!=='unauth')this.flash(e.message||'修改科目失败',true); } this.materials.loading=false; },
rewriteMdImages(s){ return String(s||'').replace(/\]\(\s*\.?\/?public\//g,'](/').replace(/\]\(\s*textbooks-pages\//g,'](/textbooks-pages/').replace(/(<img[^>]*\bsrc=["'])\.?\/?public\//g,'$1/'); },
// 书名一律取 source（导入时写入的干净书名）。
// 不能用 title：它是「书名 · 该页首行标题」，首行是公式时 firstHeadingOf 会把
// $\int_{0}^{+\infty}...$ 剥成 int {0} ^ {+ infty} 这种垃圾跟着进书名。
bookTitleOf(m){ const s=String(m.source||'').replace(/[-_\s]*P\d+\s*$/i,'').trim(); if(s)return s;
      const t=String(m.title||'').replace(/\s*·?\s*第\s*\d+\s*页\s*$/,'').trim(); return t || this.bookKeyOf(m); },
// 页标题优先按「书本自带的目录页」命名（而不是猜正文首行）：
// 取目录里页码 ≤ 本页的最后一条，就是本页所属的最细一级小节。
pageLabelFromOutline(m){ if(!m)return ''; const pg=Number(m.page)||0; if(pg<=0)return '';
      const out=this.bookOutline||[]; if(!out.length)return '';
      let hit=null; for(const o of out){ if(o.page<=pg)hit=o; else break; }
      return hit? String(hit.title||'').trim() : ''; },
pageLabel(m){ if(!m)return '';
      const pgTxt=m.page?('第'+m.page+'页'):'';
      const toc=this.pageLabelFromOutline(m);        // 优先用书本目录里的小节名
      if(toc)return pgTxt? (toc+' · '+pgTxt) : toc;
      const lines=String(m.content_md||'').split('\n'); let head=''; for(let ln of lines){ ln=ln.trim(); if(!ln)continue; if(/^!\[/.test(ln))continue; if(/^\$\$/.test(ln)||ln==='$$')continue; if(/^<[a-zA-Z!/]/.test(ln))continue; if(/^[>|`]/.test(ln))continue; { const lc=ln.replace(/\\text\s*\{[^}]*\}/g,''); if(!/[\u4e00-\u9fa5]/.test(lc)&&/\\[a-zA-Z]{2,}|[\^_]\s*\{|\\frac|\\sqrt|\\begin|\\mid|\\left|\\overrightarrow|\\boldsymbol/.test(lc))continue; } if(this._mineruJunk&&this._mineruJunk(ln))continue; let clean=ln.replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/<[^>]*>?/g,'').replace(/\$[^$]*\$/g,' ').replace(/[#*`>$]/g,'').replace(/\s{2,}/g,' ').trim(); if(!clean)continue; const mt=clean.match(/^(第[一二三四五六七八九十百零\d]+[章节][^。.]{0,24}|\d+(?:\.\d+){0,3}[\s、.][^。.]{0,24})/); head=(mt?mt[0]:clean).slice(0,24); break; } if(head&&pgTxt)return head+' · '+pgTxt; return head||pgTxt||this.bookTitleOf(m)||'未命名'; },
async deleteCurrentBook(){ return this.deleteBook(this.currentBook); },
// 删除指定书（卡片上的删除入口）：删其全部页；若删的是当前打开的书则退出阅读
async deleteBook(b){ if(!b){ this.flash('请先选择书籍',true); return; } if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } if(!confirm('确定删除《'+b.title+'》及其全部 '+b.pages.length+' 页？此操作不可恢复（题库不受影响）。')) return; const ids=b.pages.map(m=>m.id).filter(Boolean); try{ const d=await this.api('/api/materials',{method:'DELETE',body:JSON.stringify({ids})}); this.flash('已删除《'+b.title+'》，共 '+(d.deleted||ids.length)+' 页'); try{ localStorage.removeItem('zb_readpos:'+b.key); }catch(_){ } if(this.currentBookId===b.key){ this.currentBookId=''; this.bookIdx=0; } await this.loadMaterials(); }catch(e){ if(e.message!=='unauth')this.flash('删除失败：'+e.message,true); } },
// 数字进度：total>0 时前端进度条走确定进度并显示 百分比 · cur/total
_setProg(cur,total,unit){ const t=Math.max(0,total|0), c=Math.min(Math.max(0,cur|0),t||Infinity);
      this.matProg={ cur:c, total:t, pct: t? Math.min(100,Math.round(c/t*100)) : 0, unit:unit||'段' }; },
_clearProg(){ this.matProg={ cur:0, total:0, pct:0, unit:'段' }; },
async loadMaterials(){ if(!this.token){ this.materials.loaded=true; return; } this.materials.loading=true; this.loadProgMsg='正在请求…';
      // 书架只拉元信息（meta=1，不含 content_md）并翻页拉全：
      // 旧版是「一次 ?limit=500 拿全部含正文的行」，服务端又把 limit 硬夹到 500——
      // 书一多（例如 388 页 + 112 页正好 500 行）窗口就被占满，且按 created_at DESC 排序，
      // 新导入的书会把旧书顶出窗口，表现为「书架永远只有两本，新导入的把旧的替换掉」。
      const PAGE=2000; let all=[]; let off=0; let over=false;
      try{
        for(let i=0;i<50;i++){
          const d=await this.api('/api/materials?meta=1&limit='+PAGE+'&offset='+off+(i===0?'&count=1':''));
          if(i===0 && d.total!=null)this._setProg(0, d.total, '段');
          const items=d.items||[]; all=all.concat(items);
          this._setProg(all.length, this.matProg.total||all.length, '段');
          this.loadProgMsg='正在读取目录…';
          if(items.length<PAGE)break;          // 没拿满一页 = 已到底
          if(d._offline)break;                 // 离线合成的响应一次给全量、不认 offset，别再翻
          off+=items.length;
          if(i===49)over=true;                 // 兜底：10 万段还没到底，别死循环
        }
        this.materials.items=all;
        if(!this.currentBook&&this.materialBooks[0])this.currentBookId=this.materialBooks[0].key;
        this.loadProgMsg='共 '+this.materialBooks.length+' 本 · '+all.length+' 段'+(over?'（已达上限，仍有未载入）':'');
        this._clearProg();
        await this.ensureBookContent();
      }catch(e){
        if(e.message==='unauth'){ this.materials.loading=false; this.materials.loaded=true; this.loadProgMsg=''; return; }
        this.flash('载入书架失败：'+e.message,true); this.loadProgMsg='';
      }
      this._clearProg(); this.materials.loading=false; this.materials.loaded=true; },
// 书架只有元信息（没有 content_md），真正要读/抽题/建目录时才把这一本的正文补齐。
// matFilling 是 id -> 正在拉这一页的 Promise。关键点：撞上在途必须 **await 同一个 Promise**，
// 不能「看到在途就直接 return」——那样 ensureBookContent 根本没"确保"到任何事，
// 整本抽题会在正文只载入一半时开跑，静默少掉几百道题（线上实测 665 → 430）。
async ensureBookContent(book){
      book=book||this.currentBook; if(!book||!book.pages||!book.pages.length)return;
      for(let round=0;round<3;round++){          // 拉完自己那批，再回头确认没有别人漏下的
        const miss=book.pages.filter(m=>m&&m.content_md===undefined).map(m=>m.id).filter(Boolean);
        if(!miss.length)return;
        const waiting=[]; const todo=[];
        for(const id of miss){ const p=matFilling.get(id); if(p)waiting.push(p); else todo.push(id); }
        if(todo.length)await this._fillMatContent(todo, book.title||'');
        if(waiting.length)await Promise.allSettled(waiting);
        if(!todo.length&&!waiting.length)return;
      } },
// 整批共用一个 Promise 并登记到 matFilling：并发进来的调用方 await 它即可，
// 既不重复下载，也不会提前返回。
async _fillMatContent(ids,title){
      const p=this._runMatFill(ids,title);
      for(const id of ids)matFilling.set(id,p);
      try{ await p; }
      finally{ for(const id of ids)if(matFilling.get(id)===p)matFilling.delete(id); } },
async _runMatFill(ids,title){
      this.materials.loading=true; this._setProg(0, ids.length, '页');
      try{
        const CH=20; let done=0;   // 单页正文可能内嵌 base64 图（几百 KB），一次别要太多
        for(let i=0;i<ids.length;i+=CH){
          const part=ids.slice(i,i+CH);
          this.loadProgMsg='正在载入《'+title+'》';
          const d=await this.api('/api/materials?ids='+encodeURIComponent(part.join(',')));
          // 合并时才查 items：中途若整体替换过 materials.items，早先的快照会变成孤儿对象，
          // 正文写进去等于白下载（线上「已载入正文 0」就是这么来的）。
          const byId=new Map(); for(const m of (this.materials.items||[])){ if(m&&m.id)byId.set(m.id,m); }
          for(const r of (d.items||[])){ const m=byId.get(r.id); if(m)Object.assign(m,r); }
          done+=part.length; this._setProg(done, ids.length, '页');
          if(d._offline)break;               // 离线合成一次就给全量，已经都填上了
        }
        this.loadProgMsg='';
      }catch(e){ if(e.message!=='unauth')this.flash('载入《'+title+'》内容失败：'+e.message,true); this.loadProgMsg=''; }
      this._clearProg(); this.materials.loading=false; },
// 抽题前的兜底自检：宁可报错，也别拿半本正文静默少抽
matMissingCount(book){ book=book||this.currentBook; if(!book||!book.pages)return 0;
      return book.pages.filter(m=>!m||m.content_md===undefined).length; },
bookHashId(str){ let h=5381; const s=String(str); for(let i=0;i<s.length;i++){ h=((h<<5)+h+s.charCodeAt(i))>>>0; } return h.toString(36); },
flashPageRender(){ this.pageRendering=true; try{ requestAnimationFrame(()=>requestAnimationFrame(()=>{ this.pageRendering=false; })); }catch(_){ this.$nextTick(()=>{ this.pageRendering=false; }); } },
bookGoto(i){ const b=this.currentBook; if(!b)return; const ni=Math.min(Math.max(0,i),b.pages.length-1); if(ni!==this.bookIdx)this.flashPageRender(); this.bookIdx=ni; this.bookTocOpen=false; },
bookPrev(){ this.bookGoto(this.bookIdx-1); },
bookNext(){ this.bookGoto(this.bookIdx+1); },
bookJumpPage(p){ const b=this.currentBook; if(!b)return; const n=parseInt(p,10); if(!Number.isFinite(n))return; const idx=b.pages.findIndex(m=>Number(m.page)===n); if(idx>=0)this.bookGoto(idx); else this.flash('没有第 '+n+' 页',true); },
// 跳到「书内页码」最接近 n 的那一篇（目录里的页码常和整理后的分篇页码不完全一致，取 ≤n 的最大页）
bookGotoBookPage(n){ const b=this.currentBook; if(!b||!Number.isFinite(n))return; let best=-1,bestPg=-1; b.pages.forEach((m,i)=>{ const pg=Number(m.page)||0; if(pg<=n && pg>bestPg){ bestPg=pg; best=i; } }); if(best<0){ best=0; } this.bookGoto(best); this.bookTocOpen=false; },
parseBookOutline(tocText){ if(!tocText)return []; const items=[]; const re=/((?:[^\n.\u2026]|\.(?!\.))+?)\s*(?:\.{2,}|\u2026+)\s*(\d{1,4})/g; let mm;
      while((mm=re.exec(tocText))!==null){ const title=mm[1].replace(/^[\s*#>]+/,'').trim(); const page=parseInt(mm[2],10);
        if(!title||!Number.isFinite(page))continue;
        // 层级判断：第X章/篇=0；第X节=1；"1.2 xx"=2；"1 xx"=1；习题类=1；其余=0
        let level=0;
        if(/^第[一二三四五六七八九十百零\d]+\s*[章篇]/.test(title)) level=0;
        else if(/^第[一二三四五六七八九十百零\d]+\s*节/.test(title)) level=1;
        else if(/^\d+\.\d+/.test(title)) level=2;
        else if(/^\d+[\s、.]/.test(title)) level=1;
        else if(/^\*?(习题|总习题|本章小结|小结|思考题|练习|复习题)/.test(title)) level=1;
        items.push({ title:title.slice(0,50), page, level }); if(items.length>=400)break; }
      return items; },
async genQuestionsFromMaterial(){ const m=this.currentPageMat; if(!m){ this.flash('请先选择教材页',true); return; } if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } if(!this.ai.hasAI && !(this.explainCfg&&this.explainCfg.base&&this.explainCfg.key)){ this.flash('未配置 AI 中转站：可在设置中填入你自己的',true); return; } if(this._genqCtrl){ try{ this._genqCtrl.abort(); }catch(_){} } const ctrl=new AbortController(); this._genqCtrl=ctrl; this.genq.busy=true; this.genq.result=null; try{ const d=await this.api('/api/process',{method:'POST',signal:ctrl.signal,body:JSON.stringify({...this.aiOv(false),subject:m.subject,chapter:m.summary||'',source:'教材出题-'+(m.title||''),kind:'questions',raw_text:String(m.content_md||'').slice(0,8000)})}); this.genq.result=d; this.flash('已根据本页教材生成 '+(d.inserted_questions??d.inserted??0)+' 道题'); this.loadMeta(true); this.statsDirty=true; this.bankDirty=true; }catch(e){ if(e.name!=='AbortError' && e.message!=='unauth')this.flash('生成题目失败：'+e.message,true); } this.genq.busy=false; if(this._genqCtrl===ctrl)this._genqCtrl=null; },
// 停止 AI 出题
genqStop(){ if(this._genqCtrl){ try{ this._genqCtrl.abort(); }catch(_){} } this.genq.busy=false; this.flash('已停止出题'); },
async pdfvPageText(n){ try{ const doc=this._pdfvDoc; if(!doc)return ''; const page=await doc.getPage(n||this.pdfv.cur);
    const tc=await page.getTextContent(); let last=null, out='';
    for(const it of tc.items){ const s=it.str||''; if(!s){ continue; }
      // 依据 y 坐标换行：不同行之间补换行，同行拼接
      if(last!==null && Math.abs((it.transform&&it.transform[5]||0)-last)>3) out+='\n';
      out+=s + (it.hasEOL?'\n':''); last=it.transform&&it.transform[5]||last; }
    return out.replace(/\n{3,}/g,'\n\n').trim(); }catch(_){ return ''; } },
async pdfvPageImage(n){ try{ const doc=this._pdfvDoc; if(!doc)return ''; const page=await doc.getPage(n||this.pdfv.cur);
    const vp1=page.getViewport({scale:1}); const targetW=1400; const scale=Math.min(2.2, targetW/vp1.width);
    const vp=page.getViewport({scale}); const cv=document.createElement('canvas'); cv.width=Math.floor(vp.width); cv.height=Math.floor(vp.height);
    await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
    return cv.toDataURL('image/jpeg',0.82); }catch(_){ return ''; } },
pdfAiOpen(){ this.pdfAi.open=true; this.pdfAi.pageAtOpen=this.pdfv.cur;
    this.$nextTick(()=>{ const el=this.$refs.pdfAiInp; if(el)el.focus(); }); },
async pdfAiSend(){ const q=(this.pdfAi.input||'').trim(); if(!q||this.pdfAi.asking)return;
    if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
    if(!(this.ai.hasAI || (this.explainCfg.base&&this.explainCfg.key))){ this.flash('未配置 AI 中转站：可在设置中填入你自己的',true); return; }
    const pageNo=this.pdfv.cur;
    let pageText=this.pdfAi._cacheP===pageNo ? this.pdfAi._cacheT : '';
    if(!pageText){ pageText=await this.pdfvPageText(pageNo); this.pdfAi._cacheP=pageNo; this.pdfAi._cacheT=pageText; }
    if(this._pdfAiCtrl){ try{ this._pdfAiCtrl.abort(); }catch(_){} }
    const ctrl=new AbortController(); this._pdfAiCtrl=ctrl;
    const entry={ q, a:'', page:pageNo }; this.pdfAi.chat.push(entry); this.pdfAi.asking=true; this.pdfAi.input='';
    const history=[]; for(const c of this.pdfAi.chat.slice(0,-1)){ history.push({role:'user',content:c.q}); if(c.a&&!c.err)history.push({role:'assistant',content:c.a}); }
    try{
      let reqBody;
      if(pageText){
        reqBody={ ...this.aiOv(false), mode:'reading',
          question:{ stem:'（针对 PDF《'+(this.pdfv.title||'')+'》第 '+pageNo+' 页提问）', passage:pageText.slice(0,4000), type:'short_answer', subject:'教材' },
          analysis:'', history, ask:q };
      } else {
        entry._vision=true;
        let img=(this.pdfAi._cacheImgP===pageNo) ? this.pdfAi._cacheImg : '';
        if(!img){ img=await this.pdfvPageImage(pageNo); this.pdfAi._cacheImg=img; this.pdfAi._cacheImgP=pageNo; }
        if(!img) throw new Error('本页无法提取文字也无法渲染为图片，请换文字版 PDF 或用「拍照识题」');
        reqBody={ ...this.aiOv(true), mode:'reading', image:img,
          question:{ stem:'（针对 PDF《'+(this.pdfv.title||'')+'》第 '+pageNo+' 页的图片提问，请先识别图中文字再回答）', type:'short_answer', subject:'教材' },
          analysis:'', history, ask:q };
      }
      const r=await this.aiFetch(reqBody, ctrl.signal, (d)=>{ if(d.reset)entry.a=''; if(d.text)entry.a=d.acc; });
      if(r.res && r.res.status===401){ this.token=''; localStorage.removeItem('zb_token'); this.pdfvClose(); this.go('settings'); throw new Error('访问码无效'); }
      if(!r.ok){ let msg=r.errText||''; if(!msg){ try{ const d=await r.res.json(); msg=(d&&d.error)||('HTTP '+r.res.status); }catch(_){ msg='HTTP '+(r.res?r.res.status:'?'); } } throw new Error(msg); }
      if(!entry.a) entry.a='_（模型没有返回内容）_';
    }catch(e){ if(e.name!=='AbortError'){ let msg=e.message||'未知错误'; if(/429/.test(msg))msg+='（中转站限流，稍等几秒再重试）'; else if(/Failed to fetch|NetworkError|HTTP2|PROTOCOL|stream/i.test(msg))msg='网络异常，请检查网络后重试'; entry.a='_回答失败：'+msg+'_'; entry.err=true; this.flash('提问失败：'+msg,true); } }
    this.pdfAi.asking=false; if(this._pdfAiCtrl===ctrl)this._pdfAiCtrl=null; },
pdfAiRetry(i){ const c=this.pdfAi.chat[i]; if(!c||!c.err||this.pdfAi.asking)return; const q=c.q; this.pdfAi.chat.splice(i,1); this.pdfAi.input=q; return this.pdfAiSend(); },
// 停止：中止进行中的 PDF 问答请求（已流式返回的部分内容保留）
pdfAiStop(){ if(this._pdfAiCtrl){ try{ this._pdfAiCtrl.abort(); }catch(_){} } const last=this.pdfAi.chat[this.pdfAi.chat.length-1]; if(last && this.pdfAi.asking && !last.a) last.a='_（已停止）_'; this.pdfAi.asking=false; },
// 切换/关闭 PDF 时重置问 AI：中止进行中请求、清空对话与页缓存（避免残留上一本 PDF 的记录）
_pdfAiReset(){ if(this._pdfAiCtrl){ try{ this._pdfAiCtrl.abort(); }catch(_){} this._pdfAiCtrl=null; } this.pdfAi.open=false; this.pdfAi.asking=false; this.pdfAi.input=''; this.pdfAi.chat=[]; this.pdfAi.pageAtOpen=0; this.pdfAi._cacheP=0; this.pdfAi._cacheT=''; this.pdfAi._cacheImgP=0; this.pdfAi._cacheImg=''; },
async pdfvOpenLocal(e){ const f=e.target.files&&e.target.files[0]; if(!f)return; await this.pdfvOpenSrc(await f.arrayBuffer(), f.name.replace(/\.pdf$/i,'')); },
_isMobile(){ try{ const coarse=window.matchMedia&&window.matchMedia('(pointer:coarse)').matches; return !!coarse && (window.innerWidth||9999)<=900; }catch(_){ return (window.innerWidth||9999)<=820; } },
async pdfvOpenSrc(buf,title){ this._pdfAiReset(); this.pdfv.loading=true; this.pdfv.msg=this.pdfv.msg||'解析中…'; try{ await this.ensurePdfjs(); const task=window.pdfjsLib.getDocument({data:buf}); if(task.onProgress!==undefined){ task.onProgress=(p)=>{ if(p&&p.total)this.pdfv.msg='解析中 '+Math.round(p.loaded/p.total*100)+'%'; }; } const doc=await task.promise; this._pdfvDoc=doc; this.pdfv.pages=doc.numPages; this.pdfv.title=title||'PDF'; this.pdfvMobile=this._isMobile(); this.pdfvLoadOutline(); try{ this.pdfv.invert=localStorage.getItem('zb_pdf_invert')==='1'; }catch(_){}
        let pref=''; try{ pref=localStorage.getItem('zb_pdfmode')||''; }catch(_){}
        this.pdfv.mode = this.pdfvMobile ? 'page' : (pref==='page'?'page':'scroll');
        let saved=1; try{ saved=Math.min(Math.max(1,parseInt(localStorage.getItem(this._pdfvPosKey())||'1',10)||1),this.pdfv.pages); }catch(_){ saved=1; }
        this.pdfv.cur=saved; this.pdfv.open=true;
        this.$nextTick(()=>{ if(this.pdfv.mode==='page'){ this.pdfvRenderSingle(); } else { this.pdfvSetupPages(saved>1); } this.pdfvSetupThumbs(); if(saved>1)this.flash('已回到上次阅读的第 '+saved+' 页'); });
      }catch(e){ this.flash('PDF 解析失败：'+e.message,true); } this.pdfv.loading=false; this.pdfv.msg=''; },
_pdfvPosKey(){ return 'zb_pdfpos:'+(this.pdfv.title||'PDF'); },
pdfvSavePos(){ try{ localStorage.setItem(this._pdfvPosKey(), String(this.pdfv.cur)); }catch(_){} },
pdfvToggleMode(){ this.pdfv.mode = this.pdfv.mode==='scroll' ? 'page' : 'scroll'; try{ localStorage.setItem('zb_pdfmode', this.pdfv.mode); }catch(_){} const cur=this.pdfv.cur; this._pdfvQueue=[]; this._pdfvBusy=false; if(this.pdfv.mode==='page'){ if(this._pdfvObsR)this._pdfvObsR.disconnect(); const main=this.$refs.pdfvMain; if(main&&this._pdfvScroll)main.removeEventListener('scroll',this._pdfvScroll); this.$nextTick(()=>this.pdfvRenderSingle()); } else { this.$nextTick(()=>{ this.pdfvSetupPages(false); this.pdfvSetupThumbs(); this.$nextTick(()=>this.pdfvGoto(cur)); }); } },
pdfvScrollCardTop(){ try{ const card=document.querySelector('.pdfv'); if(!card)return; const tb=document.querySelector('.topbar'); const off=(tb?tb.getBoundingClientRect().height:90)+8; const y=window.scrollY+card.getBoundingClientRect().top-off; window.scrollTo({top:Math.max(0,y), behavior:'auto'}); }catch(_){} },
async pdfvRenderSingle(opts){ opts=opts||{}; const doc=this._pdfvDoc, cv=this.$refs.pdfvSingle; if(!doc||!cv)return; const token=(this._pdfvSingleToken=(this._pdfvSingleToken||0)+1); if(this._pdfvSingleTask){ try{ this._pdfvSingleTask.cancel(); }catch(_){ } this._pdfvSingleTask=null; } this.pdfv.rendering=true; let anchor=null; if(opts.keepScroll){ try{ const h0=cv.parentElement; if(h0){ const top0=window.scrollY+h0.getBoundingClientRect().top; anchor=(window.scrollY-top0)/(h0.offsetHeight||1); } }catch(_){ } } else { this.pdfvScrollCardTop(); } try{ const page=await doc.getPage(this.pdfv.cur); if(token!==this._pdfvSingleToken)return; const dpr=Math.min(window.devicePixelRatio||1, 3); const host=cv.parentElement; const cw=Math.max(120,((host&&host.clientWidth)||600)-20); const vp1=page.getViewport({scale:1}); const z=Number(this.pdfv.scale)||1; const cssW=cw*z; const eff=Math.min(dpr, 2400/cssW); const rscale=(cssW/vp1.width)*eff; const vp=page.getViewport({scale:rscale}); const off=document.createElement('canvas'); off.width=Math.floor(vp.width); off.height=Math.floor(vp.height); const task=page.render({canvasContext:off.getContext('2d'),viewport:vp}); this._pdfvSingleTask=task; await task.promise; if(token!==this._pdfvSingleToken)return; cv.width=off.width; cv.height=off.height; cv.style.width=Math.round(cssW)+'px'; cv.getContext('2d').drawImage(off,0,0); if(opts.keepScroll&&anchor!=null){ try{ const h1=cv.parentElement; if(h1){ const top1=window.scrollY+h1.getBoundingClientRect().top; window.scrollTo({top:Math.max(0,top1+anchor*(h1.offsetHeight||1)),behavior:'auto'}); } }catch(_){ } } }catch(e){} finally{ if(token===this._pdfvSingleToken){ this._pdfvSingleTask=null; this.pdfv.rendering=false; } } },
pdfvTouchStart(e){ const t=e.touches&&e.touches[0]; this._pdfvTx=t?t.clientX:0; this._pdfvTy=t?t.clientY:0; this._pdfvT0=Date.now();
  if(e.touches&&e.touches.length===2){ const a=e.touches[0],b=e.touches[1];
    this._pinch0=Math.hypot(b.clientX-a.clientX,b.clientY-a.clientY); this._pinchScale0=this.pdfv.scale; this._pinching=true; } },
pdfvTouchMove(e){
  if(!this._pinching && (Number(this.pdfv.scale)||1)<=1.05 && this.pdfv.mode==='page'){ if(e.cancelable)e.preventDefault(); }
  if(this._pinching && e.touches && e.touches.length===2){ e.preventDefault();
  const a=e.touches[0],b=e.touches[1]; const d=Math.hypot(b.clientX-a.clientX,b.clientY-a.clientY);
  if(this._pinch0>0){ const raw=this._pinchScale0*(d/this._pinch0); this._pinchPreview=Math.min(3,Math.max(0.5,raw));
    const el=this.$refs.pdfvMain; if(el){ el.style.setProperty('--pz', String(this._pinchPreview/this.pdfv.scale)); el.classList.add('pinching'); } } } },

pdfvTouchEnd(e){
  // 捏合落定：按预览比例重渲染
  if(this._pinching){ if(!e.touches || e.touches.length===0){ this._pinching=false;
      const el=this.$refs.pdfvMain; if(el){ el.classList.remove('pinching'); el.style.removeProperty('--pz'); }
      if(this._pinchPreview && Math.abs(this._pinchPreview-this.pdfv.scale)>0.05){ this.pdfv.scale=Math.round(this._pinchPreview*10)/10;
        if(this.pdfv.mode==='page'){ this.$nextTick(()=>this.pdfvRenderSingle({keepScroll:true})); } else { const cur=this.pdfv.cur; this.$nextTick(()=>{ this.pdfvSetupPages(false); this.$nextTick(()=>this.pdfvGoto(cur)); }); } }
      this._pinchPreview=0; }
    return; }
  const t=e.changedTouches&&e.changedTouches[0]; if(!t)return;
  const dx=t.clientX-(this._pdfvTx||0), dy=t.clientY-(this._pdfvTy||0), dt=Date.now()-(this._pdfvT0||0);
  // 双击（300ms 内两次轻点同位置）：100% ↔ 200%
  if(dt<250 && Math.abs(dx)<12 && Math.abs(dy)<12){
    const now=Date.now();
    if(this._lastTap && now-this._lastTap<320 && Math.hypot(t.clientX-this._lastTapX, t.clientY-this._lastTapY)<40){
      if(this._tapTimer){ clearTimeout(this._tapTimer); this._tapTimer=null; }
      this._lastTap=0; const target=(this.pdfv.scale>1.15)?1:2; this.pdfv.scale=target;
      if(this.pdfv.mode==='page'){ this.$nextTick(()=>this.pdfvRenderSingle({keepScroll:true})); } else { const cur=this.pdfv.cur; this.$nextTick(()=>{ this.pdfvSetupPages(false); this.$nextTick(()=>this.pdfvGoto(cur)); }); }
      return;
    }
    this._lastTap=now; this._lastTapX=t.clientX; this._lastTapY=t.clientY;
    // 单击（320ms 内无第二击）：
    // 工具栏隐藏时 → 左 30% 上一页 / 右 30% 下一页 / 中间唤回工具栏；显示时 → 整屏点击隐藏
    if(this._tapTimer)clearTimeout(this._tapTimer);
    const tapX=t.clientX;
    this._tapTimer=setTimeout(()=>{ this._tapTimer=null;
      if(this.pdfv.barsOff){
        const w=(window.innerWidth||360);
        if(tapX < w*0.3) this.pdfvPrev();
        else if(tapX > w*0.7) this.pdfvNext();
        else this.pdfv.barsOff=false;
      } else {
        this.pdfv.barsOff=true;
      }
    },330);
  }
  // 翻页：仅水平滑（竖直留给页面滚动，放大时留给平移）
  if((Number(this.pdfv.scale)||1)>1.05)return;
  if(dt<600 && Math.abs(dx)>55 && Math.abs(dx)>Math.abs(dy)*1.5){ if(this._tapTimer){ clearTimeout(this._tapTimer); this._tapTimer=null; } if(dx<0)this.pdfvNext(); else this.pdfvPrev(); } },
async pdfvSetupPages(restore){ const doc=this._pdfvDoc, main=this.$refs.pdfvMain; if(!doc||!main)return; try{ const p1=await doc.getPage(1); const vp1=p1.getViewport({scale:1}); this._pdfvAspect=vp1.height/vp1.width; this._pdfvBaseW=vp1.width; }catch(_){ this._pdfvAspect=1.414; this._pdfvBaseW=600; }
      const scale=Number(this.pdfv.scale)||1; const cw=Math.max(120,(main.clientWidth||600)-32); const dispW=Math.max(160, cw*scale); const dispH=Math.round(dispW*this._pdfvAspect); this._pdfvDispW=dispW; this._pdfvDispH=dispH;
      this._pdfvQueue=[]; this._pdfvBusy=false;
      main.querySelectorAll('.pdfv-page').forEach(el=>{ el.dataset.rendered=''; el.dataset.queued=''; el.style.height=dispH+'px'; const cv=el.querySelector('canvas'); if(cv){ cv.width=0; cv.height=0; cv.style.width=''; } });
      if(this._pdfvObsR)this._pdfvObsR.disconnect();
      const margin=(this._isMobile()?'200px':'400px')+' 0px';
      this._pdfvObsR=new IntersectionObserver((ents)=>{ for(const en of ents){ if(en.isIntersecting){ const p=parseInt(en.target.dataset.page,10); this.pdfvEnqueue(p,en.target); } } },{root:main,rootMargin:margin});
      main.querySelectorAll('.pdfv-page').forEach(el=>this._pdfvObsR.observe(el));
      if(this._pdfvScroll)main.removeEventListener('scroll',this._pdfvScroll);
      this._pdfvScroll=()=>{ if(this._pdfvRaf)return; this._pdfvRaf=requestAnimationFrame(()=>{ this._pdfvRaf=0; this.pdfvScrollSync(); }); };
      main.addEventListener('scroll',this._pdfvScroll,{passive:true});
      this.$nextTick(()=>{ for(let i=this.pdfv.cur-1;i<=this.pdfv.cur+2;i++){ const e=main.querySelector('.pdfv-page[data-page="'+i+'"]'); if(e)this.pdfvEnqueue(i,e); } });
      if(restore){ let saved=1; try{ saved=Math.min(Math.max(1,parseInt(localStorage.getItem(this._pdfvPosKey())||'1',10)||1),this.pdfv.pages); }catch(_){ saved=1; } if(saved>1){ this.$nextTick(()=>{ this.pdfvGoto(saved); }); } } },
_pdfvKeep(){ return this._isMobile()?4:8; },
pdfvEnqueue(n,el){ if(!el||el.dataset.rendered==='1'||el.dataset.queued==='1')return; if(Math.abs(n-this.pdfv.cur)>this._pdfvKeep()+2)return; el.dataset.queued='1'; this._pdfvQueue=this._pdfvQueue||[]; this._pdfvQueue.push(n); this.pdfvDrain(); },
async pdfvDrain(){ if(this._pdfvBusy)return; this._pdfvBusy=true; const main=this.$refs.pdfvMain, doc=this._pdfvDoc;
      try{ while(this._pdfvQueue&&this._pdfvQueue.length){ const n=this._pdfvQueue.shift(); if(!main||!doc)break; const el=main.querySelector('.pdfv-page[data-page="'+n+'"]'); if(!el){ continue; } el.dataset.queued=''; if(el.dataset.rendered==='1')continue; if(Math.abs(n-this.pdfv.cur)>this._pdfvKeep()+2){ continue; }
          try{ const page=await doc.getPage(n); const dpr=Math.min(window.devicePixelRatio||1, 3); const cssW=this._pdfvDispW||Math.max(160,(main.clientWidth||600)-32); const eff=Math.min(dpr, 2200/cssW); const rscale=(cssW/(this._pdfvBaseW||cssW))*eff; const vp=page.getViewport({scale:rscale}); const cv=el.querySelector('canvas'); if(!cv)continue; cv.width=Math.floor(vp.width); cv.height=Math.floor(vp.height); cv.style.width=Math.round(cssW)+'px'; await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise; el.dataset.rendered='1'; el.style.height=''; this.pdfvPrune(); }catch(e){ el.dataset.rendered=''; }
          await new Promise(r=>setTimeout(r,0)); }
      }finally{ this._pdfvBusy=false; } },
pdfvUnrender(el){ if(!el||el.dataset.rendered!=='1')return; const cv=el.querySelector('canvas'); if(cv){ cv.width=0; cv.height=0; cv.style.width=''; } el.dataset.rendered=''; if(this._pdfvDispH)el.style.height=this._pdfvDispH+'px'; },
pdfvPrune(){ const main=this.$refs.pdfvMain; if(!main)return; const KEEP=this._pdfvKeep(); const lo=this.pdfv.cur-KEEP, hi=this.pdfv.cur+KEEP; main.querySelectorAll('.pdfv-page').forEach(el=>{ if(el.dataset.rendered==='1'){ const p=parseInt(el.dataset.page,10); if(p<lo||p>hi)this.pdfvUnrender(el); } }); },
pdfvScrollSync(){ const main=this.$refs.pdfvMain; if(!main)return; const top=main.scrollTop+90; let cur=1; const els=main.querySelectorAll('.pdfv-page'); for(const el of els){ if(el.offsetTop<=top)cur=parseInt(el.dataset.page,10); else break; } for(let i=cur-1;i<=cur+2;i++){ const e=main.querySelector('.pdfv-page[data-page="'+i+'"]'); if(e)this.pdfvEnqueue(i,e); } if(cur&&cur!==this.pdfv.cur){ this.pdfv.cur=cur; this.pdfvSavePos(); this.pdfvPrune(); const t=this.$refs.pdfvRail&&this.$refs.pdfvRail.querySelector('.pdfv-thumb[data-page="'+cur+'"]'); if(t)t.scrollIntoView({block:'nearest'}); } },
async pdfvLoadOutline(){ this.pdfv.outline=[]; try{ const doc=this._pdfvDoc; if(!doc||!doc.getOutline)return;
  const raw=await doc.getOutline(); if(!raw||!raw.length)return;
  const out=[]; const walk=async(items,level)=>{ for(const it of items){ let page=0;
    try{ let dest=it.dest; if(typeof dest==='string')dest=await doc.getDestination(dest);
      if(Array.isArray(dest)&&dest[0]){ page=(await doc.getPageIndex(dest[0]))+1; } }catch(_){}
    out.push({title:(it.title||'').trim()||'(未命名)',page,level});
    if(it.items&&it.items.length&&level<3)await walk(it.items,level+1); } };
  await walk(raw,0); const fromBookmark=out.filter(o=>o.page>0);
  // 内嵌书签太粗（多为扫描版，只有章级）→ 尝试从目录页文本层解析出细分目录
  if(fromBookmark.length && fromBookmark.length<=12 && fromBookmark.every(o=>o.level===0)){
    try{ const fine=await this.pdfvOutlineFromText(fromBookmark); if(fine && fine.length>fromBookmark.length){ this.pdfv.outline=fine; return; } }catch(_){}
  }
  this.pdfv.outline=fromBookmark;
}catch(_){ this.pdfv.outline=[]; } },
// 从目录页文本层解析目录（扫描版内嵌书签粗时的回退）
async pdfvOutlineFromText(bookmarks){ const doc=this._pdfvDoc; if(!doc)return []; const maxScan=Math.min(30, doc.numPages||30); let toc='';
  for(let n=1;n<=maxScan;n++){ let t=''; try{ t=await this.pdfvPageText(n); }catch(_){ continue; }
    const looksToc=/目\s*录|CONTENTS/i.test(t.slice(0,60)) || (t.match(/\u2026{2,}\s*\d+|\.{4,}\s*\d+/g)||[]).length>=4;
    if(looksToc){ toc+='\n'+t; } else if(toc){ break; } }
  if(!toc.trim())return [];
  const items=this.parseBookOutline(toc); if(!items.length)return [];
  // 页码校正：目录里是「书内页码」，PDF 物理页常有偏移（封面/目录占前几页）。
  // 用书签第一章的 PDF 页 - 目录文本里第一章的书内页，推算偏移量。
  let offset=0;
  try{ const bm1=(bookmarks||[]).find(b=>/^第[一二三四五六七八九十百零\d]+\s*[章篇]/.test(b.title));
    const tx1=items.find(o=>o.level===0);
    if(bm1&&tx1&&bm1.page>0&&tx1.page>0){ offset=bm1.page-tx1.page; } }catch(_){}
  return items.map(o=>({ ...o, page:o.page+offset })).filter(o=>o.page>0 && o.page<=(doc.numPages||99999));
},
pdfvSliderShow(v){ this.pdfvSliderTip=String(v); },
pdfvSliderHide(){ setTimeout(()=>{ this.pdfvSliderTip=''; },250); },
pdfvToggleInvert(){ this.pdfv.invert=!this.pdfv.invert; try{ localStorage.setItem('zb_pdf_invert', this.pdfv.invert?'1':'0'); }catch(_){} },
pdfvGoto(n){ const t=Math.min(Math.max(1,parseInt(n,10)||1),this.pdfv.pages); this.pdfv.cur=t; this.pdfvSavePos(); if(this.pdfv.mode==='page'){ this.pdfvRenderSingle(); } else { const main=this.$refs.pdfvMain; if(main){ const sel='.pdfv-page[data-page="'+t+'"]'; const el=main.querySelector(sel); if(el){ for(let i=t-1;i<=t+2;i++){ const e=main.querySelector('.pdfv-page[data-page="'+i+'"]'); if(e)this.pdfvEnqueue(i,e); } main.scrollTop=el.offsetTop; this.pdfvPrune(); const fix=()=>{ const e2=main.querySelector(sel); if(e2)main.scrollTop=e2.offsetTop; }; requestAnimationFrame(fix); setTimeout(fix,180); setTimeout(fix,460); } } } const r=this.$refs.pdfvRail&&this.$refs.pdfvRail.querySelector('.pdfv-thumb[data-page="'+t+'"]'); if(r)r.scrollIntoView({block:'nearest'}); },
pdfvPrev(){ this.pdfvGoto(this.pdfv.cur-1); },
pdfvNext(){ this.pdfvGoto(this.pdfv.cur+1); },
pdfvZoom(d){ this.pdfv.scale=Math.min(3,Math.max(0.5,Math.round((this.pdfv.scale+d)*10)/10)); const cur=this.pdfv.cur; if(this.pdfv.mode==='page'){ this.$nextTick(()=>this.pdfvRenderSingle({keepScroll:true})); } else { this.$nextTick(()=>{ this.pdfvSetupPages(false); this.$nextTick(()=>this.pdfvGoto(cur)); }); } },
pdfvSetupThumbs(){ if(this._pdfvObs){ this._pdfvObs.disconnect(); this._pdfvObs=null; } const root=this.$refs.pdfvRail; if(!root||!window.IntersectionObserver)return; root.querySelectorAll('.pdfv-thumb canvas').forEach(cv=>{ cv.width=0; cv.height=0; }); this._pdfvObs=new IntersectionObserver((ents)=>{ for(const en of ents){ if(en.isIntersecting){ const p=parseInt(en.target.getAttribute('data-page'),10); this.pdfvRenderThumb(p,en.target); this._pdfvObs.unobserve(en.target); } } },{root,rootMargin:'300px'}); this.$nextTick(()=>{ root.querySelectorAll('.pdfv-thumb').forEach(el=>this._pdfvObs.observe(el)); }); },
async pdfvRenderThumb(n,el){ const doc=this._pdfvDoc; if(!doc||!el)return; try{ const page=await doc.getPage(n); const vp=page.getViewport({scale:0.28}); const cv=el.querySelector('canvas'); if(!cv)return; cv.width=Math.floor(vp.width); cv.height=Math.floor(vp.height); await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise; }catch(e){} },
pdfvClose(){ this._pdfAiReset(); this.pdfv.curId=''; this.pdfv.barsOff=false; const main=this.$refs.pdfvMain; if(main&&this._pdfvScroll)main.removeEventListener('scroll',this._pdfvScroll); this._pdfvScroll=null; this._pdfvSingleToken=(this._pdfvSingleToken||0)+1; if(this._pdfvSingleTask){ try{ this._pdfvSingleTask.cancel(); }catch(_){ } this._pdfvSingleTask=null; } this.pdfv.open=false; this._pdfvDoc=null; if(this._pdfvObs){ this._pdfvObs.disconnect(); this._pdfvObs=null; } if(this._pdfvObsR){ this._pdfvObsR.disconnect(); this._pdfvObsR=null; } },
pdfShelfBySubject(){ const g={math:[],computer:[],politics:[],english:[],other:[]}; for(const it of (this.pdfShelf.items||[])){ (g[it.subject]||g.other).push(it); } return g; },
async loadPdfShelf(){ if(!this.token)return; this.pdfShelf.loading=true; this.pdfShelf.note=''; try{ const res=await fetch('/api/pdfs',{headers:{'authorization':'Bearer '+this.token}}); const ct=res.headers.get('content-type')||''; if(res.status===404 || !ct.includes('json')){ this.pdfShelf.cloudReady=false; this.pdfShelf.note='云端未就绪：检测不到 /api/pdfs 接口。请确认已把 functions/api/pdfs.js 提交并重新部署。'; } else { const d=await res.json().catch(()=>null); if(!res.ok){ this.pdfShelf.cloudReady=false; this.pdfShelf.note=(d&&d.error)||('云端不可用（HTTP '+res.status+'）'); } else { this.pdfShelf.items=d.items||[]; this.pdfShelf.cloudReady=true; } } }catch(e){ this.pdfShelf.cloudReady=false; this.pdfShelf.note='云端连接失败：'+e.message; } this.pdfShelf.loading=false; },
async uploadPdf(e){ const f=e.target.files&&e.target.files[0]; if(!f)return; e.target.value=''; if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } const mb=f.size/1048576; if(mb>100){ this.pdfPrepOpen(f); return; } if(mb>90 && !confirm('文件 '+mb.toFixed(1)+'MB，已接近上传上限（100MB）。仍要上传？\n若失败请先压缩或拆分 PDF。')) return; const title=(this.ingest.bookTitle||'').trim()||f.name.replace(/\.pdf$/i,''); const subject=this.guessSubject(f.name)||this.ingest.subject||'computer'; this.pdfShelf.uploading=true; this.pdfShelf.pct=0; this.pdfShelf.note=''; this.pdfShelf.prog='读取文件 '+f.name+'（'+mb.toFixed(1)+'MB）…'; try{ const buf=await f.arrayBuffer(); await new Promise((resolve,reject)=>{ const xhr=new XMLHttpRequest(); xhr.open('PUT','/api/pdfs?title='+encodeURIComponent(title)+'&subject='+encodeURIComponent(subject)); xhr.setRequestHeader('authorization','Bearer '+this.token); xhr.setRequestHeader('content-type','application/pdf'); xhr.upload.onprogress=(ev)=>{ if(ev.lengthComputable){ this.pdfShelf.pct=Math.round(ev.loaded/ev.total*100); this.pdfShelf.prog='上传中 '+(ev.loaded/1048576).toFixed(1)+' / '+mb.toFixed(1)+' MB'; } }; xhr.onload=()=>{ const ct=xhr.getResponseHeader('content-type')||''; let d=null; if(ct.includes('json')){ try{ d=JSON.parse(xhr.responseText); }catch(_){} } if(xhr.status===401){ this.token=''; localStorage.removeItem('zb_token'); this.view='settings'; reject(new Error('访问码无效')); return; } if(xhr.status===413){ reject(new Error('文件太大：超过 Cloudflare 单次请求上限（约 100MB），请求在边缘就被拒绝了。请压缩或拆分 PDF 后再传。')); return; } if(xhr.status===404){ reject(new Error('上传接口不可用：请确认已部署 functions/api/pdfs.js，并在绑定 R2（PDF_BUCKET）后【重新部署一次】。')); return; } if(!ct.includes('json')){ reject(new Error('上传失败（HTTP '+xhr.status+'）：服务端返回了非 JSON 响应。文件较大时多半是超过 100MB 上限被拒；否则请确认已绑定 R2（PDF_BUCKET）并重新部署一次。')); return; } if(xhr.status<200||xhr.status>=300){ reject(new Error((d&&d.error)||('上传失败 HTTP '+xhr.status))); return; } this.pdfShelf.pct=100; resolve(d); }; xhr.onerror=()=>reject(new Error('网络错误，上传中断')); xhr.send(buf); }); this.flash('已上传《'+title+'》到云端'); await this.loadPdfShelf(); }catch(err){ this.pdfShelf.note=err.message; this.flash(err.message,true); } this.pdfShelf.uploading=false; this.pdfShelf.prog=''; this.pdfShelf.pct=0; },
_pdfCacheDB(){ return new Promise((res,rej)=>{ try{ const r=indexedDB.open('zb_pdfcache',1); r.onupgradeneeded=()=>{ const db=r.result; if(!db.objectStoreNames.contains('pdfs'))db.createObjectStore('pdfs'); }; r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }catch(e){ rej(e); } }); },
async _pdfCacheGet(id){ try{ const db=await this._pdfCacheDB(); return await new Promise((res)=>{ const tx=db.transaction('pdfs','readonly').objectStore('pdfs').get(id); tx.onsuccess=()=>res(tx.result||null); tx.onerror=()=>res(null); }); }catch(_){ return null; } },
async _pdfCachePut(id,buf){ try{ const db=await this._pdfCacheDB(); await new Promise((res)=>{ const tx=db.transaction('pdfs','readwrite').objectStore('pdfs').put(buf,id); tx.onsuccess=()=>res(); tx.onerror=()=>res(); }); }catch(_){} },
async openShelfPdf(it){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } this.pdfv.curId=it.id; this.pdfv.loading=true; this.pdfv.msg='检查缓存…';
      try{
        const cached=await this._pdfCacheGet(it.id);
        if(cached){ this.pdfv.msg='从缓存加载…'; await this.pdfvOpenSrc(cached.slice(0), it.title); return; }
        this.pdfv.msg='连接中…'; const res=await fetch('/api/pdfs?id='+encodeURIComponent(it.id),{headers:{'authorization':'Bearer '+this.token}}); if(!res.ok)throw new Error('下载失败 '+res.status); const total=parseInt(res.headers.get('content-length')||it.size||'0',10)||0; let buf; if(res.body&&res.body.getReader){ const reader=res.body.getReader(); const chunks=[]; let got=0; while(true){ const {done,value}=await reader.read(); if(done)break; chunks.push(value); got+=value.length; this.pdfv.msg='下载中 '+(total?Math.round(got/total*100)+'%':((got/1048576).toFixed(1)+'MB'))+'（'+(got/1048576).toFixed(1)+'/'+(total?(total/1048576).toFixed(1):'?')+'MB）'; } const all=new Uint8Array(got); let off=0; for(const c of chunks){ all.set(c,off); off+=c.length; } buf=all.buffer; } else { buf=await res.arrayBuffer(); }
        this._pdfCachePut(it.id, buf.slice(0));
        this.pdfv.msg='解析中…'; await this.pdfvOpenSrc(buf, it.title);
      }catch(e){ this.pdfv.loading=false; this.pdfv.msg=''; this.flash('打开失败：'+e.message,true); } },
async deleteShelfPdf(it){ if(!confirm('确定删除云端 PDF《'+it.title+'》？此操作不可恢复。')) return; try{ await this.api('/api/pdfs?id='+encodeURIComponent(it.id),{method:'DELETE'}); try{ const db=await this._pdfCacheDB(); db.transaction('pdfs','readwrite').objectStore('pdfs').delete(it.id); }catch(_){} this.flash('已删除《'+it.title+'》'); if(this.pdfv.title===it.title)this.pdfvClose(); await this.loadPdfShelf(); }catch(e){ if(e.message!=='unauth')this.flash('删除失败：'+e.message,true); } }
} };
