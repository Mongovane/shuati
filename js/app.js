const { createApp } = Vue;
const APP_VER = 'v4.4';
// 队列缓存：放在模块级（不在 Vue 实例上），绕过 Vue 3 代理对动态属性的限制
let qCache = {};
const App={
  mixins: [ApiMixin, ReaderMixin],
  components:{ QuestionCard, RichText },
  data(){ return {
    token: localStorage.getItem('zb_token')||'',
    theme: localStorage.getItem('zb_theme')||'light',
    appName: localStorage.getItem('zb_appname')||'刷题文档',
    stealth:{ hidden:false, autoHide: localStorage.getItem('zb_autohide')==='1' },
    tokenInput:'', view:'practice',
    subjects:SUBJECTS, types:TYPES, subjMap:SUBJ_MAP, typeMap:TYPE_MAP, currentBookId:'', bookIdx:0, bookTocOpen:true,
    f:{ subject:'all', chapter:'', type:'', order:'random', _mode:'all' }, filterLock:false,
    meta:{ subjects:[], chapters:[] },
    queue:[], qi:0, loading:false, batchDone:false, loadedOnce:false, queueTotal:0, sessionAns:{}, sessionView:'',
    sessionStart:0, streak:0, bestStreak:0, qnavOpen:true,
    ingest:{ subject:'computer', chapter:'', source:'', kind:'auto', bookTitle:'', bookMode:true, bookName:'小红本', pageNo:'', questionNo:'', raw:'', json:'', busy:false, result:null, tab:'manual', photoUrl:'', photoDataUrl:'', manual:{ type:'single_choice', difficulty:3, stem:'', passage:'', options:[{key:'A',text:''},{key:'B',text:''},{key:'C',text:''},{key:'D',text:''}], answer:'', analysis:'', tags:'' }, pdf:{ pages:0, busy:false, prog:'', done:0, total:0, inserted:0, extracted:'', start:1, end:1, scale:1.7, quality:0.72 }, local:{ busy:false, prog:'', done:0, total:0, inserted:0, ocr:false, engine:'scribe', cfModel:'', cfPageLimit:50, log:[], stop:false, lastPage:0, endPage:0 }, mdFiles:[], mineru:{ busy:false, prog:'', pct:0, name:'', log:[], pageRange:'', mode:'agent' } },
    stats:null, statsDirty:true, statsLoading:false, settFold:{ mineru:true, offline:true, subjects:true },
    ai:{ model:'', visionModel:'', hasAI:false, hasCfAI:false },
    cfocr:{ used:0, limit:70, budget:10000, npp:115 },
    ocrCfg:{ model:'', base:'', key:'' },
    materials:{ subject:'all', items:[], loading:false, loaded:false }, loadProgMsg:'',
    booksMode:'notes', bookFold:{},
    pageRendering:false,
    offline:false,
    offlineQueued:0,
    offlineSyncing:false, offlineSyncMsg:'', offlineSynced:null,
    mineruCfg:{ pageLimit:1000, fileLimit:5000, tokenExp:'' },
    mineruUsageView:{ date:'', pages:0, files:0 },
    mineruTokenBad:false,
    bookExtract:{ busy:false, prog:'', done:0, total:0 },
    extractPreview:{ open:false, items:[], title:'', subject:'', source:'', dup:0 },
    bank:{ items:[], total:0, loading:false, offset:0, limit:50, subject:'', type:'', kw:'', sel:[], batchSubject:'' },
    subjMgr:{ code:'', name:'', sort:'', keywords:'', busy:false },
    bankEdit:{ open:false, q:null, stem:'', analysis:'', subject:'', type:'', options:[], answerText:'', busy:false },
    pdfv:{ open:false, loading:false, rendering:false, pages:0, cur:1, scale:1, title:'', mode:'scroll', msg:'' },
    pdfvMobile:false, pdfvTocOpen:false,
    pdfShelf:{ items:[], loading:false, uploading:false, prog:'', pct:0, cloudReady:true, note:'' },
    genq:{ busy:false, result:null },
    mock:{ subject:'computer', count:20, minutes:60, objectiveOnly:true, started:false, finished:false, questions:[], answers:{}, remaining:0, timer:null, elapsed:0 },
    toast:null, toastTimer:null,
  }; },
  computed:{
    materialBooks(){ const map=new Map(); for(const m of (this.materials.items||[])){ const key=this.bookKeyOf(m); if(!map.has(key))map.set(key,{key,subject:m.subject,title:this.bookTitleOf(m),pages:[]}); map.get(key).pages.push(m); } const out=[]; for(const b of map.values()){ const byPage=new Map(); const noPage=[]; for(const m of b.pages){ const pg=Number(m.page)||0; if(pg>0){ const ex=byPage.get(pg); if(!ex||(m.created_at||0)>=(ex.created_at||0))byPage.set(pg,m); } else noPage.push(m); } let pages=[...byPage.values()].sort((a,b)=>(a.page||0)-(b.page||0)); pages=pages.concat(noPage.sort((a,b)=>(a.created_at||0)-(b.created_at||0))); b.pages=pages; b.subject=pages[0]?.subject||b.subject; out.push(b); } return out; },
    booksBySubject(){ const groups={math:[],computer:[],politics:[],english:[],other:[]}; for(const b of this.materialBooks){ (groups[b.subject]||groups.other).push(b); } return groups; },
    currentBook(){ return this.materialBooks.find(b=>b.key===this.currentBookId)||this.materialBooks[0]||null; },
    currentPageMat(){ const b=this.currentBook; if(!b||!b.pages.length)return null; const i=Math.min(Math.max(0,this.bookIdx),b.pages.length-1); return b.pages[i]; },
    ocrModelName(){ return this.ai.visionModel || this.ai.model || '未读取模型'; },
    sessionMode(){ if(this.view==='wrong')return'wrong'; if(this.view==='favorite')return'favorite'; return this.f._mode||'all'; },
    chaptersForSubject(){ return this.meta.chapters.filter(c=> this.f.subject==='all'||c.subject===this.f.subject); },
    ingestChapterOptions(){ const preset=(CHAPTER_PRESETS[this.ingest.subject]||[]).map(ch=>({chapter:ch,n:'预设'})); const existing=(this.meta.chapters||[]).filter(c=>c.subject===this.ingest.subject&&!preset.some(p=>p.chapter===c.chapter)); return [...preset,...existing]; },
    sourcePreview(){ return this.makeSource(); },
    wrongTotal(){ if(!this.stats)return 0; return this.stats.bySubject.reduce((s,r)=>s+(r.wrong_open||0),0); },
    cur(){ return this.queue[this.qi]||null; },
    appVer(){ return APP_VER; },
    curStatus(){ const q=this.cur; if(!q)return null; if(q.mastered)return{t:'已掌握',c:'var(--ok)'}; if(q.wrong_count>0)return{t:'错过 '+q.wrong_count+' 次',c:'var(--bad)'}; if(q.right_count>0)return{t:'已做对',c:'var(--ok)'}; return null; },
    accPct(){ const t=this.statTotals; const d=t.right+t.wrong; return d?Math.round(t.right/d*100):0; },
    ringDash(){ const C=2*Math.PI*52; return (this.accPct/100*C).toFixed(1)+' '+C.toFixed(1); },
    sessionDone(){ return Object.keys(this.sessionAns).length; },
    sessionElapsed(){ if(!this.sessionStart)return '0:00'; let s=Math.max(0,Math.round((Date.now()-this.sessionStart)/1000)); const m=Math.floor(s/60); s=s%60; return m+':'+String(s).padStart(2,'0'); },
    statTotals(){ const z={totalQ:0,seen:0,wrongOpen:0,mastered:0,fav:0,right:0,wrong:0}; if(!this.stats)return z;
      for(const r of this.stats.bySubject){ z.totalQ+=r.total_q||0; z.seen+=r.seen||0; z.wrongOpen+=r.wrong_open||0; z.mastered+=r.mastered||0; z.fav+=r.favorited||0; z.right+=r.right_sum||0; z.wrong+=r.wrong_sum||0; } return z; },
    mockResult(){ const v=Object.values(this.mock.answers); return { graded:v.filter(x=>x!==null).length, correct:v.filter(x=>x===true).length, total:this.mock.questions.length }; },
    mockPct(){ const t=this.mock.questions.length||1; return Math.round(this.mockResult.correct/t*100); },
  },
  watch:{
    theme(v){ document.documentElement.dataset.theme=v; localStorage.setItem('zb_theme',v); },
    appName(v){ const n=(v||'').trim()||'刷题文档'; document.title=n; localStorage.setItem('zb_appname',n); },
    'stealth.autoHide'(v){ localStorage.setItem('zb_autohide', v?'1':'0'); },
    'f.subject'(){ this.f.chapter=''; },
    'ingest.subject'(){ this.ingest.chapter=''; if(this.ingest.bookMode)this.ingest.source=this.makeSource(); },
    'ingest.chapter'(){ if(this.ingest.bookMode)this.ingest.source=this.makeSource(); },
    'ingest.bookName'(){ if(this.ingest.bookMode)this.ingest.source=this.makeSource(); },
    'ingest.pageNo'(){ if(this.ingest.bookMode)this.ingest.source=this.makeSource(); },
    'ingest.questionNo'(){ if(this.ingest.bookMode)this.ingest.source=this.makeSource(); },
    'ingest.bookMode'(v){ if(v)this.ingest.source=this.makeSource(); },
    view(v){ try{ localStorage.setItem('zb_view', v); }catch(_){ } this._syncHash(v); },
    mineruCfg:{ handler(){ this.saveMineruCfg(); }, deep:true },
    currentBookId(v){ try{ localStorage.setItem('zb_bookid', v); }catch(_){ } let p=0; try{ const s=localStorage.getItem('zb_readpos:'+v); if(s!=null)p=Math.max(0,parseInt(s,10)||0); }catch(_){ } this.bookIdx=p; this.bookTocOpen=false; this.genq.result=null; this.flashPageRender(); },
    bookIdx(){ this.genq.result=null; },
    booksMode(v){ try{ localStorage.setItem('zb_booksmode', v); }catch(_){ } if(v==='pdf' && this.pdfv.open) this.$nextTick(()=>{ if(this.pdfv.mode==='page'){ this.pdfvRenderSingle(); } else { this.pdfvSetupPages(false); } this.pdfvSetupThumbs(); }); },
  },
  methods:{
    bookKeyOf(m){ const s=String(m.source||'').replace(/[-_\s]*P\d+\s*$/i,'').trim(); if(s)return s; const t=String(m.title||'').replace(/\s*·?\s*第\s*\d+\s*页\s*$/,'').trim(); return t||'未命名教材'; },
    classifySubject(t){ const s=String(t||''); const has=c=>this.subjects.some(x=>x.v===c);
      if(has('computer')&&/#include|void\s+main|int\s+main|printf\s*\(|scanf\s*\(|cout\s*<<|cin\s*>>|System\.out|public\s+(class|static|void)|def\s+\w+\s*\(|console\.log|malloc|struct\s+\w+|for\s*\([^;]*;|while\s*\(/.test(s))return'computer';
      if(has('math')&&/\\int|\\lim|\\sum|\\frac|\\sqrt|\\partial|\\overrightarrow|\\mathrm\{d\}/.test(s))return'math';
      const letters=(s.match(/[A-Za-z]/g)||[]).length, cjk=(s.match(/[\u4e00-\u9fa5]/g)||[]).length, len=s.replace(/\s/g,'').length;
      if(has('english')&&len>=12 && letters>=len*0.55 && cjk<=len*0.15 && /\b(the|of|to|and|is|are|was|were|which|that|what|who|how|why|an?|in|on|for|with)\b/i.test(s))return'english';
      for(const sub of this.subjects){ const kws=String(sub.keywords||'').split(/[，,;；\s]+/).map(k=>k.trim()).filter(k=>k.length>=2); for(const k of kws){ if(s.includes(k))return sub.v; } }
      return ''; },
    async loadSubjects(){ if(!this.token)return; try{ const d=await this.api('/api/subjects'); if(d&&Array.isArray(d.items)&&d.items.length){ this.subjects=d.items.map(x=>({v:x.v,t:x.t,sort:x.sort||0,keywords:x.keywords||''})); Object.keys(SUBJ_MAP).forEach(k=>delete SUBJ_MAP[k]); this.subjects.forEach(s=>{ SUBJ_MAP[s.v]=s.t; }); } }catch(e){} },
    async subjAdd(){ const m=this.subjMgr; const code=String(m.code||'').trim().toLowerCase().replace(/[^a-z0-9_]/g,''); const name=String(m.name||'').trim(); if(!code){ this.flash('科目代码只能用小写字母/数字/下划线',true); return; } if(!name){ this.flash('请填写科目名称',true); return; } m.busy=true; try{ await this.api('/api/subjects',{method:'POST',body:JSON.stringify({code,name,sort:Number(m.sort)||(this.subjects.length+1),keywords:m.keywords||''})}); this.flash('已新增科目「'+name+'」'); this.subjMgr={ code:'', name:'', sort:'', keywords:'', busy:false }; await this.loadSubjects(); }catch(e){ if(e.message!=='unauth')this.flash('新增失败：'+e.message,true); } m.busy=false; },
    async subjSave(s){ try{ await this.api('/api/subjects',{method:'PATCH',body:JSON.stringify({code:s.v,name:s.t,sort:Number(s.sort)||0,keywords:s.keywords||''})}); this.flash('已保存「'+s.t+'」'); await this.loadSubjects(); }catch(e){ if(e.message!=='unauth')this.flash('保存失败：'+e.message,true); } },
    async subjDelete(s){ const others=this.subjects.filter(x=>x.v!==s.v); let moveTo=''; if(confirm('删除科目「'+s.t+'」。\n\n点「确定」=同时把该科目下的题目转移到其他科目；点「取消」=只删科目、旧题保留原标记（下拉不再显示该科目）。')){ const names=others.map((x,i)=>(i+1)+'. '+x.t).join('\n'); const pick=prompt('把「'+s.t+'」的题目转到哪个科目？输入序号：\n'+names); const idx=parseInt(pick,10)-1; if(others[idx])moveTo=others[idx].v; else { this.flash('序号无效，已取消',true); return; } } try{ await this.api('/api/subjects',{method:'DELETE',body:JSON.stringify({code:s.v,moveTo})}); this.flash('已删除科目「'+s.t+'」'+(moveTo?('，题目已转到「'+this.subjName(moveTo)+'」'):'')); await this.loadSubjects(); this.loadMeta&&this.loadMeta(true); }catch(e){ if(e.message!=='unauth')this.flash('删除失败：'+e.message,true); } },
    guessSubject(name,content){ const s=String(name||''); if(/高\s*等?\s*数学|高数|微积分|线性代数|概率|数学分析|离散数学/.test(s))return'math'; if(/英语|阅读理解|完形|词汇|语法|写作|四级|六级|English/i.test(s))return'english'; if(/毛泽东|思想政治|马克思|马原|毛概|史纲|思修|中国特色|理论体系|政治/.test(s))return'politics'; if(/数据结构|程序设计|C\s*语言|C\+\+|计算机|算法|操作系统|数据库|Java|Python|软件|编程/i.test(s))return'computer'; return this.classifySubject(s+'  '+String(content||'').slice(0,1200)); },
    async setBookSubject(subj){ const b=this.currentBook; if(!b)return; if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } this.materials.loading=true; try{ for(const m of b.pages){ await this.saveOneMaterial({id:m.id,subject:subj,title:m.title,source:m.source||null,page:m.page||null,page_image:m.page_image||null,content_md:m.content_md,summary:m.summary||'',tags:Array.isArray(m.tags)?m.tags:[]}); } this.flash('已将《'+b.title+'》归到「'+this.subjName(subj)+'」'); await this.loadMaterials(); }catch(e){ if(e.message!=='unauth')this.flash('修改科目失败：'+e.message,true); } this.materials.loading=false; },
    rewriteMdImages(s){ return String(s||'').replace(/\]\(\s*\.?\/?public\//g,'](/').replace(/\]\(\s*textbooks-pages\//g,'](/textbooks-pages/').replace(/(<img[^>]*\bsrc=["'])\.?\/?public\//g,'$1/'); },
    parseChapterMd(text){ const t=String(text||''); const ch=t.match(/^#\s+(.+)$/m); const chapterTitle=ch?ch[1].trim():''; const src=t.match(/来源[:：]\s*(.+)/); const source=src?src[1].trim().replace(/[`*]/g,''):''; const parts=t.split(/^##\s*第\s*(\d+)\s*页\s*$/m); const pages=[]; for(let i=1;i<parts.length;i+=2){ const pageNo=parseInt(parts[i],10); const body=(parts[i+1]||'').trim(); if(Number.isFinite(pageNo))pages.push({page:pageNo,body}); } return {chapterTitle,source,pages,whole:t}; },
    async onMdFiles(e){ const files=[...(e.target.files||[])]; if(!files.length)return; const out=[]; for(const f of files){ try{ out.push({name:f.name,text:await f.text()}); }catch(_){} } this.ingest.mdFiles=out; if(!this.ingest.bookTitle.trim()&&out[0]){ const m=out[0].text.match(/来源[:：]\s*(.+)/); this.ingest.bookTitle=(m?m[1].trim().replace(/[`*]/g,''):out[0].name.replace(/\.md$/i,'')); const gs=this.guessSubject(this.ingest.bookTitle); if(gs)this.ingest.subject=gs; } this.flash('已读取 '+out.length+' 个 Markdown 文件'); },
    async importMarkdown(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } if(!this.ingest.mdFiles.length){ this.flash('请先选择 .md 文件',true); return; } const parsed=this.ingest.mdFiles.map(f=>({name:f.name,...this.parseChapterMd(f.text)})); let book=(this.ingest.bookTitle||'').trim(); if(!book){ const ps=parsed.find(p=>p.source); book=ps?ps.source:this.ingest.mdFiles[0].name.replace(/\.md$/i,''); } const subj=this.guessSubject(book)||this.ingest.subject; const items=[]; let seq=0; for(const p of parsed){ if(p.pages.length){ p.pages.forEach((pg,idx)=>{ let body=this.rewriteMdImages(pg.body); if(idx===0&&p.chapterTitle)body='**'+p.chapterTitle+'**\n\n'+body; items.push({page:pg.page,content:body,chapter:p.chapterTitle}); }); } else { seq++; items.push({page:seq,content:this.rewriteMdImages(p.whole),chapter:p.chapterTitle}); } } items.sort((a,b)=>(a.page||0)-(b.page||0)); this.ingest.local.busy=true; this.ingest.local.done=0; this.ingest.local.total=items.length; this.ingest.local.inserted=0; this.ingest.result=null; try{ let n=0; for(const it of items){ this.ingest.local.prog='正在导入第 '+(n+1)+'/'+items.length+' 页'; await this.saveOneMaterial({id:'mat-'+subj+'-'+this.bookHashId(book+'#p'+it.page),subject:subj,title:book+' · 第 '+it.page+' 页',source:book,page:it.page,content_md:it.content,summary:'',tags:it.chapter?[it.chapter,'Markdown导入']:['Markdown导入']}); n++; this.ingest.local.done=n; this.ingest.local.inserted=n; } this.ingest.result={kind:'material',inserted_questions:0,inserted_materials:n,material_sample:[]}; this.flash('已导入《'+book+'》'+n+' 页到 Books（去 Books 查看）'); this.loadMaterials(); }catch(e){ if(e.message!=='unauth')this.flash('Markdown 导入中断：已存 '+this.ingest.local.inserted+' 页，'+e.message,true); this.loadMaterials(); } this.ingest.local.busy=false; this.ingest.local.prog=''; },
    bookTitleOf(m){ const t=String(m.title||'').replace(/\s*·?\s*第\s*\d+\s*页\s*$/,'').trim(); return t || this.bookKeyOf(m); },
    pageLabel(m){ if(!m)return ''; const lines=String(m.content_md||'').split('\n'); let head=''; for(let ln of lines){ ln=ln.trim(); if(!ln)continue; if(/^!\[/.test(ln))continue; if(/^\$\$/.test(ln)||ln==='$$')continue; if(/^<(table|img|div|p|br)/i.test(ln))continue; if(/^[>|`]/.test(ln))continue; { const lc=ln.replace(/\\text\s*\{[^}]*\}/g,''); if(!/[\u4e00-\u9fa5]/.test(lc)&&/\\[a-zA-Z]{2,}|[\^_]\s*\{|\\frac|\\sqrt|\\begin|\\mid|\\left|\\overrightarrow|\\boldsymbol/.test(lc))continue; } if(this._mineruJunk&&this._mineruJunk(ln))continue; let clean=ln.replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/[#*`>]/g,'').trim(); if(!clean)continue; const mt=clean.match(/^(第[一二三四五六七八九十百零\d]+[章节][^。.]{0,24}|\d+(?:\.\d+){0,3}[\s、.][^。.]{0,24})/); head=(mt?mt[0]:clean).slice(0,24); break; } const pg=m.page?('第'+m.page+'页'):''; if(head&&pg)return head+' · '+pg; return head||pg||(m.title||'未命名'); },
    async deleteCurrentBook(){ const b=this.currentBook; if(!b){ this.flash('请先选择书籍',true); return; } if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } if(!confirm('确定删除《'+b.title+'》及其全部 '+b.pages.length+' 页？此操作不可恢复（题库不受影响）。')) return; const ids=b.pages.map(m=>m.id).filter(Boolean); try{ const d=await this.api('/api/materials',{method:'DELETE',body:JSON.stringify({ids})}); this.flash('已删除《'+b.title+'》，共 '+(d.deleted||ids.length)+' 页'); this.currentBookId=''; this.bookIdx=0; await this.loadMaterials(); }catch(e){ if(e.message!=='unauth')this.flash('删除失败：'+e.message,true); } },
    flash(msg,err){ this.toast={msg,err:!!err}; clearTimeout(this.toastTimer); this.toastTimer=setTimeout(()=>this.toast=null,2600); },
    importMsg(d){ const q=d.inserted_questions??d.inserted??0; const m=d.inserted_materials??0; if(q&&m)return '识别为「题目+教材」，已导入 '+q+' 题、整理 '+m+' 段教材'; if(m)return '识别为教材，已整理 '+m+' 段（去「教材阅读」查看）'; return '识别为题库，已导入 '+q+' 题'; },
    subjName(v){ return SUBJ_MAP[v]||v; },
    makeSource(){ if(!this.ingest.bookMode)return this.ingest.source||''; const parts=[this.ingest.bookName||'小红本', this.subjName(this.ingest.subject), this.ingest.chapter||'未分章']; if(this.ingest.pageNo)parts.push('P'+String(this.ingest.pageNo).trim()); if(this.ingest.questionNo)parts.push('第'+String(this.ingest.questionNo).trim()+'题'); return parts.join('-'); },
    currentSource(){ return (this.ingest.tab==='manual' && this.ingest.bookMode) ? this.makeSource() : (this.ingest.source||''); },
    sourceForPage(p){ const old=this.ingest.pageNo; this.ingest.pageNo=String(p||''); const v=this.currentSource(); this.ingest.pageNo=old; return v; },
    async loadMaterials(){ if(!this.token){ this.materials.loaded=true; return; } this.materials.loading=true; this.loadProgMsg='正在请求…';
      const t0=Date.now(); const tmr=setInterval(()=>{ if(!this.loadProgMsg.includes('MB')&&!this.loadProgMsg.includes('KB')){ this.loadProgMsg='已等待 '+Math.round((Date.now()-t0)/1000)+' 秒…'; } },1000);
      try{
        const self=this;
        const d = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', '/api/materials?limit=500');
          xhr.setRequestHeader('authorization', 'Bearer ' + self.token);
          xhr.onprogress = function(e){ const mb=e.loaded/1048576; let m=mb>=1?mb.toFixed(1)+' MB':Math.max(1,Math.round(e.loaded/1024))+' KB'; if(e.lengthComputable&&e.loaded<=e.total)m+=' · '+Math.round(e.loaded/e.total*100)+'%'; self.loadProgMsg=m; };
          xhr.onload = function(){ if(xhr.status===401){ self.token=''; try{localStorage.removeItem('zb_token');}catch(_){} self.view='settings'; reject(new Error('unauth')); return; } if(xhr.status<200||xhr.status>=300){ reject(new Error('请求失败 '+xhr.status)); return; } try{resolve(JSON.parse(xhr.responseText));}catch(e){reject(e);} };
          xhr.onerror = function(){ reject(new Error('网络错误')); };
          xhr.send();
        });
        this.materials.items=d.items||[]; if(!this.currentBook&&this.materialBooks[0])this.currentBookId=this.materialBooks[0].key;
        this.loadProgMsg='已加载 '+(d.items||[]).length+' 段教材';
      }catch(e){
        if(e.message==='unauth'){ clearInterval(tmr); this.materials.loading=false; this.materials.loaded=true; this.loadProgMsg=''; return; }
        this.loadProgMsg='从缓存加载…';
        try{ const d2=await this.api('/api/materials?limit=500'); this.materials.items=d2.items||[]; if(!this.currentBook&&this.materialBooks[0])this.currentBookId=this.materialBooks[0].key; this.loadProgMsg='已加载 '+(d2.items||[]).length+' 段'; }
        catch(e2){ if(e2.message!=='unauth')this.flash(e2.message,true); }
      }
      clearInterval(tmr); this.materials.loading=false; this.materials.loaded=true; },
    bookHashId(str){ let h=5381; const s=String(str); for(let i=0;i<s.length;i++){ h=((h<<5)+h+s.charCodeAt(i))>>>0; } return h.toString(36); },
    flashPageRender(){ this.pageRendering=true; try{ requestAnimationFrame(()=>requestAnimationFrame(()=>{ this.pageRendering=false; })); }catch(_){ this.$nextTick(()=>{ this.pageRendering=false; }); } },
    bookGoto(i){ const b=this.currentBook; if(!b)return; const ni=Math.min(Math.max(0,i),b.pages.length-1); if(ni!==this.bookIdx)this.flashPageRender(); this.bookIdx=ni; this.bookTocOpen=false; },
    bookPrev(){ this.bookGoto(this.bookIdx-1); },
    bookNext(){ this.bookGoto(this.bookIdx+1); },
    bookJumpPage(p){ const b=this.currentBook; if(!b)return; const n=parseInt(p,10); if(!Number.isFinite(n))return; const idx=b.pages.findIndex(m=>Number(m.page)===n); if(idx>=0)this.bookGoto(idx); else this.flash('没有第 '+n+' 页',true); },
    async loadConfig(){ if(!this.token)return; try{ const c=await this.api('/api/config'); this.ai.model=c.ai_model||''; this.ai.visionModel=c.ai_vision_model||''; this.ai.hasAI=!!c.has_ai; this.ai.hasCfAI=!!c.has_cf_ai; }catch(e){} },
    async loadCfUsage(){ if(!this.token)return; try{ const res=await fetch('/api/cfocr',{headers:{'authorization':'Bearer '+this.token}}); const ct=res.headers.get('content-type')||''; if(ct.includes('json')){ const d=await res.json(); if(res.ok){ this.cfocr.used=d.used||0; this.cfocr.limit=d.limit||150; if(d.budget)this.cfocr.budget=d.budget; if(d.npp)this.cfocr.npp=d.npp; this.ai.hasCfAI=!!d.has_cf_ai; } } }catch(e){} },
    async cfocrOcrCanvas(cv){ const b64=cv.toDataURL('image/png').split(',')[1]; const body={image_b64:b64}; if((this.ingest.local.cfModel||'').trim().startsWith('@cf/'))body.model=this.ingest.local.cfModel.trim(); const res=await fetch('/api/cfocr',{method:'POST',headers:{'authorization':'Bearer '+this.token,'content-type':'application/json'},body:JSON.stringify(body)}); const ct=res.headers.get('content-type')||''; let d=null; if(ct.includes('json')){ try{ d=await res.json(); }catch(_){} } if(res.status===401){ this.token=''; localStorage.removeItem('zb_token'); this.view='settings'; throw new Error('unauth'); } if(res.status===404 || !ct.includes('json')){ const e=new Error('Workers AI 接口不可用：请确认已部署 functions/api/cfocr.js 并绑定 Workers AI（变量名 AI），然后重新部署。'); e.fatal=true; throw e; } if(d){ if(typeof d.used==='number')this.cfocr.used=d.used; if(typeof d.limit==='number')this.cfocr.limit=d.limit; if(d.budget)this.cfocr.budget=d.budget; if(d.npp)this.cfocr.npp=d.npp; } if(res.status===429){ const e=new Error((d&&d.error)||'今日免费额度已用完'); e.quota=true; throw e; } if(!res.ok){ const e=new Error((d&&d.error)||('Workers AI 失败 HTTP '+res.status)); if(/未绑定|绑定/.test(e.message))e.fatal=true; throw e; } return String((d&&d.text)||'').trim(); },
    saveToken(){ const t=this.tokenInput.trim(); if(!t){ this.flash('请输入访问码',true); return; }
      this.token=t; localStorage.setItem('zb_token',t); this.tokenInput=''; this.flash('已保存，可以开始使用'); this.loadSubjects(); this.loadMeta(true); this.loadMaterials(); this.loadPdfShelf(); this.go('practice'); },
    logout(){ this.token=''; localStorage.removeItem('zb_token'); this.view='settings'; this.flash('已退出登录'); },
    _onOnline(){ this._setOffline(false); },
    _onOffline(){ this._setOffline(true); },
    async offlineSync(){
      if(!this.token){ this.flash('请先登录',true); return; }
      if(this.offline){ this.flash('当前离线，无法下载，请联网后再试',true); return; }
      if(this.offlineSyncing)return; this.offlineSyncing=true; this.offlineSyncMsg='正在下载题目…';
      try{
        let questions=[], offset=0;
        for(let i=0;i<400;i++){ const d=await this.api('/api/questions?mode=all&order=seq&limit=500&offset='+offset+'&nocount=1'); const items=d.items||[]; questions=questions.concat(items); this.offlineSyncMsg='已下载题目 '+questions.length+' 道…'; if(items.length<500)break; offset+=items.length; }
        this.offlineSyncMsg='正在下载教材…';
        let materials=[]; try{ const d=await this.api('/api/materials?limit=2000'); materials=d.items||[]; }catch(_){ }
        await this._offBulkPut('questions', questions);
        await this._offBulkPut('materials', materials);
        await this._offBulkPut('syncedAt', Date.now());
        this.offlineSynced={ q:questions.length, m:materials.length, at:Date.now() };
        this.flash('离线包已就绪：题目 '+questions.length+' 道、教材 '+materials.length+' 页，断网也能刷');
      }catch(e){ if(e.message!=='unauth')this.flash('下载失败：'+e.message,true); }
      this.offlineSyncing=false; this.offlineSyncMsg='';
    },
    async _loadOfflineSynced(){ try{ const at=await this._offBulk('syncedAt'); if(at){ const qs=await this._offBulk('questions'); const ms=await this._offBulk('materials'); this.offlineSynced={ q:(qs||[]).length, m:(ms||[]).length, at }; } }catch(_){ } },
    _syncHash(v){ try{ const want='#/'+v; if(location.hash!==want)location.hash=want; }catch(_){ } },
    _viewFromHash(){ let h=''; try{ h=(location.hash||'').replace(/^#\/?/,''); }catch(_){ } h=(h.split('?')[0]||'').split('/')[0]; return ['practice','wrong','favorite','books','bank','ingest','mock','stats','settings'].includes(h)?h:''; },
    onHashChange(){ const v=this._viewFromHash(); if(v && v!==this.view){ if(!this.token && v!=='settings')return; this.go(v); } },
    go(v){
      const prev=this.view;
      if(['practice','wrong','favorite'].includes(prev) && this.queue.length){
        qCache[prev]={ q:this.queue.slice(), i:this.qi, t:this.queueTotal, a:Object.assign({},this.sessionAns), bo:this.batchDone, lo:this.loadedOnce };
      }
      this.view=v;
      if(['practice','wrong','favorite'].includes(v)){
        if(v==='practice'&&!this.meta.subjects.length)this.loadMeta();
        const c=qCache[v];
        if(c && c.q.length){
          this.queue=c.q; this.qi=c.i; this.queueTotal=c.t; this.sessionAns=c.a; this.sessionView=v; this.batchDone=c.bo; this.loadedOnce=c.lo; this.loading=false;
          delete qCache[v];
          this.filterLock=true; this.$nextTick(()=>{ this.filterLock=false; });
        } else { this.startSession(); }
      }
      if(v==='stats' && this.statsDirty) this.loadStats();
      if(v==='bank'){ if(!this.meta.subjects.length)this.loadMeta(); this.loadBank(true); }
    },
    async loadBank(reset){ if(!this.token)return; if(reset){ this.bank.offset=0; this.bank.items=[]; this.bank.sel=[]; } this.bank.loading=true; try{ const p=new URLSearchParams(); if(this.bank.subject&&this.bank.subject!=='all')p.set('subject',this.bank.subject); if(this.bank.type)p.set('type',this.bank.type); if(this.bank.kw&&this.bank.kw.trim())p.set('q',this.bank.kw.trim()); p.set('order','seq'); p.set('mode','all'); p.set('limit',this.bank.limit); p.set('offset',this.bank.offset); const d=await this.api('/api/questions?'+p.toString()); this.bank.items = reset ? (d.items||[]) : this.bank.items.concat(d.items||[]); this.bank.total=d.total||this.bank.items.length; }catch(e){ if(e.message!=='unauth')this.flash(e.message,true); } this.bank.loading=false; },
    bankMore(){ this.bank.offset+=this.bank.limit; this.loadBank(false); },
    bankToggle(id){ const i=this.bank.sel.indexOf(id); i>=0?this.bank.sel.splice(i,1):this.bank.sel.push(id); },
    bankAllOnPage(){ const ids=this.bank.items.map(q=>q.id); const allSel=ids.every(id=>this.bank.sel.includes(id)); this.bank.sel = allSel ? this.bank.sel.filter(id=>!ids.includes(id)) : Array.from(new Set(this.bank.sel.concat(ids))); },
    async bankSetSubject(q,subj){ if(!q||!subj||subj===q.subject)return; try{ await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids:[q.id],subject:subj})}); q.subject=subj; this.flash('已改为「'+this.subjName(subj)+'」'); this.loadMeta(true); }catch(e){ if(e.message!=='unauth')this.flash('改科目失败：'+e.message,true); } },
    async bankDelete(q){ if(!q)return; if(!confirm('确定删除这道题？此操作不可恢复。'))return; try{ await this.api('/api/questions',{method:'DELETE',body:JSON.stringify({ids:[q.id]})}); const i=this.bank.items.findIndex(x=>x.id===q.id); if(i>=0)this.bank.items.splice(i,1); const si=this.bank.sel.indexOf(q.id); if(si>=0)this.bank.sel.splice(si,1); this.bank.total=Math.max(0,this.bank.total-1); this.flash('已删除'); this.loadMeta(true); this.statsDirty=true; }catch(e){ if(e.message!=='unauth')this.flash('删除失败：'+e.message,true); } },
    async bankBatchDelete(){ const ids=[...this.bank.sel]; if(!ids.length){ this.flash('请先勾选题目',true); return; } if(!confirm('确定删除选中的 '+ids.length+' 道题？此操作不可恢复。'))return; try{ const d=await this.api('/api/questions',{method:'DELETE',body:JSON.stringify({ids})}); this.bank.items=this.bank.items.filter(q=>!ids.includes(q.id)); this.bank.total=Math.max(0,this.bank.total-(d.deleted||ids.length)); this.bank.sel=[]; this.flash('已删除 '+(d.deleted||ids.length)+' 题'); this.loadMeta(true); this.statsDirty=true; }catch(e){ if(e.message!=='unauth')this.flash('批量删除失败：'+e.message,true); } },
    async bankBatchSubject(){ const ids=[...this.bank.sel]; const subj=this.bank.batchSubject; if(!ids.length){ this.flash('请先勾选题目',true); return; } if(!subj){ this.flash('请选择目标科目',true); return; } try{ const d=await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids,subject:subj})}); this.bank.items.forEach(q=>{ if(ids.includes(q.id))q.subject=subj; }); this.flash('已将 '+(d.updated||ids.length)+' 题改为「'+this.subjName(subj)+'」'); this.bank.sel=[]; this.bank.batchSubject=''; this.loadMeta(true); }catch(e){ if(e.message!=='unauth')this.flash('批量改科目失败：'+e.message,true); } },
    async bankDedup(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } if(!confirm('扫描整个题库，删除题干完全相同的重复题（每组只保留一道）。\n建议先备份。继续？'))return; this.bank.loading=true; try{
        let all=[]; let off=0; const lim=200; while(true){ const p=new URLSearchParams(); p.set('mode','all'); p.set('order','seq'); p.set('limit',lim); p.set('offset',off); const d=await this.api('/api/questions?'+p.toString()); const items=d.items||[]; all=all.concat(items); if(items.length<lim)break; off+=lim; if(off>40000)break; }
        const seen=new Set(); const dupIds=[]; for(const q of all){ const k=(q.subject||'')+'|'+String(q.stem||'').replace(/\s+/g,' ').trim(); if(seen.has(k))dupIds.push(q.id); else seen.add(k); }
        if(!dupIds.length){ this.flash('没有发现重复题（共 '+all.length+' 题）'); this.bank.loading=false; return; }
        if(!confirm('共扫描 '+all.length+' 题，发现 '+dupIds.length+' 道重复，将删除（每组保留第一道）。确认？')){ this.bank.loading=false; return; }
        let del=0; const CH=100; for(let i=0;i<dupIds.length;i+=CH){ const d=await this.api('/api/questions',{method:'DELETE',body:JSON.stringify({ids:dupIds.slice(i,i+CH)})}); del+=(d.deleted||dupIds.slice(i,i+CH).length); }
        this.flash('已清理 '+del+' 道重复题'); this.loadMeta(true); this.statsDirty=true; await this.loadBank(true);
      }catch(e){ if(e.message!=='unauth')this.flash('清理失败：'+e.message,true); } this.bank.loading=false; },
    async bankAutoClassify(){ const changes={}; let n=0; for(const q of this.bank.items){ const opt=Array.isArray(q.options)?q.options.map(o=>o&&o.text).join(' '):''; const g=this.classifySubject([q.stem,q.chapter,opt].join('  ')); if(g&&g!==q.subject){ (changes[g]=changes[g]||[]).push(q); n++; } } if(!n){ this.flash('本页没有可自动纠正的题（特征不明确的不动）'); return; } if(!confirm('将按题干内容自动纠正本页 '+n+' 道题的科目（仅强特征命中的）。继续？'))return; try{ for(const subj of Object.keys(changes)){ const arr=changes[subj]; const ids=arr.map(q=>q.id); await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids,subject:subj})}); arr.forEach(q=>q.subject=subj); } this.flash('已自动归类 '+n+' 题'); this.loadMeta(true); }catch(e){ if(e.message!=='unauth')this.flash('智能归类失败：'+e.message,true); } },
    bankOpenEdit(q){ this.bankEdit={ open:true, q, stem:q.stem||'', analysis:q.analysis||'', subject:q.subject||'', type:q.type||'', options:(Array.isArray(q.options)?q.options.map(o=>({key:o.key||'',text:o.text||''})):[]), answerText:(Array.isArray(q.answer)?q.answer.join(this.isChoiceType(q.type)?', ':'\n'):(q.answer||'')), busy:false }; },
    isChoiceType(t){ return t==='single_choice'||t==='multiple_choice'||t==='true_false'; },
    bankEditAddOpt(){ const keys=['A','B','C','D','E','F','G','H']; const used=new Set(this.bankEdit.options.map(o=>o.key)); const k=keys.find(x=>!used.has(x))||String(this.bankEdit.options.length+1); this.bankEdit.options.push({key:k,text:''}); },
    bankEditDelOpt(i){ this.bankEdit.options.splice(i,1); },
    bankCloseEdit(){ this.bankEdit.open=false; this.bankEdit.q=null; },
    async bankSaveEdit(){ const e=this.bankEdit; if(!e.q)return; if(!String(e.stem).trim()){ this.flash('题干不能为空',true); return; } e.busy=true;
      const isChoice=this.isChoiceType(e.type);
      const options=isChoice ? e.options.filter(o=>String(o.key).trim()).map(o=>({key:String(o.key).trim(),text:String(o.text||'').trim()})) : [];
      let answer; if(isChoice){ answer=String(e.answerText||'').split(/[,，、\s]+/).map(s=>s.trim()).filter(Boolean); if(e.type==='true_false')answer=answer.map(s=>/^(t|true|对|是|正确|√)$/i.test(s)?'T':(/^(f|false|错|否|错误|×)$/i.test(s)?'F':s.toUpperCase())); else answer=answer.map(s=>s.toUpperCase()); } else { const txt=String(e.answerText||'').trim(); answer=txt?[txt]:[]; }
      try{ await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids:[e.q.id],stem:e.stem,analysis:e.analysis,subject:e.subject,type:e.type,options,answer})}); e.q.stem=e.stem; e.q.analysis=e.analysis; e.q.subject=e.subject; e.q.type=e.type; e.q.options=options; e.q.answer=answer; this.flash('已保存'); this.loadMeta(true); this.bankCloseEdit(); }catch(err){ if(err.message!=='unauth')this.flash('保存失败：'+err.message,true); } e.busy=false; },
    async loadMeta(force){ if(!this.token)return;
      if(!force){ try{ const c=JSON.parse(localStorage.getItem('zb_meta_cache')||'null'); if(c&&c.ts&&Date.now()-c.ts<300000&&c.d){ this.meta=c.d; return; } }catch(_){} }
      try{ const d=await this.api('/api/questions?meta=1'); this.meta=d; try{localStorage.setItem('zb_meta_cache',JSON.stringify({d,ts:Date.now()}));}catch(_){} }catch(e){} },
    qs(extra={}){ const p=new URLSearchParams();
      if(this.f.subject&&this.f.subject!=='all') p.set('subject',this.f.subject);
      if(this.f.chapter) p.set('chapter',this.f.chapter);
      if(this.f.type) p.set('type',this.f.type);
      p.set('order', this.sessionMode==='wrong' ? 'weak' : this.f.order); p.set('mode',this.sessionMode);
      Object.entries(extra).forEach(([k,v])=>p.set(k,v)); return p.toString();
    },
    onFilter(){ if(this.filterLock)return; this.startSession(); },
    async startSession(keep){ if(!this.token)return;
      const forView=this.view;
      this.loading=true; this.batchDone=false; this.queue=[]; this.qi=0; this.sessionAns={}; this.sessionView=this.view;
      if(!keep){ this.sessionStart=Date.now(); this.streak=0; this.bestStreak=0; }
      const dedup=(arr)=>{ const m=new Map(); for(const q of (arr||[])){ if(q&&q.id!=null&&!m.has(q.id))m.set(q.id,q); } return [...m.values()]; };
      try{
        const extra={limit:30}; if(keep)extra.nocount=1;
        const d=await this.api('/api/questions?'+this.qs(extra));
        if(this.view!==forView){ this.loading=false; return; }
        this.queue=dedup(d.items);
        if(!keep || d.total>0) this.queueTotal=(d.total!=null&&d.total>=0?d.total:this.queue.length);
        this.loadedOnce=true;
        this.qnavOpen=this.queue.length<=16;
        if(!this.queue.length)this.batchDone=true;
      }
      catch(e){ if(e.message!=='unauth')this.flash(e.message,true); }
      if(this.view===forView) this.loading=false;
    },
    srcBook(s){ const t=String(s||'').split(' · ')[0].trim(); return t || '未知来源'; },
    prev(){ if(this.qi>0)this.qi--; },
    qnavCls(q,i){ const c=[]; if(i===this.qi)c.push('cur'); const a=this.sessionAns[q.id]; if(a===true)c.push('ok'); else if(a===false)c.push('bad'); else if(q.mastered)c.push('ok'); else if(q.wrong_count>0)c.push('bad'); else if(q.right_count>0)c.push('done'); else c.push('un'); return c; },
    next(){ if(this.qi<this.queue.length-1)this.qi++; else this.startSession(true); },
    async deleteCurrentQuestion(){ const q=this.cur; if(!q)return; if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } if(!confirm('确定删除这道题？此操作不可恢复。'))return; try{ await this.api('/api/questions',{method:'DELETE',body:JSON.stringify({ids:[q.id]})}); this.queue.splice(this.qi,1); if(this.qi>this.queue.length-1)this.qi=Math.max(0,this.queue.length-1); if(!this.queue.length)this.batchDone=true; this.flash('已删除本题'); this.loadMeta(true); this.statsDirty=true; }catch(e){ if(e.message!=='unauth')this.flash('删除失败：'+e.message,true); } },
    async setQuestionSubject(subj){ const q=this.cur; if(!q||!subj||subj===q.subject)return; if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } try{ await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids:[q.id],subject:subj})}); q.subject=subj; this.flash('已改为「'+this.subjName(subj)+'」'); this.loadMeta(true); }catch(e){ if(e.message!=='unauth')this.flash('改科目失败：'+e.message,true); } },
    findQ(id){ return this.queue.find(q=>q.id===id)||(this.mock.questions||[]).find(q=>q.id===id); },
    async onAnswered(p){ this.sessionAns[p.id]=p.correct; if(p.correct){ this.streak++; if(this.streak>this.bestStreak)this.bestStreak=this.streak; } else { this.streak=0; } try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'answer',question_id:p.id,is_correct:p.correct})}); }catch(e){} },
    async onFav(p){ const q=this.findQ(p.id); if(q)q.favorited=p.value; this.flash(p.value?'已收藏':'已取消收藏'); try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'favorite',question_id:p.id,value:p.value?1:0})}); }catch(e){} },
    async onMaster(p){ const q=this.findQ(p.id); if(q)q.mastered=p.value; this.flash(p.value?'已标记为掌握':'已撤销'); try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'master',question_id:p.id,value:p.value?1:0})}); }catch(e){} },
    async onNote(p){ const q=this.findQ(p.id); if(q)q.note=p.note; this.flash('笔记已保存'); try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'note',question_id:p.id,note:p.note})}); }catch(e){} },
    buildManualQuestion(){ const m=this.ingest.manual;
      const type=m.type;
      const opts=(type==='single_choice'||type==='multiple_choice') ? m.options.map(o=>({key:String(o.key||'').trim().toUpperCase(),text:String(o.text||'').trim()})).filter(o=>o.key&&o.text) : [];
      const ansRaw=String(m.answer||'').trim();
      let answer=[];
      if(type==='multiple_choice') answer=ansRaw.split(/[，,\s]+/).map(x=>x.trim().toUpperCase()).filter(Boolean);
      else if(type==='single_choice') answer=ansRaw ? [ansRaw[0].toUpperCase()] : [];
      else if(type==='true_false') answer=[/^t|true|对|正确|是|1$/i.test(ansRaw)?'T':'F'];
      else if(type==='fill_blank') answer=ansRaw.split(/\n+/).map(x=>x.trim()).filter(Boolean);
      else answer=ansRaw ? [ansRaw] : [];
      return { subject:this.ingest.subject, chapter:this.ingest.chapter, type, difficulty:Number(m.difficulty)||3, source:this.currentSource()||'手动录入', passage:m.passage||'', stem:m.stem||'', options:opts, answer, analysis:m.analysis||'', tags:String(m.tags||'').split(/[，,]/).map(x=>x.trim()).filter(Boolean) };
    },
    resetManual(){ this.ingest.manual={ type:'single_choice', difficulty:3, stem:'', passage:'', options:[{key:'A',text:''},{key:'B',text:''},{key:'C',text:''},{key:'D',text:''}], answer:'', analysis:'', tags:'' }; this.ingest.photoUrl=''; },
    async saveManual(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      const q=this.buildManualQuestion();
      if(!String(q.stem||'').trim()){ this.flash('请输入题干',true); return; }
      if((q.type==='single_choice'||q.type==='multiple_choice') && q.options.length<2){ this.flash('选择题至少需要 2 个选项',true); return; }
      if(!q.answer.length){ this.flash('请输入答案',true); return; }
      this.ingest.busy=true; this.ingest.result=null;
      try{ const d=await this.api('/api/process',{method:'POST',body:JSON.stringify({subject:this.ingest.subject,chapter:this.ingest.chapter,source:this.currentSource(),questions:[q]})}); this.ingest.result=d; this.flash('已免费保存 1 题'); const n=parseInt(this.ingest.questionNo,10); this.resetManual(); if(Number.isFinite(n))this.ingest.questionNo=String(n+1); this.loadMeta(true); this.statsDirty=true; }
      catch(e){ if(e.message!=='unauth')this.flash(e.message,true); }
      this.ingest.busy=false;
    },
    onPhotoFile(e){ const file=e.target.files&&e.target.files[0]; if(!file)return; const rd=new FileReader(); rd.onload=()=>{ this.ingest.photoDataUrl=String(rd.result||''); this.ingest.photoUrl=this.ingest.photoDataUrl; this.ingest.tab='photo'; this.flash('图片已加载，可手动录入或调用 AI OCR'); }; rd.onerror=()=>this.flash('图片读取失败',true); rd.readAsDataURL(file); },
    async aiPhotoImport(){ if(!this.ingest.photoDataUrl){ this.flash('请先选择照片',true); return; } if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } this.ingest.busy=true; this.ingest.result=null; try{ const d=await this.api('/api/process',{method:'POST',body:JSON.stringify({subject:this.ingest.subject,chapter:this.ingest.chapter,source:this.currentSource(),kind:this.ingest.kind,images:[this.ingest.photoDataUrl]})}); this.ingest.result=d; this.flash(this.importMsg(d)); this.loadMeta(true); this.statsDirty=true; this.loadMaterials(); }catch(e){ if(e.message!=='unauth')this.flash(e.message,true); } this.ingest.busy=false; },
    async doIngest(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      const body={ subject:this.ingest.subject, chapter:this.ingest.chapter, source:this.currentSource() };
      if(this.ingest.tab==='json'){ let arr; try{ arr=JSON.parse(this.ingest.json); }catch(e){ this.flash('JSON parse failed: '+e.message,true); return; }
        if(!Array.isArray(arr)||!arr.length){ this.flash('请粘贴非空 JSON 数组',true); return; } body.questions=arr;
      } else { if(!this.ingest.raw.trim()){ this.flash('请先粘贴原始文本',true); return; } body.raw_text=this.ingest.raw; body.kind=this.ingest.kind; }
      this.ingest.busy=true; this.ingest.result=null;
      try{ const d=await this.api('/api/process',{method:'POST',body:JSON.stringify(body)}); this.ingest.result=d; this.flash(this.importMsg(d)); this.loadMeta(true); this.statsDirty=true; this.loadMaterials();
        if(this.ingest.tab==='ai')this.ingest.raw=''; else this.ingest.json=''; }
      catch(e){ if(e.message!=='unauth')this.flash(e.message,true); }
      this.ingest.busy=false;
    },
    async loadSample(){ try{ const r=await fetch('/sample-questions.json'); const j=await r.json(); this.ingest.json=JSON.stringify(j,null,2); this.ingest.tab='json'; this.flash('Sample loaded — click Import'); }
      catch(e){ this.flash('sample-questions.json not found',true); } },
    loadScript(src){ return new Promise((res,rej)=>{ this._scripts=this._scripts||{}; if(this._scripts[src])return res(); const s=document.createElement('script'); s.src=src; s.onload=()=>{ this._scripts[src]=1; res(); }; s.onerror=()=>rej(new Error('加载失败：'+src)); document.head.appendChild(s); }); },
    async ensurePdfjs(){ if(window.pdfjsLib)return; await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'); window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; },
    async onPdfFile(e){ const file=e.target.files&&e.target.files[0]; if(!file)return; this.ingest.result=null; this.ingest.pdf.prog='正在加载 PDF…'; this.ingest.pdf.pages=0; const nm=(file.name||'').replace(/\.[Pp][Dd][Ff]$/,'').trim(); if(nm)this.ingest.bookTitle=nm; const gs=this.guessSubject(nm); if(gs)this.ingest.subject=gs;
      try{ await this.ensurePdfjs(); const buf=await file.arrayBuffer(); const doc=await window.pdfjsLib.getDocument({data:buf}).promise; this._pdfDoc=doc; this.ingest.pdf.pages=doc.numPages; this.ingest.pdf.start=1; this.ingest.pdf.end=Math.min(3,doc.numPages); this.ingest.pdf.prog=''; this.flash('已加载 PDF，共 '+doc.numPages+' 页'); }
      catch(err){ this.ingest.pdf.prog=''; this.flash('PDF 加载失败：'+err.message,true); } },
    chunkText(text,size=6000,overlap=200){ text=String(text).replace(/\n{3,}/g,'\n\n').trim(); const out=[]; let i=0,n=text.length; while(i<n){ let end=Math.min(i+size,n); if(end<n){ const br=text.lastIndexOf('\n',end); if(br>i && br>end-overlap*4) end=br; } const p=text.slice(i,end).trim(); if(p)out.push(p); i=end; } return out; },
    // —— 无 AI 本地转化教材：纯文字 PDF 用 pdf.js 抽文字，扫描件可选 tesseract.js 本地 OCR，结果直接存进 Books（materials 表）——
    mdFromText(text){ return String(text||'').replace(/\r/g,'').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim(); },
    chunkForMaterial(text){ return this.chunkText(text,4000,0); },
    materialBaseTitle(){ return (this.ingest.bookTitle||'').trim() || (this.ingest.chapter||'').trim() || '教材'; },
    async ensureTesseract(){ await this.loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'); if(!window.Tesseract) throw new Error('本地 OCR 引擎加载失败（网络受限时可改用文字 PDF 或自托管）'); return await window.Tesseract.createWorker(['chi_sim','eng']); },
    async ensureScribe(){ if(this._scribe) return this._scribe; const urls=['https://esm.sh/scribe.js-ocr','https://cdn.jsdelivr.net/npm/scribe.js-ocr/+esm']; let mod=null,err=null; for(const u of urls){ try{ mod=await import(u); break; }catch(e){ err=e; } } if(!mod) throw new Error('Scribe.js 加载失败（CDN/网络）：'+((err&&err.message)||'未知')); this._scribe=mod.default||mod; return this._scribe; },
    async scribeOcrCanvas(cv){ const scribe=await this.ensureScribe(); const blob=await new Promise(res=>cv.toBlob(res,'image/png')); if(!blob) throw new Error('页面转图片失败'); const out=await scribe.extractText([blob],['chi_sim','eng']); return String(Array.isArray(out)?out.join('\n'):(out||'')).trim(); },
    async saveOneMaterial(m){ return this.api('/api/materials',{method:'POST',body:JSON.stringify(m)}); },
    async saveMaterialsLocal(text,baseTitle){ const clean=this.mdFromText(text); if(!clean){ this.flash('没有可保存的文本',true); return 0; } const parts=this.chunkForMaterial(clean); let n=0; this.ingest.local.total=parts.length; for(let i=0;i<parts.length;i++){ this.ingest.local.prog='正在保存第 '+(i+1)+'/'+parts.length+' 段教材'; const title=parts.length>1 ? (baseTitle+' ('+(i+1)+'/'+parts.length+')') : baseTitle; const d=await this.saveOneMaterial({id:'mat-'+this.ingest.subject+'-'+this.bookHashId(baseTitle+'#'+i),subject:this.ingest.subject,title,source:baseTitle,content_md:parts[i],summary:'',tags:this.ingest.chapter?[this.ingest.chapter,'本地导入']:['本地导入']}); n+=d.inserted||1; this.ingest.local.done=i+1; this.ingest.local.inserted=n; } return n; },
    async saveTextAsMaterial(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } const text=(this.ingest.raw||'').trim(); if(!text){ this.flash('请先粘贴或提取文本',true); return; } this.ingest.local.busy=true; this.ingest.local.done=0; this.ingest.local.inserted=0; this.ingest.result=null; try{ const n=await this.saveMaterialsLocal(text,this.materialBaseTitle()); this.ingest.result={kind:'material',inserted_questions:0,inserted_materials:n,material_sample:[]}; this.flash('已保存 '+n+' 段教材到 Books（未调用 AI）'); this.loadMaterials(); }catch(e){ if(e.message!=='unauth')this.flash('保存失败：'+e.message,true); } this.ingest.local.busy=false; this.ingest.local.prog=''; },
    sleep(ms){ return new Promise(r=>setTimeout(r,ms)); },
    pdfAllToMaterialLocal(){ if(!this._pdfDoc){ this.flash('请先选择 PDF',true); return; } this.ingest.pdf.start=1; this.ingest.pdf.end=this._pdfDoc.numPages; this.pdfToMaterialLocal(); },
    async pdfToMaterialLocal(){
      if(!this._pdfDoc){ this.flash('请先选择 PDF',true); return; }
      if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      const doc=this._pdfDoc;
      const st=Math.max(1,parseInt(this.ingest.pdf.start||1,10)||1);
      const ed=Math.min(doc.numPages,parseInt(this.ingest.pdf.end||st,10)||st);
      if(ed<st){ this.flash('结束页不能小于开始页',true); return; }
      // 预检：首页能否提取到文字；扫描版且未开 OCR 会一无所获，提前提示
      try{ const pg0=await doc.getPage(st); const tc0=await pg0.getTextContent(); const t0=tc0.items.map(it=>it.str).join('').replace(/\s/g,''); if(t0.length<10 && !this.ingest.local.ocr){ if(confirm('第 '+st+' 页提取不到文字，这本很可能是扫描版 PDF。\n开启「本地 OCR」用浏览器识别图片文字后继续？\n\n确定 = 开启本地 OCR 并继续（较慢，质量一般）\n取消 = 不继续（可改用文字版 PDF，或用「AI OCR…只当教材」）')) this.ingest.local.ocr=true; else return; } }catch(_){}
      const n=ed-st+1;
      if(n>30 && !confirm('将处理 '+n+' 页（第 '+st+'–'+ed+' 页）。\n会自动分批进行；扫描页本地 OCR 较慢，请保持本标签页在前台、勿让电脑休眠。\n确定开始？')) return;
      const BATCH=25;
      this.ingest.local.busy=true; this.ingest.local.stop=false; this.ingest.local.done=0; this.ingest.local.total=n; this.ingest.local.inserted=0; this.ingest.local.lastPage=0; this.ingest.local.endPage=ed; this.ingest.local.log=[]; this.ingest.result=null;
      let tess=null, saved=0, scanned=0;
      try{
        for(let p=st;p<=ed;p++){
          if(this.ingest.local.stop){ const nxt=Math.min(ed,(this.ingest.local.lastPage||(st-1))+1); this.ingest.pdf.start=nxt; this.flash('已停止，已保存 '+saved+' 段。开始页已设为 '+nxt+'，可再点继续'); break; }
          // 分批：每处理 BATCH 页就重建 OCR 引擎释放内存并短暂喘息，降低长任务下标签页卡死概率
          if(p>st && (p-st)%BATCH===0){
            if(tess&&tess.terminate){ try{ await tess.terminate(); }catch(_){} tess=null; }
            this.ingest.local.prog='已完成 '+(p-st)+'/'+n+' 页，正在释放内存…';
            await this.sleep(800);
          }
          this.ingest.local.prog='正在处理第 '+p+'/'+ed+' 页';
          const page=await doc.getPage(p);
          const tc=await page.getTextContent();
          let text=tc.items.map(it=>it.str).join(' ').replace(/\s+\n/g,'\n').trim();
          let usedOcr=false;
          if(text.replace(/\s/g,'').length<10 && this.ingest.local.ocr){
            const scale=Math.max(2.4, Number(this.ingest.pdf.scale)||1.7); const vp=page.getViewport({scale});
            const cv=document.createElement('canvas'); cv.width=Math.floor(vp.width); cv.height=Math.floor(vp.height);
            await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
            const eng=this.ingest.local.engine==='scribe'?'Scribe.js':(this.ingest.local.engine==='cfai'?'Workers AI':'tesseract');
            this.ingest.local.prog='本地 OCR 第 '+p+'/'+ed+' 页（'+eng+'，首次较慢）';
            if(this.ingest.local.engine==='scribe'){
              try{ text=await this.scribeOcrCanvas(cv); }
              catch(e){ this.flash('Scribe.js 不可用，已回退 tesseract：'+e.message,true); this.ingest.local.engine='tesseract'; if(!tess)tess=await this.ensureTesseract(); const r=await tess.recognize(cv); text=String(r?.data?.text||'').trim(); }
            } else if(this.ingest.local.engine==='cfai'){
              const effLimit=Math.min(Number(this.ingest.local.cfPageLimit)||50, this.cfocr.limit||70);
              if(this.cfocr.used>=effLimit){ const nxt=Math.min(ed,p); this.ingest.pdf.start=nxt; this.ingest.local.stop=true; this.flash('已达今日设定上限（'+effLimit+' 页，约 '+(effLimit*this.cfocr.npp)+' 神经元）。停在第 '+p+' 页，明天或调高上限再继续。',true); cv.width=cv.height=0; break; }
              this.ingest.local.prog='Workers AI 第 '+p+'/'+ed+' 页（今日 '+this.cfocr.used+'/'+effLimit+'）';
              try{ text=await this.cfocrOcrCanvas(cv); }
              catch(e){ cv.width=cv.height=0; if(e.message==='unauth')throw e; if(e.quota||e.fatal){ const nxt=Math.min(ed,p); this.ingest.pdf.start=nxt; this.ingest.local.stop=true; this.logPage(p,'err',e.message); this.flash(e.message+(e.quota?('（已停在第 '+p+' 页，明天或换引擎从这继续）'):''),true); break; } this.logPage(p,'err','Workers AI 出错：'+e.message); this.ingest.local.done=(p-st+1); this.ingest.local.lastPage=p; continue; }
            } else if(this.ingest.local.engine==='relay'){
              this.ingest.local.prog='中转站视觉 OCR 第 '+p+'/'+ed+' 页…';
              try{ text=await this.relayOcrCanvas(cv); }
              catch(e){ cv.width=cv.height=0; if(e.message==='unauth')throw e; if(e.fatal){ const nxt=Math.min(ed,p); this.ingest.pdf.start=nxt; this.ingest.local.stop=true; this.logPage(p,'err',e.message); this.flash(e.message,true); break; } this.logPage(p,'err','中转站出错：'+e.message); this.ingest.local.done=(p-st+1); this.ingest.local.lastPage=p; continue; }
            } else {
              if(!tess)tess=await this.ensureTesseract(); const r=await tess.recognize(cv); text=String(r?.data?.text||'').trim();
            }
            usedOcr=true; scanned++;
            cv.width=cv.height=0;
          }
          this.ingest.local.done=(p-st+1); this.ingest.local.lastPage=p;
          if(!text){ this.logPage(p,'skip', usedOcr?'OCR 没识别出文字（模型可能不支持图片/空白页）':'无文字层（扫描页？可勾选 OCR）'); continue; }
          const title=this.materialBaseTitle()+' · 第 '+p+' 页';
          const md=this.mdFromText(text)+(usedOcr?('\n\n> 本页由'+(this.ingest.local.engine==='relay'?'中转站视觉模型':this.ingest.local.engine==='cfai'?'Workers AI':'本地 OCR')+'识别，可能有误差。'):'');
          const d=await this.saveOneMaterial({id:'mat-'+this.ingest.subject+'-'+this.bookHashId(this.materialBaseTitle()+'#p'+p),subject:this.ingest.subject,title,source:this.materialBaseTitle(),page:p,content_md:md,summary:'',tags:this.ingest.chapter?[this.ingest.chapter,'本地导入']:['本地导入']});
          saved+=d.inserted||1; this.ingest.local.inserted=saved; this.logPage(p,'ok','已存 '+md.length+' 字'+(usedOcr?'（'+(this.ingest.local.engine==='relay'?'中转站':this.ingest.local.engine==='cfai'?'Workers AI':this.ingest.local.engine)+'）':'（文字层）'));
        }
        if(!this.ingest.local.stop){ this.ingest.result={kind:'material',inserted_questions:0,inserted_materials:saved,material_sample:[]}; if(saved===0){ this.flash(this.ingest.local.ocr?'未保存任何内容：本地 OCR 没识别出文字，可能是空白页或图像太糊，可调高清晰度后重试。':'未保存任何内容：这些页提取不到文字（多为扫描版）。请勾选「扫描页用本地 OCR」后重试，或用「AI OCR…只当教材」。',true); } else { this.flash('已保存 '+saved+' 段教材到 Books（未调用 AI）'+(scanned?('，其中 '+scanned+' 页用本地 OCR'):'')); } }
        this.loadMaterials();
      }catch(e){ if(e.message!=='unauth'){ const nxt=Math.min(ed,(this.ingest.local.lastPage||(st-1))+1); this.ingest.pdf.start=nxt; this.flash('本地转化中断：已保存 '+saved+' 段，开始页已设为 '+nxt+'。'+e.message,true); } this.loadMaterials(); }
      if(tess&&tess.terminate){ try{ await tess.terminate(); }catch(_){} }
      this.ingest.local.busy=false; this.ingest.local.prog='';
    },
    async photoToMaterialLocal(){ if(!this.ingest.photoDataUrl){ this.flash('请先选择照片',true); return; } if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } this.ingest.local.busy=true; this.ingest.local.done=0; this.ingest.local.inserted=0; this.ingest.result=null; let tess=null; try{ let text=''; if(this.ingest.local.engine==='relay'){ try{ this.ingest.local.prog='中转站视觉 OCR 识别中…'; const img=new Image(); img.src=this.ingest.photoDataUrl; await img.decode(); const cv=document.createElement('canvas'); cv.width=img.naturalWidth; cv.height=img.naturalHeight; cv.getContext('2d').drawImage(img,0,0); text=await this.relayOcrCanvas(cv); }catch(e){ if(e.message!=='unauth')this.flash(e.message,true); if(e.fatal){ this.ingest.local.busy=false; this.ingest.local.prog=''; return; } } } else if(this.ingest.local.engine==='cfai'){ try{ this.ingest.local.prog='Workers AI 识别中（今日 '+this.cfocr.used+'/'+this.cfocr.limit+'）…'; const img=new Image(); img.src=this.ingest.photoDataUrl; await img.decode(); const cv=document.createElement('canvas'); cv.width=img.naturalWidth; cv.height=img.naturalHeight; cv.getContext('2d').drawImage(img,0,0); text=await this.cfocrOcrCanvas(cv); }catch(e){ if(e.message!=='unauth')this.flash(e.message,true); if(e.quota||e.fatal){ this.ingest.local.busy=false; this.ingest.local.prog=''; return; } } } else if(this.ingest.local.engine==='scribe'){ try{ this.ingest.local.prog='Scribe.js 识别中（首次较慢）…'; const img=new Image(); img.src=this.ingest.photoDataUrl; await img.decode(); const cv=document.createElement('canvas'); cv.width=img.naturalWidth; cv.height=img.naturalHeight; cv.getContext('2d').drawImage(img,0,0); text=await this.scribeOcrCanvas(cv); }catch(e){ this.flash('Scribe.js 不可用，已回退 tesseract：'+e.message,true); this.ingest.local.engine='tesseract'; } } if(!text){ this.ingest.local.prog='tesseract 识别中（首次较慢）…'; tess=await this.ensureTesseract(); const r=await tess.recognize(this.ingest.photoDataUrl); text=String(r?.data?.text||'').trim(); } if(!text){ this.flash('未识别出文字',true); } else { const n=await this.saveMaterialsLocal(text,this.materialBaseTitle()); this.ingest.result={kind:'material',inserted_questions:0,inserted_materials:n,material_sample:[]}; this.flash('本地 OCR 完成，已保存 '+n+' 段教材（未调用 AI）'); this.loadMaterials(); } }catch(e){ if(e.message!=='unauth')this.flash('本地 OCR 失败：'+e.message,true); } if(tess&&tess.terminate){ try{ await tess.terminate(); }catch(_){} } this.ingest.local.busy=false; this.ingest.local.prog=''; },
    async genQuestionsFromMaterial(){ const m=this.currentPageMat; if(!m){ this.flash('请先选择教材页',true); return; } if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } if(!this.ai.hasAI){ this.flash('未配置 AI 中转站，无法生成题目',true); return; } this.genq.busy=true; this.genq.result=null; try{ const d=await this.api('/api/process',{method:'POST',body:JSON.stringify({subject:m.subject,chapter:m.summary||'',source:'教材出题-'+(m.title||''),kind:'questions',raw_text:String(m.content_md||'').slice(0,8000)})}); this.genq.result=d; this.flash('已根据本页教材生成 '+(d.inserted_questions??d.inserted??0)+' 道题'); this.loadMeta(true); this.statsDirty=true; }catch(e){ if(e.message!=='unauth')this.flash('生成题目失败：'+e.message,true); } this.genq.busy=false; },
    // —— 本地抽题（不花 AI）：把 MinerU/Markdown 里现成的「编号习题 + 解答」用规则解析成结构化题目 ——
    _fullToHalf(s){ return String(s||'').replace(/[Ａ-Ｚａ-ｚ０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-65248)); },
    mdToQuestions(md, ctx){ ctx=ctx||{}; const text=String(md||'').replace(/\r/g,''); const lines=text.split('\n');
      let chapter=ctx.chapter||''; const items=[]; let cur=null;
      const xiti=/(习题|练习|复习题|总习题|自测题|思考题|例题)\s*[0-9０-９]/; const zhang=/第\s*[0-9０-９一二三四五六七八九十百]+\s*[章节]/;
      const headRe=/^#{1,6}\s+(.+?)\s*#*$/; const boldRe=/^\s*\*\*(.+?)\*\*\s*$/; const numRe=/^\s*\*{0,2}\s*([0-9０-９]{1,3})\s*[.．、)）]\s*(.+)$/;
      const flush=()=>{ if(cur&&cur.lines.join('').trim())items.push(cur); cur=null; };
      for(const raw of lines){ let head=null; const h=raw.match(headRe); if(h)head=h[1]; else { const b=raw.match(boldRe); if(b)head=b[1]; }
        if(head){ const t=head.replace(/\*\*/g,'').trim(); if(xiti.test(t)||zhang.test(t)){ chapter=t; flush(); continue; } if(h){ flush(); continue; } }
        const nm=raw.match(numRe); if(nm){ flush(); cur={ num:nm[1], chapter, lines:[nm[2]] }; continue; }
        if(cur)cur.lines.push(raw); }
      flush();
      const out=[]; for(const it of items){ const q=this._buildQuestionFromItem(it, ctx); if(q)out.push(q); } return out; },
    _buildQuestionFromItem(it, ctx){ const body=it.lines.join('\n').trim(); if(!body)return null;
      // 找"解/证/解答/证明/分析/答案"边界：可在行首，也可在句末标点后（MinerU 常把题目和解答放在同一段）
      const solRe=/(^|[\n。．.；;！!？?）)\]】」])\s*[>*【「\[]?\s*(解答|证明|分析|解|证|答案|答)\s*[】」\]]?\s*[：:．.、]?\s*(?=[\s$（(\\A-Za-z\u4e00-\u9fa5\d])/;
      const m=body.match(solRe); let stemPart, solPart='';
      if(m && m.index!=null){ const cut=m.index+(m[1]?m[1].length:0); const head=body.slice(0,cut).trim(); if(head){ stemPart=head; solPart=body.slice(cut).trim(); } else { stemPart=body; } }
      else { stemPart=body; }
      const optRe=/^\s*[（(]?\s*([A-DＡ-Ｄ])\s*[）).．、]\s*(.+)$/; const sl=stemPart.split('\n'); const opts=[]; const keep=[];
      for(const ln of sl){ const om=ln.match(optRe); if(om){ opts.push({ key:this._fullToHalf(om[1]), text:om[2].trim() }); } else keep.push(ln); }
      let type='short_answer', options=[], answer=[], analysis='';
      if(opts.length>=2){ type='single_choice'; options=opts; stemPart=keep.join('\n').trim();
        const am=solPart.match(/(?:答案|正确答案|答|选|应选)\s*[是为：:]?\s*([A-DＡ-Ｄ](?:\s*[,，、和]\s*[A-DＡ-Ｄ])*)/);
        if(am){ const keys=this._fullToHalf(am[1]).split(/[,，、和\s]+/).filter(Boolean); answer=keys; if(keys.length>1)type='multiple_choice'; }
        analysis=solPart; }
      else { type='short_answer'; if(solPart){ answer=[solPart]; analysis=solPart; } }
      const stem=(stemPart||'').trim(); if(!stem)return null;
      return { subject:ctx.subject||'', chapter:it.chapter||ctx.chapter||'', type, difficulty:3, source:ctx.source||'', passage:'', stem, options, answer, analysis, tags:it.chapter?[it.chapter]:[], page:(ctx.page!=null?ctx.page:null) }; },
    async _postQuestions(arr, subject, source){ let inserted=0; const CH=40; for(let i=0;i<arr.length;i+=CH){ const d=await this.api('/api/process',{method:'POST',body:JSON.stringify({ subject, source, questions:arr.slice(i,i+CH) })}); inserted+=(d.inserted_questions??d.inserted??0); } return inserted; },
    _openPreview(arr, title, subject, source){ const seen=new Set(); const uniq=[]; let dup=0; for(const q of arr){ const k=String(q.stem||'').replace(/\s+/g,' ').trim(); if(!k)continue; if(seen.has(k)){ dup++; continue; } seen.add(k); uniq.push(q); } this.extractPreview={ open:true, items:uniq.map(q=>Object.assign({_use:true},q)), title, subject, source, dup }; },
    extractMissingCount(){ return this.extractPreview.items.filter(q=>q._use && !(q.answer&&q.answer.length)).length; },
    extractUseCount(){ return this.extractPreview.items.filter(q=>q._use).length; },
    extractToggleMissing(){ const hasOn=this.extractPreview.items.some(q=>q._use&&!(q.answer&&q.answer.length)); this.extractPreview.items.forEach(q=>{ if(!(q.answer&&q.answer.length))q._use=!hasOn; }); },
    extractClose(){ this.extractPreview.open=false; this.extractPreview.items=[]; },
    typeName(t){ return ({single_choice:'单选',multiple_choice:'多选',true_false:'判断',fill_blank:'填空',short_answer:'简答',code:'代码'})[t]||t; },
    ansLines(q){ return ((q&&q.answer)||[]).join('\n'); },
    async localExtractPage(){ const m=this.currentPageMat; if(!m){ this.flash('请先选择一页',true); return; } if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      const src=this.currentBook?this.currentBook.title:(m.source||''); const arr=this.mdToQuestions(m.content_md,{subject:m.subject,source:src,page:m.page});
      if(!arr.length){ this.flash('这一页没解析出题目（可能不是习题页，或编号格式特殊，可改用 AI 抽取）',true); return; }
      this._openPreview(arr, (m.title||'本页')+'（预览）', m.subject, src); },
    async localExtractBook(){ const b=this.currentBook; if(!b||!b.pages.length){ this.flash('请先选择一本书',true); return; } if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      let all=[]; for(const m of b.pages){ all=all.concat(this.mdToQuestions(m.content_md,{subject:m.subject||b.subject,source:b.title,page:m.page})); }
      if(!all.length){ this.flash('整本书没解析出题目（可能这本不是习题集）',true); return; }
      this._openPreview(all, '《'+b.title+'》整本（预览）', b.subject, b.title); },
    async extractDoImport(){ const p=this.extractPreview; const arr=p.items.filter(q=>q._use).map(q=>{ const c=Object.assign({},q); delete c._use; return c; }); if(!arr.length){ this.flash('没有勾选要导入的题',true); return; }
      this.bookExtract.busy=true; this.bookExtract.done=0; this.bookExtract.total=arr.length;
      try{ let inserted=0; const CH=40; for(let i=0;i<arr.length;i+=CH){ this.bookExtract.prog='正在导入 '+Math.min(i+CH,arr.length)+' / '+arr.length; const d=await this.api('/api/process',{method:'POST',body:JSON.stringify({ subject:p.subject, source:p.source, questions:arr.slice(i,i+CH) })}); inserted+=(d.inserted_questions??d.inserted??0); this.bookExtract.done=Math.min(i+CH,arr.length); }
        this.flash('已导入 '+inserted+' 道题到题库（未用 AI）'); this.loadMeta(true); this.statsDirty=true; this.extractClose(); }
      catch(e){ if(e.message!=='unauth')this.flash('导入失败：'+e.message,true); } this.bookExtract.busy=false; this.bookExtract.prog=''; },
    // —— 浏览器内 PDF 原书阅读（PDF.js 直接渲染原页，不做 OCR/转换）——
    async pdfvOpenLocal(e){ const f=e.target.files&&e.target.files[0]; if(!f)return; await this.pdfvOpenSrc(await f.arrayBuffer(), f.name.replace(/\.pdf$/i,'')); },
    _isMobile(){ try{ const coarse=window.matchMedia&&window.matchMedia('(pointer:coarse)').matches; return !!coarse && (window.innerWidth||9999)<=900; }catch(_){ return (window.innerWidth||9999)<=820; } },
    async pdfvOpenSrc(buf,title){ this.pdfv.loading=true; this.pdfv.msg=this.pdfv.msg||'解析中…'; try{ await this.ensurePdfjs(); const task=window.pdfjsLib.getDocument({data:buf}); if(task.onProgress!==undefined){ task.onProgress=(p)=>{ if(p&&p.total)this.pdfv.msg='解析中 '+Math.round(p.loaded/p.total*100)+'%'; }; } const doc=await task.promise; this._pdfvDoc=doc; this.pdfv.pages=doc.numPages; this.pdfv.title=title||'PDF'; this.pdfvMobile=this._isMobile();
        let pref=''; try{ pref=localStorage.getItem('zb_pdfmode')||''; }catch(_){}
        this.pdfv.mode = this.pdfvMobile ? 'page' : (pref==='page'?'page':'scroll');
        let saved=1; try{ saved=Math.min(Math.max(1,parseInt(localStorage.getItem(this._pdfvPosKey())||'1',10)||1),this.pdfv.pages); }catch(_){ saved=1; }
        this.pdfv.cur=saved; this.pdfv.open=true;
        this.$nextTick(()=>{ if(this.pdfv.mode==='page'){ this.pdfvRenderSingle(); } else { this.pdfvSetupPages(saved>1); } this.pdfvSetupThumbs(); if(saved>1)this.flash('已回到上次阅读的第 '+saved+' 页'); });
      }catch(e){ this.flash('PDF 解析失败：'+e.message,true); } this.pdfv.loading=false; this.pdfv.msg=''; },
    _pdfvPosKey(){ return 'zb_pdfpos:'+(this.pdfv.title||'PDF'); },
    pdfvSavePos(){ try{ localStorage.setItem(this._pdfvPosKey(), String(this.pdfv.cur)); }catch(_){} },
    pdfvToggleMode(){ this.pdfv.mode = this.pdfv.mode==='scroll' ? 'page' : 'scroll'; try{ localStorage.setItem('zb_pdfmode', this.pdfv.mode); }catch(_){} const cur=this.pdfv.cur; this._pdfvQueue=[]; this._pdfvBusy=false; if(this.pdfv.mode==='page'){ if(this._pdfvObsR)this._pdfvObsR.disconnect(); const main=this.$refs.pdfvMain; if(main&&this._pdfvScroll)main.removeEventListener('scroll',this._pdfvScroll); this.$nextTick(()=>this.pdfvRenderSingle()); } else { this.$nextTick(()=>{ this.pdfvSetupPages(false); this.pdfvSetupThumbs(); this.$nextTick(()=>this.pdfvGoto(cur)); }); } },
    // 单页模式：只渲染当前一页到一个 canvas（内存恒定，手机不崩）
    pdfvScrollCardTop(){ try{ const card=document.querySelector('.pdfv'); if(!card)return; const tb=document.querySelector('.topbar'); const off=(tb?tb.getBoundingClientRect().height:90)+8; const y=window.scrollY+card.getBoundingClientRect().top-off; window.scrollTo({top:Math.max(0,y), behavior:'auto'}); }catch(_){} },
    async pdfvRenderSingle(opts){ opts=opts||{}; const doc=this._pdfvDoc, cv=this.$refs.pdfvSingle; if(!doc||!cv)return; const token=(this._pdfvSingleToken=(this._pdfvSingleToken||0)+1); if(this._pdfvSingleTask){ try{ this._pdfvSingleTask.cancel(); }catch(_){ } this._pdfvSingleTask=null; } this.pdfv.rendering=true; let anchor=null; if(opts.keepScroll){ try{ const h0=cv.parentElement; if(h0){ const top0=window.scrollY+h0.getBoundingClientRect().top; anchor=(window.scrollY-top0)/(h0.offsetHeight||1); } }catch(_){ } } else { this.pdfvScrollCardTop(); } try{ const page=await doc.getPage(this.pdfv.cur); if(token!==this._pdfvSingleToken)return; const dpr=Math.min(window.devicePixelRatio||1, 3); const host=cv.parentElement; const cw=Math.max(120,((host&&host.clientWidth)||600)-20); const vp1=page.getViewport({scale:1}); const z=Number(this.pdfv.scale)||1; const cssW=cw*z; const eff=Math.min(dpr, 2400/cssW); const rscale=(cssW/vp1.width)*eff; const vp=page.getViewport({scale:rscale}); const off=document.createElement('canvas'); off.width=Math.floor(vp.width); off.height=Math.floor(vp.height); const task=page.render({canvasContext:off.getContext('2d'),viewport:vp}); this._pdfvSingleTask=task; await task.promise; if(token!==this._pdfvSingleToken)return; cv.width=off.width; cv.height=off.height; cv.style.width=Math.round(cssW)+'px'; cv.getContext('2d').drawImage(off,0,0); if(opts.keepScroll&&anchor!=null){ try{ const h1=cv.parentElement; if(h1){ const top1=window.scrollY+h1.getBoundingClientRect().top; window.scrollTo({top:Math.max(0,top1+anchor*(h1.offsetHeight||1)),behavior:'auto'}); } }catch(_){ } } }catch(e){} finally{ if(token===this._pdfvSingleToken){ this._pdfvSingleTask=null; this.pdfv.rendering=false; } } },
    pdfvTouchStart(e){ const t=e.touches&&e.touches[0]; this._pdfvTx=t?t.clientX:0; this._pdfvTy=t?t.clientY:0; },
    pdfvTouchMove(e){ if((Number(this.pdfv.scale)||1)<=1.05){ if(e.cancelable)e.preventDefault(); } },
    pdfvTouchEnd(e){ if((Number(this.pdfv.scale)||1)>1.05)return; const t=e.changedTouches&&e.changedTouches[0]; if(!t)return; const dx=t.clientX-(this._pdfvTx||0), dy=t.clientY-(this._pdfvTy||0); if(Math.abs(dy)>45 && Math.abs(dy)>Math.abs(dx)){ if(dy<0)this.pdfvNext(); else this.pdfvPrev(); } else if(Math.abs(dx)>55 && Math.abs(dx)>Math.abs(dy)){ if(dx<0)this.pdfvNext(); else this.pdfvPrev(); } },
    // 连续滚动：为每页占位 + 懒加载渲染 + 滚动联动当前页；restore=true 时打开后回到上次阅读页
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
    // 入队（不立即渲染）：只排还在当前窗口附近、尚未渲染的页
    pdfvEnqueue(n,el){ if(!el||el.dataset.rendered==='1'||el.dataset.queued==='1')return; if(Math.abs(n-this.pdfv.cur)>this._pdfvKeep()+2)return; el.dataset.queued='1'; this._pdfvQueue=this._pdfvQueue||[]; this._pdfvQueue.push(n); this.pdfvDrain(); },
    // 串行渲染：一次只画一页；轮到时再确认这页是否仍需要，避免快速滑动时并发分配大量 canvas
    async pdfvDrain(){ if(this._pdfvBusy)return; this._pdfvBusy=true; const main=this.$refs.pdfvMain, doc=this._pdfvDoc;
      try{ while(this._pdfvQueue&&this._pdfvQueue.length){ const n=this._pdfvQueue.shift(); if(!main||!doc)break; const el=main.querySelector('.pdfv-page[data-page="'+n+'"]'); if(!el){ continue; } el.dataset.queued=''; if(el.dataset.rendered==='1')continue; if(Math.abs(n-this.pdfv.cur)>this._pdfvKeep()+2){ continue; }
          try{ const page=await doc.getPage(n); const dpr=Math.min(window.devicePixelRatio||1, 3); const cssW=this._pdfvDispW||Math.max(160,(main.clientWidth||600)-32); const eff=Math.min(dpr, 2200/cssW); const rscale=(cssW/(this._pdfvBaseW||cssW))*eff; const vp=page.getViewport({scale:rscale}); const cv=el.querySelector('canvas'); if(!cv)continue; cv.width=Math.floor(vp.width); cv.height=Math.floor(vp.height); cv.style.width=Math.round(cssW)+'px'; await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise; el.dataset.rendered='1'; el.style.height=''; this.pdfvPrune(); }catch(e){ el.dataset.rendered=''; }
          await new Promise(r=>setTimeout(r,0)); }
      }finally{ this._pdfvBusy=false; } },
    pdfvUnrender(el){ if(!el||el.dataset.rendered!=='1')return; const cv=el.querySelector('canvas'); if(cv){ cv.width=0; cv.height=0; cv.style.width=''; } el.dataset.rendered=''; if(this._pdfvDispH)el.style.height=this._pdfvDispH+'px'; },
    pdfvPrune(){ const main=this.$refs.pdfvMain; if(!main)return; const KEEP=this._pdfvKeep(); const lo=this.pdfv.cur-KEEP, hi=this.pdfv.cur+KEEP; main.querySelectorAll('.pdfv-page').forEach(el=>{ if(el.dataset.rendered==='1'){ const p=parseInt(el.dataset.page,10); if(p<lo||p>hi)this.pdfvUnrender(el); } }); },
    pdfvScrollSync(){ const main=this.$refs.pdfvMain; if(!main)return; const top=main.scrollTop+90; let cur=1; const els=main.querySelectorAll('.pdfv-page'); for(const el of els){ if(el.offsetTop<=top)cur=parseInt(el.dataset.page,10); else break; } for(let i=cur-1;i<=cur+2;i++){ const e=main.querySelector('.pdfv-page[data-page="'+i+'"]'); if(e)this.pdfvEnqueue(i,e); } if(cur&&cur!==this.pdfv.cur){ this.pdfv.cur=cur; this.pdfvSavePos(); this.pdfvPrune(); const t=this.$refs.pdfvRail&&this.$refs.pdfvRail.querySelector('.pdfv-thumb[data-page="'+cur+'"]'); if(t)t.scrollIntoView({block:'nearest'}); } },
    pdfvGoto(n){ const t=Math.min(Math.max(1,parseInt(n,10)||1),this.pdfv.pages); this.pdfv.cur=t; this.pdfvSavePos(); if(this.pdfv.mode==='page'){ this.pdfvRenderSingle(); } else { const main=this.$refs.pdfvMain; if(main){ const sel='.pdfv-page[data-page="'+t+'"]'; const el=main.querySelector(sel); if(el){ for(let i=t-1;i<=t+2;i++){ const e=main.querySelector('.pdfv-page[data-page="'+i+'"]'); if(e)this.pdfvEnqueue(i,e); } main.scrollTop=el.offsetTop; this.pdfvPrune(); const fix=()=>{ const e2=main.querySelector(sel); if(e2)main.scrollTop=e2.offsetTop; }; requestAnimationFrame(fix); setTimeout(fix,180); setTimeout(fix,460); } } } const r=this.$refs.pdfvRail&&this.$refs.pdfvRail.querySelector('.pdfv-thumb[data-page="'+t+'"]'); if(r)r.scrollIntoView({block:'nearest'}); },
    pdfvPrev(){ this.pdfvGoto(this.pdfv.cur-1); },
    pdfvNext(){ this.pdfvGoto(this.pdfv.cur+1); },
    pdfvZoom(d){ this.pdfv.scale=Math.min(3,Math.max(0.5,Math.round((this.pdfv.scale+d)*10)/10)); const cur=this.pdfv.cur; if(this.pdfv.mode==='page'){ this.$nextTick(()=>this.pdfvRenderSingle({keepScroll:true})); } else { this.$nextTick(()=>{ this.pdfvSetupPages(false); this.$nextTick(()=>this.pdfvGoto(cur)); }); } },
    pdfvSetupThumbs(){ if(this._pdfvObs){ this._pdfvObs.disconnect(); this._pdfvObs=null; } const root=this.$refs.pdfvRail; if(!root||!window.IntersectionObserver)return; root.querySelectorAll('.pdfv-thumb canvas').forEach(cv=>{ cv.width=0; cv.height=0; }); this._pdfvObs=new IntersectionObserver((ents)=>{ for(const en of ents){ if(en.isIntersecting){ const p=parseInt(en.target.getAttribute('data-page'),10); this.pdfvRenderThumb(p,en.target); this._pdfvObs.unobserve(en.target); } } },{root,rootMargin:'300px'}); this.$nextTick(()=>{ root.querySelectorAll('.pdfv-thumb').forEach(el=>this._pdfvObs.observe(el)); }); },
    async pdfvRenderThumb(n,el){ const doc=this._pdfvDoc; if(!doc||!el)return; try{ const page=await doc.getPage(n); const vp=page.getViewport({scale:0.28}); const cv=el.querySelector('canvas'); if(!cv)return; cv.width=Math.floor(vp.width); cv.height=Math.floor(vp.height); await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise; }catch(e){} },
    pdfvClose(){ const main=this.$refs.pdfvMain; if(main&&this._pdfvScroll)main.removeEventListener('scroll',this._pdfvScroll); this._pdfvScroll=null; this._pdfvSingleToken=(this._pdfvSingleToken||0)+1; if(this._pdfvSingleTask){ try{ this._pdfvSingleTask.cancel(); }catch(_){ } this._pdfvSingleTask=null; } this.pdfv.open=false; this._pdfvDoc=null; if(this._pdfvObs){ this._pdfvObs.disconnect(); this._pdfvObs=null; } if(this._pdfvObsR){ this._pdfvObsR.disconnect(); this._pdfvObsR=null; } },
    saveOcrCfg(){ try{ localStorage.setItem('zb_ocrcfg', JSON.stringify(this.ocrCfg)); }catch(_){} },
    logPage(p,t,msg){ const arr=this.ingest.local.log; arr.push({p,t,msg}); if(arr.length>500)arr.splice(0,arr.length-500); },
    async importMarkdownAsBook(md, book, subj, tag, off){ off=off||0; const parts=this.chunkMarkdownByStructure(md); if(!parts.length){ return 0; } let n=0; for(let i=0;i<parts.length;i++){ this.ingest.mineru.prog='导入第 '+(off+i+1)+' 段…'; const h=this.firstHeadingOf(parts[i]); const gp=off+i+1; const title=book+' · '+(h||('第 '+gp+' 段')); const d=await this.saveOneMaterial({id:'mat-'+subj+'-'+this.bookHashId(book+'#p'+gp),subject:subj,title,source:book,page:gp,content_md:parts[i],summary:'',tags:tag?[tag]:[]}); n+=d.inserted||1; } return n; },
    stripFurniturePages(pages){ if(!pages||pages.length<4)return (pages||[]).map(p=>({page:p.page, md:p.md.split('\n').filter(l=>!/^\s*\d{1,4}\s*$/.test(l.trim())).join('\n').replace(/\n{3,}/g,'\n\n').trim()})).filter(p=>p.md); const freq={}; const N=pages.length; pages.forEach(p=>{ const seen=new Set(); p.md.split('\n').forEach(l=>{ const t=l.trim(); if(t&&t.length<=24&&!/^#{1,6}\s/.test(t)&&!/^(figure|<)/i.test(t)){ if(!seen.has(t)){ seen.add(t); freq[t]=(freq[t]||0)+1; } } }); }); const thr=Math.max(3, Math.ceil(N*0.3)); const furniture=new Set(Object.keys(freq).filter(k=>freq[k]>=thr)); return pages.map(p=>{ const lines=p.md.split('\n').filter(l=>{ const t=l.trim(); if(!t)return true; if(/^\s*\d{1,4}\s*$/.test(t))return false; if(furniture.has(t))return false; return true; }); return {page:p.page, md:lines.join('\n').replace(/\n{3,}/g,'\n\n').trim()}; }).filter(p=>p.md); },
    async importPagesAsBook(pages, book, subj, tag, off){ off=off||0; pages=this.stripFurniturePages(pages); let n=0; for(let i=0;i<pages.length;i++){ const p=pages[i]; const gp=off+(p.page||i+1); this.ingest.mineru.prog='导入第 '+gp+' 页…'; const h=this.firstHeadingOf(p.md); const title=book+' · '+(h||('第 '+gp+' 页')); const d=await this.saveOneMaterial({id:'mat-'+subj+'-'+this.bookHashId(book+'#p'+gp),subject:subj,title,source:book,page:gp,content_md:p.md,summary:'',tags:tag?[tag]:[]}); n+=d.inserted||1; } return n; },
    _zipImgFinder(zip){ const names=Object.keys(zip.files); return (p)=>{ if(!p)return null; if(zip.files[p]&&!zip.files[p].dir)return zip.files[p]; const base=p.split('/').pop(); const k=names.find(n=>n.split('/').pop()===base && !zip.files[n].dir); return k?zip.files[k]:null; }; },
    _imgMime(p){ const e=(String(p).split('.').pop()||'').toLowerCase(); return e==='png'?'image/png':e==='webp'?'image/webp':e==='gif'?'image/gif':e==='bmp'?'image/bmp':'image/jpeg'; },
    _esc(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); },
    async _zipImgDataUrl(zip, find, p){ const f=find(p); if(!f)return null; const b64=await f.async('base64'); if(b64.length>1.6*1048576)return null; return 'data:'+this._imgMime(p)+';base64,'+b64; },
    async mineruBuildPagesFromZip(zip){ const names=Object.keys(zip.files); const clName=names.find(n=>/_content_list\.json$/i.test(n))||names.find(n=>/content_list\.json$/i.test(n)); if(!clName)return null; let list; try{ list=JSON.parse(await zip.files[clName].async('string')); }catch(_){ return null; } if(!Array.isArray(list)||!list.length)return null; const find=this._zipImgFinder(zip); const pages={}; const order=[]; for(const it of list){ const pi=(it.page_idx!=null?it.page_idx:(it.page!=null?it.page:0)); if(!(pi in pages)){ pages[pi]=[]; order.push(pi); } const arr=pages[pi]; const type=it.type||'text'; if(type==='text'||type==='title'){ let t=String(it.text||'').trim(); if(!t)continue; if(this._mineruJunk(t))continue; const lv=it.text_level||(type==='title'?1:0); if(lv&&lv>=1&&lv<=6)t='#'.repeat(lv)+' '+t; arr.push(t); } else if(type==='equation'){ let t=String(it.text||it.latex||'').trim(); if(!t)continue; if(!/\$/.test(t))t='$$\n'+t+'\n$$'; arr.push(t); } else if(type==='image'||type==='figure'){ const capR=it.img_caption!=null?it.img_caption:(it.image_caption!=null?it.image_caption:it.caption); const cap=Array.isArray(capR)?capR.join(' '):(capR||''); const ip=it.img_path||it.image_path; const fo=ip?find(ip):null; if(fo){ const b64=await fo.async('base64'); if(b64.length<1500){ /* 极小装饰图标，跳过 */ } else if(b64.length>1.6*1048576){ arr.push(cap?('*（图：'+cap+'）*'):'*（图略·过大）*'); } else { let h='<figure class="fig"><img src="data:'+this._imgMime(ip)+';base64,'+b64+'">'; if(cap)h+='<figcaption>'+this._esc(cap)+'</figcaption>'; h+='</figure>'; arr.push(h); } } else if(cap){ arr.push('*（图：'+cap+'）*'); } } else if(type==='table'){ if(it.table_body){ arr.push(String(it.table_body)); } else { const du=await this._zipImgDataUrl(zip,find,it.img_path); if(du)arr.push('![]('+du+')'); else arr.push('*（表格图略）*'); } const cap=Array.isArray(it.table_caption)?it.table_caption.join(' '):(it.table_caption||''); if(cap)arr.push('<p class="figcap">'+this._esc(cap)+'</p>'); } else { const t=String(it.text||'').trim(); if(t)arr.push(t); } } order.sort((a,b)=>a-b); return order.map(pi=>({page:pi+1, md:pages[pi].join('\n\n').trim()})).filter(p=>p.md); },
    async embedZipImages(md, zip){ const find=this._zipImgFinder(zip); const refs=[]; const re=/!\[([^\]]*)\]\(([^)]+)\)/g; let m; while((m=re.exec(md)))refs.push({full:m[0],alt:m[1],path:m[2]}); for(const r of refs){ if(/^(https?:|data:)/.test(r.path))continue; const du=await this._zipImgDataUrl(zip,find,r.path); md = du ? md.replace(r.full,'!['+r.alt+']('+du+')') : md.replace(r.full, r.alt?('*（图：'+r.alt+'）*'):'*（图略）*'); } return md; },
    mlog(s){ const a=this.ingest.mineru.log; a.push(s); if(a.length>300)a.splice(0,a.length-300); },
    _rangePages(r){ r=String(r||'').trim(); if(!r)return 0; let total=0; for(const part of r.split(',')){ const m=part.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/); if(m){ total+=Math.max(0,parseInt(m[2])-parseInt(m[1])+1); } else if(/^\s*\d+\s*$/.test(part)){ total+=1; } } return total; },
    mineruUsageToday(){ const today=new Date().toISOString().slice(0,10); let u=null; try{ u=JSON.parse(localStorage.getItem('zb_mineru_usage')||'null'); }catch(_){ } if(!u||u.date!==today)u={date:today,pages:0,files:0}; return u; },
    mineruRefreshUsage(){ this.mineruUsageView=Object.assign({},this.mineruUsageToday()); },
    mineruAddUsage(pages,files){ const u=this.mineruUsageToday(); u.pages+=(pages||0); u.files+=(files||0); try{ localStorage.setItem('zb_mineru_usage', JSON.stringify(u)); }catch(_){ } this.mineruUsageView=Object.assign({},u); },
    mineruResetUsage(){ try{ localStorage.removeItem('zb_mineru_usage'); }catch(_){ } this.mineruRefreshUsage(); this.flash('已重置今日用量统计'); },
    mineruCheckQuota(pages,files){ const u=this.mineruUsageToday(); const pl=Number(this.mineruCfg.pageLimit)||0, fl=Number(this.mineruCfg.fileLimit)||0; const overP=pl>0&&(u.pages+pages>pl); const overF=fl>0&&(u.files+files>fl); if(overP||overF){ const msg='本次约 '+pages+' 页 / '+files+' 个文件。\n今日已通过本工具用：'+u.pages+'/'+pl+' 页、'+u.files+'/'+fl+' 文件。\n'+(overP?'· 将超出每日页数上限\n':'')+(overF?'· 将超出每日文件数上限\n':'')+'\n仍要继续吗？（用量以 MinerU 后台为准，此处为本工具本地统计）'; return confirm(msg); } return true; },
    mineruTokenDays(){ const d=(this.mineruCfg.tokenExp||'').trim(); if(!d)return null; const t=new Date(d+'T23:59:59'); if(isNaN(t.getTime()))return null; return Math.ceil((t.getTime()-Date.now())/86400000); },
    saveMineruCfg(){ try{ localStorage.setItem('zb_mineru_cfg', JSON.stringify({pageLimit:Number(this.mineruCfg.pageLimit)||0,fileLimit:Number(this.mineruCfg.fileLimit)||0,tokenExp:this.mineruCfg.tokenExp||''})); }catch(_){ } },
    mineruIsTokenErr(msg){ const s=String(msg||''); return /A0211|A0202/.test(s) || (/token/i.test(s) && /(过期|失效|错误|无效|invalid|expired|unauthor)/i.test(s)); },
    mineruTokenOk(){ if(this.mineruTokenBad){ this.mineruTokenBad=false; try{ localStorage.removeItem('zb_mineru_tokenbad'); }catch(_){ } } },
    mineruFail(e, prefix){ if(e&&e.message==='unauth')return; const msg=(e&&e.message)||String(e); this.mlog('✗ '+(prefix||'失败：')+msg); if(this.mineruIsTokenErr(msg)){ this.mineruTokenBad=true; try{ localStorage.setItem('zb_mineru_tokenbad','1'); }catch(_){ } this.flash('MinerU Token 已过期或无效（接口返回 A0211/A0202）：请去控制台重建 Token 并更新环境变量后重新部署',true); } else { this.flash((prefix||'MinerU 失败：')+msg,true); } },
    _mineruSaveJob(job){ try{ localStorage.setItem('zb_mineru_job', JSON.stringify(Object.assign({ts:Date.now()},job))); }catch(_){ } },
    _mineruClearJob(){ try{ localStorage.removeItem('zb_mineru_job'); }catch(_){ } },
    async mineruResume(){ if(!this.token)return; let job=null; try{ job=JSON.parse(localStorage.getItem('zb_mineru_job')||'null'); }catch(_){ } if(!job||!job.kind)return; if(Date.now()-(job.ts||0)>45*60000){ this._mineruClearJob(); return; } const M=this.ingest.mineru; if(M.busy)return; M.busy=true; M.log=[]; M.pct=30; M.prog='恢复未完成任务…'; this.mlog('检测到未完成的 MinerU 任务，正在恢复（无需重新上传文件）…'); this.flash('正在恢复上次未完成的 MinerU 导入…'); try{ let n=0; if(job.kind==='precise'){ n=await this.mineruFinishPrecise(job.batch_id, job.book, job.subj, job.offset||0, M); } else if(job.kind==='agent'){ n=await this.mineruFinishAgent(job.task_id, job.book, M); } else { this._mineruClearJob(); M.busy=false; return; } M.pct=100; M.prog='完成'; this.mlog('✓ 恢复完成，导入 '+n+' 段到《'+job.book+'》'); this.flash('已恢复并导入 '+n+' 段到 Books'); this.mineruTokenOk(); this.loadMaterials(); }catch(e){ this.mineruFail(e,'恢复 MinerU 任务失败：'); this._mineruClearJob(); } M.busy=false; },
    async mineruFinishPrecise(batch_id, book, subj, pageOffset, M){ let zipUrl='',tries=0; while(tries<180){ await this.sleep(4000); tries++; let s; try{ s=await this.api('/api/mineru?action=status&batch_id='+encodeURIComponent(batch_id)); }catch(e){ this.mlog('查询出错（重试）：'+e.message); continue; } const st=String(s.state||'unknown'); const ep=s.progress||{}; const ptxt=ep.extracted_pages!=null?('，'+ep.extracted_pages+'/'+(ep.total_pages||'?')+' 页'):''; M.prog='解析中：'+st+ptxt; if(M.pct<88)M.pct+=1; if(st==='done'||st==='success'){ zipUrl=s.zip_url; this.mlog('③ 解析完成'); break; } if(st==='failed'||st==='error')throw new Error('MinerU 解析失败：'+(s.err||'未知')); if(tries%5===0)this.mlog('仍在解析…（'+st+ptxt+'，已等 '+(tries*4)+'s）'); } if(!zipUrl)throw new Error('解析超时（12 分钟）。可稍后在导入页重试'); this.mlog('④ 下载结果 ZIP…'); const zres=await fetch('/api/mineru?action=download&zip_url='+encodeURIComponent(zipUrl),{headers:{authorization:'Bearer '+this.token}}); if(!zres.ok)throw new Error('下载结果失败 HTTP '+zres.status); const zbuf=await zres.arrayBuffer(); await this.ensureJSZip(); const zip=await window.JSZip.loadAsync(zbuf); let pages=null; try{ pages=await this.mineruBuildPagesFromZip(zip); }catch(e){ this.mlog('content_list 解析失败，回退 full.md：'+e.message); } let n; if(pages&&pages.length){ this.mlog('⑤ 按真实页还原 '+pages.length+' 页（含图片），导入…'); n=await this.importPagesAsBook(pages, book, subj, 'MinerU', pageOffset); } else { const names=Object.keys(zip.files); let mdName=names.find(x=>/full\.md$/i.test(x))||names.find(x=>/\.md$/i.test(x)); if(!mdName)throw new Error('结果 ZIP 里没有 Markdown 文件'); let md=await zip.files[mdName].async('string'); md=await this.embedZipImages(md, zip); md=this.stripMineruJunk(md); if(!md)throw new Error('Markdown 内容为空'); this.mlog('⑤ full.md '+md.length+' 字（已嵌图），导入…'); n=await this.importMarkdownAsBook(md, book, subj, 'MinerU', pageOffset); } this._mineruClearJob(); return n; },
    async mineruFinishAgent(task_id, book, M){ const subj=this.guessSubject(book)||this.ingest.subject; this.ingest.subject=subj; M.prog='解析中…'; if(M.pct<28)M.pct=28; let mdUrl='',tries=0; while(tries<120){ await this.sleep(3000); tries++; let s; try{ s=await this.api('/api/mineru?action=agent_status&task_id='+encodeURIComponent(task_id)); }catch(e){ this.mlog('查询出错（重试）：'+e.message); continue; } const st=String(s.state||'unknown'); M.prog='解析中：'+st; if(M.pct<86)M.pct+=2; if(st==='done'){ mdUrl=s.markdown_url; this.mlog('③ 解析完成'); break; } if(st==='failed'){ throw new Error('解析失败：'+(s.err||'未知')); } if(tries%4===0)this.mlog('仍在解析…（'+st+'，已等 '+(tries*3)+'s）'); } if(!mdUrl)throw new Error('解析超时'); M.prog='取回 Markdown…'; M.pct=90; this.mlog('④ 取回 Markdown…'); const md0=await this.api('/api/mineru?action=agent_md&md_url='+encodeURIComponent(mdUrl)); let md=String(md0.text||''); md=md.replace(/!\[([^\]]*)\]\((?!https?:|data:)[^)]*\)/g,(m,a)=>a?('*（图：'+a+'）*'):'*（图略）*'); md=this.stripMineruJunk(md); if(!md)throw new Error('Markdown 内容为空'); this.mlog('⑤ 得到 '+md.length+' 字，整理并导入…'); M.prog='导入 Books…'; M.pct=95; const n=await this.importMarkdownAsBook(md, book, subj, 'MinerU'); this._mineruClearJob(); return n; },
    chunkMarkdownByStructure(md, target){ target=target||4000; const lines=String(md||'').replace(/\r/g,'').split('\n'); const blocks=[]; let cur=[]; let inDisplay=false,inFence=false,envDepth=0; const flush=()=>{ if(cur.join('\n').trim())blocks.push(cur.join('\n')); cur=[]; }; for(const ln of lines){ const t=ln.trim(); if(/^```/.test(t))inFence=!inFence; const dd=(ln.match(/\$\$/g)||[]).length; const bg=(ln.match(/\\begin\{/g)||[]).length; const en=(ln.match(/\\end\{/g)||[]).length; cur.push(ln); if(!inFence){ if(dd%2===1)inDisplay=!inDisplay; envDepth+=bg-en; if(envDepth<0)envDepth=0; } if(t===''&&!inDisplay&&!inFence&&envDepth===0)flush(); } flush(); const isH=(b)=>/^#{1,3}\s/.test(b.trim()); const chunks=[]; let buf=''; for(const b of blocks){ if(buf && ((isH(b)&&buf.length>500) || (buf.length+b.length>target))){ chunks.push(buf.trim()); buf=''; } buf+=(buf?'\n\n':'')+b; } if(buf.trim())chunks.push(buf.trim()); return chunks.filter(c=>c.trim()); },
    firstHeadingOf(md){ const lines=String(md||'').split('\n'); for(const ln of lines){ const m=ln.match(/^#{1,6}\s+(.+)/); if(m){ const t=m[1].replace(/[*_`$\\]/g,'').trim(); if(t)return t.slice(0,40); } } for(const ln of lines){ let t=ln.trim(); if(!t)continue; if(/^!\[/.test(t))continue; if(/^\$\$/.test(t)||t==='$$')continue; if(/^<(table|img|div|p)/i.test(t))continue; if(/^[`>|]/.test(t))continue; if(this._mineruJunk(t))continue; t=t.replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/[#*_`$\\]/g,'').trim(); if(t)return t.slice(0,40); } return ''; },
    _mineruJunk(t){ return /(OCR result|Ground[\s-]?Truth|placeholder character|according to Rule|should be (empty|ignored|output|no)|stylistic horizontal line|the image contains only|no text (should|to|or)|must be ignored|output\b.*placeholder)/i.test(String(t||'')); },
    stripMineruJunk(md){ return String(md||'').split(/\n{2,}/).filter(b=>!this._mineruJunk(b)).join('\n\n').replace(/\n{3,}/g,'\n\n').trim(); },
    async ensureJSZip(){ if(window.JSZip)return; await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'); if(!window.JSZip)throw new Error('JSZip 加载失败（网络受限？）'); },
    async mineruUpload(uploadUrl, buf){ const res=await fetch('/api/mineru?action=upload&upload_url='+encodeURIComponent(uploadUrl),{method:'PUT',body:buf,headers:{authorization:'Bearer '+this.token}}); if(res.status===401){ this.token=''; localStorage.removeItem('zb_token'); this.view='settings'; throw new Error('unauth'); } const ct=res.headers.get('content-type')||''; let d=null; if(ct.includes('json')){ try{ d=await res.json(); }catch(_){} } if(!res.ok||!(d&&d.ok))throw new Error((d&&d.error)||('上传失败 HTTP '+res.status)); return true; },
    onMineruFile(e){ const f=e.target.files&&e.target.files[0]; if(!f)return; this._mineruFile=f; this.ingest.mineru.name=f.name+'（'+(f.size/1048576).toFixed(1)+'MB）'; const nm=f.name.replace(/\.[Pp][Dd][Ff]$/,'').trim(); if(nm)this.ingest.bookTitle=nm; const gs=this.guessSubject(nm); if(gs)this.ingest.subject=gs; },
    async mineruConvert(){ if(this.ingest.mineru.mode==='agent')return this.mineruConvertAgent(); return this.mineruConvertPrecise(); },
    async mineruConvertAgent(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } const f=this._mineruFile; if(!f){ this.flash('请先选择 PDF',true); return; } const book=(this.ingest.bookTitle||'').trim()||f.name.replace(/\.[Pp][Dd][Ff]$/,''); const M=this.ingest.mineru; let pr=(M.pageRange||'').trim(); if(pr.includes(',')){ this.flash('轻量模式页码不支持逗号，改用单段如 1-20',true); return; } if(f.size>10*1048576){ this.flash('轻量模式单文件上限 10MB，当前 '+(f.size/1048576).toFixed(1)+'MB。请用更小的 PDF，或创建 Token 用精准模式。',true); return; } M.busy=true; M.log=[]; M.pct=5; M.prog='提交（免 Token 轻量）…'; const _sp=pr?this._rangePages(pr):20; if(!this.mineruCheckQuota(_sp,1)){ M.busy=false; M.prog=''; return; } this.mineruAddUsage(_sp,1); this.mlog('① 提交解析任务（Agent 轻量，免 Token'+(pr?('，页码 '+pr):'')+'）…'); try{ const d1=await this.api('/api/mineru?action=agent_submit',{method:'POST',body:JSON.stringify({filename:f.name,language:'ch',is_ocr:true,page_range:pr||undefined})}); const task_id=d1.task_id, file_url=d1.file_url; if(!task_id||!file_url)throw new Error('未拿到 task_id/上传地址'); this.mlog('已创建 task_id='+task_id); M.prog='上传 PDF…'; M.pct=15; const buf=await f.arrayBuffer(); this.mlog('② 上传 PDF（经后端代理，绕过跨域）…'); await this.mineruUpload(file_url, buf); this.mlog('上传完成，等待解析…'); this._mineruSaveJob({kind:'agent',task_id,book}); M.prog='解析中…'; M.pct=28; let mdUrl='',tries=0; while(tries<120){ await this.sleep(3000); tries++; let s; try{ s=await this.api('/api/mineru?action=agent_status&task_id='+encodeURIComponent(task_id)); }catch(e){ this.mlog('查询出错（重试）：'+e.message); continue; } const st=String(s.state||'unknown'); M.prog='解析中：'+st; if(M.pct<86)M.pct+=2; if(st==='done'){ mdUrl=s.markdown_url; this.mlog('③ 解析完成'); break; } if(st==='failed'){ throw new Error('解析失败：'+(s.err||'未知')); } if(tries%4===0)this.mlog('仍在解析…（'+st+'，已等 '+(tries*3)+'s）'); } if(!mdUrl)throw new Error('解析超时'); M.prog='取回 Markdown…'; M.pct=90; this.mlog('④ 取回 Markdown…'); const md0=await this.api('/api/mineru?action=agent_md&md_url='+encodeURIComponent(mdUrl)); let md=String(md0.text||''); md=md.replace(/!\[([^\]]*)\]\((?!https?:|data:)[^)]*\)/g,(m,a)=>a?('*（图：'+a+'）*'):'*（图略）*'); md=this.stripMineruJunk(md); if(!md)throw new Error('Markdown 内容为空'); this.mlog('⑤ 得到 '+md.length+' 字，整理并导入…'); const subj=this.guessSubject(book)||this.ingest.subject; this.ingest.subject=subj; M.prog='导入 Books…'; M.pct=95; const n=await this.importMarkdownAsBook(md, book, subj, 'MinerU'); M.pct=100; M.prog='完成'; this.mlog('✓ 已导入 '+n+' 段到《'+book+'》（科目：'+this.subjName(subj)+'）'); this.flash('MinerU（轻量）完成，已导入 '+n+' 段到 Books'); this.mineruTokenOk(); this._mineruClearJob(); this.loadMaterials(); }catch(e){ this.mineruFail(e); } M.busy=false; },
    async mineruRunPreciseRange(f, book, subj, rangeStr, pageOffset, M){ this.mlog('① 申请上传地址（vlm'+(rangeStr?('，页码 '+rangeStr):'，整本')+'）…'); const d1=await this.api('/api/mineru?action=get_upload_url',{method:'POST',body:JSON.stringify({filename:f.name,language:'ch',is_ocr:true,model_version:'vlm',page_ranges:rangeStr||undefined})}); const batch_id=d1.batch_id, upload_url=d1.upload_url; if(!upload_url||!batch_id)throw new Error('未拿到上传地址'); this.mlog('已获取，batch_id='+batch_id); const buf=await f.arrayBuffer(); this.mlog('② 上传（经后端代理，绕过跨域）…'); await this.mineruUpload(upload_url, buf); this.mlog('上传完成，开始解析（云端处理，通常数分钟）'); this._mineruSaveJob({kind:'precise',batch_id,book,subj,offset:pageOffset,range:rangeStr||''}); let zipUrl='',tries=0; while(tries<180){ await this.sleep(4000); tries++; let s; try{ s=await this.api('/api/mineru?action=status&batch_id='+encodeURIComponent(batch_id)); }catch(e){ this.mlog('查询出错（重试）：'+e.message); continue; } const st=String(s.state||'unknown'); const ep=s.progress||{}; const ptxt=ep.extracted_pages!=null?('，'+ep.extracted_pages+'/'+(ep.total_pages||'?')+' 页'):''; M.prog='解析中：'+st+ptxt; if(st==='done'||st==='success'){ zipUrl=s.zip_url; this.mlog('③ 解析完成'); break; } if(st==='failed'||st==='error')throw new Error('MinerU 解析失败：'+(s.err||'未知')); if(tries%5===0)this.mlog('仍在解析…（'+st+ptxt+'，已等 '+(tries*4)+'s）'); } if(!zipUrl)throw new Error('解析超时（12 分钟）。可稍后重试'); this.mlog('④ 下载结果 ZIP…'); const zres=await fetch('/api/mineru?action=download&zip_url='+encodeURIComponent(zipUrl),{headers:{authorization:'Bearer '+this.token}}); if(!zres.ok)throw new Error('下载结果失败 HTTP '+zres.status); const zbuf=await zres.arrayBuffer(); await this.ensureJSZip(); const zip=await window.JSZip.loadAsync(zbuf); let pages=null; try{ pages=await this.mineruBuildPagesFromZip(zip); }catch(e){ this.mlog('content_list 解析失败，回退 full.md：'+e.message); } if(pages&&pages.length){ this.mlog('⑤ 按真实页还原 '+pages.length+' 页（含图片），导入…'); return await this.importPagesAsBook(pages, book, subj, 'MinerU', pageOffset); } const names=Object.keys(zip.files); let mdName=names.find(n=>/full\.md$/i.test(n))||names.find(n=>/\.md$/i.test(n)); if(!mdName)throw new Error('结果 ZIP 里没有 Markdown 文件'); let md=await zip.files[mdName].async('string'); md=await this.embedZipImages(md, zip); md=this.stripMineruJunk(md); if(!md)throw new Error('Markdown 内容为空'); this.mlog('⑤ full.md '+md.length+' 字（已嵌图），导入…'); return await this.importMarkdownAsBook(md, book, subj, 'MinerU', pageOffset); },
    async mineruConvertPrecise(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } const f=this._mineruFile; if(!f){ this.flash('请先选择 PDF',true); return; } const book=(this.ingest.bookTitle||'').trim()||f.name.replace(/\.[Pp][Dd][Ff]$/,''); const M=this.ingest.mineru; const pr=(M.pageRange||'').trim(); M.busy=true; M.log=[]; M.pct=3; M.prog='准备…'; try{ const subj=this.guessSubject(book)||this.ingest.subject; this.ingest.subject=subj; let ranges=[]; let submitPages=0; if(pr){ const mm=pr.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/); ranges=[{range:pr, offset:mm?(parseInt(mm[1])-1):0}]; submitPages=this._rangePages(pr); } else { let total=0; try{ await this.ensurePdfjs(); const b=await f.arrayBuffer(); const doc=await window.pdfjsLib.getDocument({data:b}).promise; total=doc.numPages; if(doc.destroy)doc.destroy(); }catch(_){} if(total>200){ this.mlog('共 '+total+' 页 > 单次 200 页上限，自动分段：'); for(let s=1;s<=total;s+=200){ const e=Math.min(total,s+199); ranges.push({range:s+'-'+e, offset:s-1}); this.mlog('  · '+s+'-'+e); } } else { ranges=[{range:'', offset:0}]; } submitPages=total; } if(!this.mineruCheckQuota(submitPages, ranges.length)){ M.busy=false; M.prog=''; this.mlog('已取消：将超出每日上限'); return; } this.mineruAddUsage(submitPages, ranges.length); let totalN=0; for(let r=0;r<ranges.length;r++){ const rg=ranges[r]; if(ranges.length>1)this.mlog('—— 第 '+(r+1)+'/'+ranges.length+' 段（'+rg.range+'）——'); M.prog='处理第 '+(r+1)+'/'+ranges.length+' 段…'; M.pct=4+Math.round(r/ranges.length*90); const n=await this.mineruRunPreciseRange(f, book, subj, rg.range, rg.offset, M); totalN+=n; this.mlog('本段导入 '+n+' 页，累计 '+totalN+' 页'); } M.pct=100; M.prog='完成'; this.mlog('✓ 全部完成，共导入 '+totalN+' 页到《'+book+'》（科目：'+this.subjName(subj)+'）'); this.flash('MinerU 完成，共导入 '+totalN+' 页到 Books'); this.mineruTokenOk(); this._mineruClearJob(); this.loadMaterials(); }catch(e){ this.mineruFail(e); } M.busy=false; },
    async relayOcrCanvas(cv){ const dataUrl=cv.toDataURL('image/jpeg',0.9); const body={image_b64:dataUrl}; if((this.ocrCfg.model||'').trim())body.model=this.ocrCfg.model.trim(); if((this.ocrCfg.base||'').trim())body.base_url=this.ocrCfg.base.trim(); if((this.ocrCfg.key||'').trim())body.api_key=this.ocrCfg.key.trim(); const res=await fetch('/api/visionocr',{method:'POST',headers:{'authorization':'Bearer '+this.token,'content-type':'application/json'},body:JSON.stringify(body)}); const ct=res.headers.get('content-type')||''; let d=null; if(ct.includes('json')){ try{ d=await res.json(); }catch(_){} } if(res.status===401){ this.token=''; localStorage.removeItem('zb_token'); this.view='settings'; throw new Error('unauth'); } if(res.status===404 || !ct.includes('json')){ const e=new Error('中转站 OCR 接口不可用：请确认已部署 functions/api/visionocr.js 并重新部署。'); e.fatal=true; throw e; } if(!res.ok){ const e=new Error((d&&d.error)||('中转站失败 HTTP '+res.status)); if(/未配置/.test(e.message))e.fatal=true; throw e; } const text=String((d&&d.text)||'').trim(); if(!text){ throw new Error('模型返回空内容'+((d&&d.finish)?'（finish: '+d.finish+'）':'')+'：该模型可能不支持图片输入或被内容过滤，换个真正支持看图的模型再试'); } return text; },
    pdfShelfBySubject(){ const g={math:[],computer:[],politics:[],english:[],other:[]}; for(const it of (this.pdfShelf.items||[])){ (g[it.subject]||g.other).push(it); } return g; },
    async loadPdfShelf(){ if(!this.token)return; this.pdfShelf.loading=true; this.pdfShelf.note=''; try{ const res=await fetch('/api/pdfs',{headers:{'authorization':'Bearer '+this.token}}); const ct=res.headers.get('content-type')||''; if(res.status===404 || !ct.includes('json')){ this.pdfShelf.cloudReady=false; this.pdfShelf.note='云端未就绪：检测不到 /api/pdfs 接口。请确认已把 functions/api/pdfs.js 提交并重新部署。'; } else { const d=await res.json().catch(()=>null); if(!res.ok){ this.pdfShelf.cloudReady=false; this.pdfShelf.note=(d&&d.error)||('云端不可用（HTTP '+res.status+'）'); } else { this.pdfShelf.items=d.items||[]; this.pdfShelf.cloudReady=true; } } }catch(e){ this.pdfShelf.cloudReady=false; this.pdfShelf.note='云端连接失败：'+e.message; } this.pdfShelf.loading=false; },
    async uploadPdf(e){ const f=e.target.files&&e.target.files[0]; if(!f)return; e.target.value=''; if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } const mb=f.size/1048576; if(mb>95 && !confirm('文件 '+mb.toFixed(1)+'MB，可能超出上传上限（约 100MB）。仍要上传？\n超大书建议改用「本地打开」或先拆分。')) return; const title=(this.ingest.bookTitle||'').trim()||f.name.replace(/\.pdf$/i,''); const subject=this.guessSubject(f.name)||this.ingest.subject||'computer'; this.pdfShelf.uploading=true; this.pdfShelf.pct=0; this.pdfShelf.note=''; this.pdfShelf.prog='读取文件 '+f.name+'（'+mb.toFixed(1)+'MB）…'; try{ const buf=await f.arrayBuffer(); await new Promise((resolve,reject)=>{ const xhr=new XMLHttpRequest(); xhr.open('PUT','/api/pdfs?title='+encodeURIComponent(title)+'&subject='+encodeURIComponent(subject)); xhr.setRequestHeader('authorization','Bearer '+this.token); xhr.setRequestHeader('content-type','application/pdf'); xhr.upload.onprogress=(ev)=>{ if(ev.lengthComputable){ this.pdfShelf.pct=Math.round(ev.loaded/ev.total*100); this.pdfShelf.prog='上传中 '+(ev.loaded/1048576).toFixed(1)+' / '+mb.toFixed(1)+' MB'; } }; xhr.onload=()=>{ const ct=xhr.getResponseHeader('content-type')||''; let d=null; if(ct.includes('json')){ try{ d=JSON.parse(xhr.responseText); }catch(_){} } if(xhr.status===401){ this.token=''; localStorage.removeItem('zb_token'); this.view='settings'; reject(new Error('访问码无效')); return; } if(xhr.status===404 || !ct.includes('json')){ reject(new Error('上传接口不可用：请确认已部署 functions/api/pdfs.js，并在绑定 R2（PDF_BUCKET）后【重新部署一次】。')); return; } if(xhr.status<200||xhr.status>=300){ reject(new Error((d&&d.error)||('上传失败 HTTP '+xhr.status))); return; } this.pdfShelf.pct=100; resolve(d); }; xhr.onerror=()=>reject(new Error('网络错误，上传中断')); xhr.send(buf); }); this.flash('已上传《'+title+'》到云端'); await this.loadPdfShelf(); }catch(err){ this.pdfShelf.note=err.message; this.flash(err.message,true); } this.pdfShelf.uploading=false; this.pdfShelf.prog=''; this.pdfShelf.pct=0; },
    _pdfCacheDB(){ return new Promise((res,rej)=>{ try{ const r=indexedDB.open('zb_pdfcache',1); r.onupgradeneeded=()=>{ const db=r.result; if(!db.objectStoreNames.contains('pdfs'))db.createObjectStore('pdfs'); }; r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); }catch(e){ rej(e); } }); },
    async _pdfCacheGet(id){ try{ const db=await this._pdfCacheDB(); return await new Promise((res)=>{ const tx=db.transaction('pdfs','readonly').objectStore('pdfs').get(id); tx.onsuccess=()=>res(tx.result||null); tx.onerror=()=>res(null); }); }catch(_){ return null; } },
    async _pdfCachePut(id,buf){ try{ const db=await this._pdfCacheDB(); await new Promise((res)=>{ const tx=db.transaction('pdfs','readwrite').objectStore('pdfs').put(buf,id); tx.onsuccess=()=>res(); tx.onerror=()=>res(); }); }catch(_){} },
    async openShelfPdf(it){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } this.pdfv.loading=true; this.pdfv.msg='检查缓存…';
      try{
        const cached=await this._pdfCacheGet(it.id);
        if(cached){ this.pdfv.msg='从缓存加载…'; await this.pdfvOpenSrc(cached.slice(0), it.title); return; }
        this.pdfv.msg='连接中…'; const res=await fetch('/api/pdfs?id='+encodeURIComponent(it.id),{headers:{'authorization':'Bearer '+this.token}}); if(!res.ok)throw new Error('下载失败 '+res.status); const total=parseInt(res.headers.get('content-length')||it.size||'0',10)||0; let buf; if(res.body&&res.body.getReader){ const reader=res.body.getReader(); const chunks=[]; let got=0; while(true){ const {done,value}=await reader.read(); if(done)break; chunks.push(value); got+=value.length; this.pdfv.msg='下载中 '+(total?Math.round(got/total*100)+'%':((got/1048576).toFixed(1)+'MB'))+'（'+(got/1048576).toFixed(1)+'/'+(total?(total/1048576).toFixed(1):'?')+'MB）'; } const all=new Uint8Array(got); let off=0; for(const c of chunks){ all.set(c,off); off+=c.length; } buf=all.buffer; } else { buf=await res.arrayBuffer(); }
        this._pdfCachePut(it.id, buf.slice(0));
        this.pdfv.msg='解析中…'; await this.pdfvOpenSrc(buf, it.title);
      }catch(e){ this.pdfv.loading=false; this.pdfv.msg=''; this.flash('打开失败：'+e.message,true); } },
    async deleteShelfPdf(it){ if(!confirm('确定删除云端 PDF《'+it.title+'》？此操作不可恢复。')) return; try{ await this.api('/api/pdfs?id='+encodeURIComponent(it.id),{method:'DELETE'}); try{ const db=await this._pdfCacheDB(); db.transaction('pdfs','readwrite').objectStore('pdfs').delete(it.id); }catch(_){} this.flash('已删除《'+it.title+'》'); if(this.pdfv.title===it.title)this.pdfvClose(); await this.loadPdfShelf(); }catch(e){ if(e.message!=='unauth')this.flash('删除失败：'+e.message,true); } },
    async pdfExtractText(){ if(!this._pdfDoc){ this.flash('请先选择 PDF',true); return; } if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      const doc=this._pdfDoc; this.ingest.pdf.busy=true; this.ingest.pdf.done=0; this.ingest.result=null;
      try{ let text='';
        for(let p=1;p<=doc.numPages;p++){ this.ingest.pdf.prog='正在提取文本，第 '+p+'/'+doc.numPages+' 页'; const page=await doc.getPage(p); const tc=await page.getTextContent(); text+=tc.items.map(it=>it.str).join(' ')+'\n'; }
        const chunks=this.chunkText(text);
        if(!chunks.length){ this.flash('未找到文本——可能是扫描版 PDF。请改用拍照辅助或手动录入',true); this.ingest.pdf.busy=false; this.ingest.pdf.prog=''; return; }
        this.ingest.pdf.extracted=text.trim(); this.ingest.raw=text.trim(); this.ingest.pdf.prog=''; this.flash('已在本地提取文本——请复制有用内容到手动录入或 JSON'); this.ingest.pdf.busy=false; return;
        let total=0;
        for(let i=0;i<chunks.length;i++){ this.ingest.pdf.prog='正在结构化第 '+(i+1)+'/'+chunks.length+' 段（已导入 '+total+'）';
          try{ const d=await this.api('/api/process',{method:'POST',body:JSON.stringify({subject:this.ingest.subject,chapter:this.ingest.chapter,source:this.currentSource(),raw_text:chunks[i]})}); total+=d.inserted||0; this.ingest.pdf.done=total; }
          catch(e){ if(e.message==='unauth'){ this.ingest.pdf.busy=false; return; } } }
        this.ingest.result={inserted:total,sample:[]}; this.ingest.pdf.prog=''; this.flash('PDF 文本处理完成，已导入 '+total+' 题'); this.loadMeta(true); this.statsDirty=true;
      }catch(e){ this.flash('Failed: '+e.message,true); }
      this.ingest.pdf.busy=false; },
    async pdfByImages(){ if(!this._pdfDoc){ this.flash('请先选择 PDF',true); return; } if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      const doc=this._pdfDoc; const st=Math.max(1, parseInt(this.ingest.pdf.start||1,10)||1); const ed=Math.min(doc.numPages, parseInt(this.ingest.pdf.end||st,10)||st);
      if(ed<st){ this.flash('结束页不能小于开始页',true); return; }
      if(ed-st+1>20 && !confirm('一次将识别 '+(ed-st+1)+' 页，可能消耗较多 AI 额度。确定继续？')) return;
      this.ingest.pdf.busy=true; this.ingest.pdf.done=0; this.ingest.pdf.total=ed-st+1; this.ingest.pdf.inserted=0; this.ingest.result=null;
      try{ await this.loadConfig(); let total=0; let mats=0; const samples=[];
        for(let p=st;p<=ed;p++){ this.ingest.pdf.prog='模型：'+this.ocrModelName+' · 第 '+(p-st+1)+'/'+(ed-st+1)+' 页 · 已导入 '+total+' 题';
          const page=await doc.getPage(p); const scale=Number(this.ingest.pdf.scale)||1.7; const vp=page.getViewport({scale}); const cv=document.createElement('canvas'); cv.width=Math.floor(vp.width); cv.height=Math.floor(vp.height); await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise; const dataUrl=cv.toDataURL('image/jpeg',Number(this.ingest.pdf.quality)||0.72);
          const d=await this.api('/api/process',{method:'POST',body:JSON.stringify({subject:this.ingest.subject,chapter:this.ingest.chapter,source:this.sourceForPage(p),kind:this.ingest.kind,images:[dataUrl]})}); total+=(d.inserted_questions??d.inserted)||0; mats+=d.inserted_materials||0; this.ingest.pdf.inserted=total; this.ingest.pdf.done=(p-st+1); if(d.sample) samples.push(...d.sample);
        }
        this.ingest.result={inserted:total,inserted_questions:total,inserted_materials:mats,sample:samples.slice(0,8)}; this.ingest.pdf.prog=''; this.flash('AI OCR 处理完成，已导入 '+total+' 题'+(mats?('、'+mats+' 段教材'):'')); this.loadMeta(true); this.statsDirty=true; this.loadMaterials();
      }catch(e){ if(e.message!=='unauth')this.flash('OCR 导入失败：'+e.message,true); }
      this.ingest.pdf.busy=false; },
    async loadStats(){ if(!this.token)return; this.statsLoading=true; try{ this.stats=await this.api('/api/progress'); this.statsDirty=false; }catch(e){ if(e.message!=='unauth')this.flash(e.message,true); } this.statsLoading=false; },
    rate(r){ const t=(r.right_sum||0)+(r.wrong_sum||0); return t?Math.round((r.right_sum||0)/t*100):0; },
    async startMock(){ if(!this.token)return; this.mock.finished=false; this.mock.answers={}; this.loading=true;
      const limit=this.mock.objectiveOnly?Math.min(200,(this.mock.count||20)*3):(this.mock.count||20);
      const p=new URLSearchParams({ order:'random', limit:String(limit), mode:'all' });
      if(this.mock.subject!=='all') p.set('subject',this.mock.subject);
      try{ const d=await this.api('/api/questions?'+p.toString()); let qs=d.items;
        if(this.mock.objectiveOnly) qs=qs.filter(q=>AUTO.includes(q.type));
        qs=qs.slice(0,this.mock.count||20);
        if(!qs.length){ this.flash('该科目题目不足，请先导入一些题目',true); this.loading=false; return; }
        this.mock.questions=qs; this.mock.started=true; this.mock.elapsed=0; this.mock.remaining=(this.mock.minutes||60)*60;
        clearInterval(this.mock.timer);
        this.mock.timer=setInterval(()=>{ this.mock.remaining--; this.mock.elapsed++; if(this.mock.remaining<=0)this.submitMock(); },1000);
        window.scrollTo({top:0});
      }catch(e){ if(e.message!=='unauth')this.flash(e.message,true); }
      this.loading=false;
    },
    async submitMock(){ clearInterval(this.mock.timer); this.mock.finished=true; this.mock.started=false; await this.$nextTick();
      const cards=this.$refs.mockCards||[]; const ans={};
      for(const c of cards){ ans[c.q.id]= c.graded?c.finalCorrect:null; } this.mock.answers=ans;
      let correct=0;
      for(const c of cards){ if(c.graded){ if(c.finalCorrect)correct++; try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'answer',question_id:c.q.id,is_correct:c.finalCorrect})}); }catch(e){} } }
      try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'mock',subject:this.mock.subject,total:this.mock.questions.length,correct,duration_seconds:this.mock.elapsed})}); }catch(e){}
      window.scrollTo({top:0,behavior:'smooth'});
    },
    async onMockAnswer(p){ this.mock.answers[p.id]=p.correct; try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'answer',question_id:p.id,is_correct:p.correct})}); }catch(e){} },
    quitMock(){ clearInterval(this.mock.timer); this.mock.started=false; this.mock.finished=false; this.mock.questions=[]; this.mock.answers={}; },
    fmtTime(s){ s=Math.max(0,s); const m=Math.floor(s/60),x=s%60; return String(m).padStart(2,'0')+':'+String(x).padStart(2,'0'); },
    stealthHide(){ this.stealth.hidden=true; },
    stealthShow(){ this.stealth.hidden=false; },
    onKey(e){ const tag=(e.target&&e.target.tagName)||'';
      if(this.stealth.hidden){ e.preventDefault(); this.stealth.hidden=false; return; }
      if(this.reader.open){ if(e.key==='Escape'){ if(this.reader.tocOpen){this.reader.tocOpen=false;return;} if(this.reader.panel){this.reader.panel=false;return;} this.readerClose(); return; } if(tag==='INPUT'||tag==='TEXTAREA')return; if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' '){ e.preventDefault(); this.readerNext(); return; } if(e.key==='ArrowLeft'||e.key==='PageUp'){ e.preventDefault(); this.readerPrev(); return; } return; }
      if(e.key==='`'||e.key==='~'){ if(tag==='INPUT'||tag==='TEXTAREA')return; e.preventDefault(); this.stealth.hidden=true; } },
    onBlur(){ if(this.stealth.autoHide) this.stealth.hidden=true; },
    onFocus(){ if(this.stealth.autoHide) this.stealth.hidden=false; },
  },
  mounted(){ document.documentElement.dataset.theme=this.theme; document.title=this.appName;
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focus', this.onFocus);
    try{ const oc=JSON.parse(localStorage.getItem('zb_ocrcfg')||'null'); if(oc&&typeof oc==='object'){ this.ocrCfg.model=oc.model||''; this.ocrCfg.base=oc.base||''; this.ocrCfg.key=oc.key||''; } }catch(_){}
    try{ const mc=JSON.parse(localStorage.getItem('zb_mineru_cfg')||'null'); if(mc&&typeof mc==='object'){ if(mc.pageLimit!=null)this.mineruCfg.pageLimit=mc.pageLimit; if(mc.fileLimit!=null)this.mineruCfg.fileLimit=mc.fileLimit; this.mineruCfg.tokenExp=mc.tokenExp||''; } }catch(_){}
    this.mineruRefreshUsage();
    try{ if(localStorage.getItem('zb_mineru_tokenbad')==='1')this.mineruTokenBad=true; }catch(_){}
    try{ this.bookTocOpen = (typeof window!=='undefined') ? window.innerWidth>860 : true; }catch(_){}
    if(this.token){ this.loadSubjects(); this.loadMeta(); this.loadConfig(); this.loadMaterials(); this.loadPdfShelf(); this.loadCfUsage(); this.startSession();
      try{ const bm=localStorage.getItem('zb_booksmode'); if(bm==='notes'||bm==='pdf')this.booksMode=bm; }catch(_){ }
      try{ const sb=localStorage.getItem('zb_bookid'); if(sb)this.currentBookId=sb; }catch(_){ }
      let startView=this._viewFromHash();
      if(!startView){ try{ const sv=localStorage.getItem('zb_view'); if(sv && sv!=='settings')startView=sv; }catch(_){ } }
      if(startView && startView!==this.view){ this.go(startView); } else { this._syncHash(this.view); }
      this.$nextTick(()=>this.mineruResume());
    } else { this.view='settings'; }
    window.addEventListener('hashchange', this.onHashChange);
    try{ this.offline = (typeof navigator!=='undefined' && navigator.onLine===false); }catch(_){ }
    window.addEventListener('online', this._onOnline);
    window.addEventListener('offline', this._onOffline);
    this._offQueueCount().then(n=>{ this.offlineQueued=n; if(n>0)this._offFlush(); }).catch(()=>{});
    this._loadOfflineSynced();
    // 开屏动画：等动画播完 + Vue 渲染完后淡出
    const sp=document.getElementById('splash'); if(sp){ const dismiss=()=>{ sp.classList.add('out'); setTimeout(()=>sp.remove(),600); }; const elapsed=performance.now(); const minTime=2000; if(elapsed>=minTime)dismiss(); else setTimeout(dismiss,minTime-elapsed); }
  },
  beforeUnmount(){ window.removeEventListener('keydown', this.onKey); window.removeEventListener('blur', this.onBlur); window.removeEventListener('focus', this.onFocus); window.removeEventListener('hashchange', this.onHashChange); window.removeEventListener('online', this._onOnline); window.removeEventListener('offline', this._onOffline); },
  template:`
  <div class="topbar"><div class="topbar-in">
    <div class="brand"><span class="dot"></span>{{ appName }}</div>
    <div class="spacer"></div>
    <button class="icon-btn" @click="stealthHide" title="快速隐藏（按 &#96; 切换）"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.4 5.2A9 9 0 0 1 21 12a9.4 9.4 0 0 1-1.3 1.9"/><path d="M6.1 6.1A9.4 9.4 0 0 0 3 12a9 9 0 0 0 11 6.6"/></svg></button>
    <button class="icon-btn" @click="theme=theme==='light'?'dark':'light'" :title="theme==='light'?'深色模式':'浅色模式'">{{ theme==='light'?'☾':'☀' }}</button>
  </div>
  <div class="tabs">
    <button class="tab" :class="{active:view==='practice'}" @click="go('practice')">Home</button>
    <button class="tab" :class="{active:view==='books'}" @click="view='books'">Books</button>
    <button class="tab" :class="{active:view==='wrong'}" @click="go('wrong')">Review<span v-if="wrongTotal" class="badge">{{ wrongTotal }}</span></button>
    <button class="tab" :class="{active:view==='favorite'}" @click="go('favorite')">Saved</button>
    <button class="tab" :class="{active:view==='mock'}" @click="view='mock'">Test</button>
    <button class="tab" :class="{active:view==='stats'}" @click="go('stats')">Reports</button>
    <button class="tab" :class="{active:view==='bank'}" @click="go('bank')">题库</button>
    <button class="tab" :class="{active:view==='ingest'}" @click="view='ingest'">Import</button>
    <button class="tab" :class="{active:view==='settings'}" @click="view='settings'">Settings</button>
  </div></div>

  <div v-if="offline" class="offline-bar">离线模式 · 显示已缓存内容，作答将在联网后自动同步<span v-if="offlineQueued>0">（待同步 {{ offlineQueued }} 条）</span></div>

  <div class="wrap">

    <div v-if="['practice','wrong','favorite'].includes(view)">
      <div class="toolbar">
        <div class="field"><label>科目</label>
          <select v-model="f.subject" @change="onFilter">
            <option value="all">全部科目</option>
            <option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option>
          </select></div>
        <div class="field"><label>章节</label>
          <select v-model="f.chapter" @change="onFilter">
            <option value="">全部章节</option>
            <option v-for="c in chaptersForSubject" :key="c.subject+'|'+c.chapter" :value="c.chapter">{{ c.chapter }} ({{ c.n }})</option>
          </select></div>
        <div class="field"><label>题型</label>
          <select v-model="f.type" @change="onFilter">
            <option value="">全部题型</option>
            <option v-for="t in types" :key="t.v" :value="t.v">{{ t.t }}</option>
          </select></div>
        <div class="field" v-if="view==='practice'"><label>范围</label>
          <select v-model="f._mode" @change="onFilter">
            <option value="all">全部题目</option>
            <option value="unseen">仅未做</option>
            <option value="wrong">仅错题</option>
            <option value="favorite">仅收藏</option>
          </select></div>
        <div class="field"><label>顺序</label>
          <select v-model="f.order" @change="onFilter">
            <option value="random">随机</option>
            <option value="seq">顺序</option>
          </select></div>
        <button class="btn subtle" @click="startSession" style="margin-left:auto">↻ 刷新</button>
      </div>

      <div v-if="loading" class="empty"><span class="spin"></span> 加载中…</div>
      <template v-else>
        <div v-if="cur">
          <div class="row" style="margin-bottom:12px;align-items:center;gap:10px"><span class="q-counter">第 {{ qi+1 }} / {{ queue.length }} 题</span>
            <span class="muted" v-if="view==='wrong'">· 复习（最不熟优先）</span>
            <span class="muted" v-if="view==='wrong' && queueTotal">· 待复习 {{ queueTotal }} 题</span>
            <span class="muted" v-if="view==='favorite'">· 收藏</span>
            <span v-if="curStatus" class="q-badge" :style="{color:curStatus.c,borderColor:curStatus.c}">{{ curStatus.t }}</span>
            <span v-if="view==='practice' && queueTotal" class="muted">· {{ f._mode==='unseen'?'未做剩 '+queueTotal:'本范围共 '+queueTotal }} 题</span>
            <span v-if="streak>=2" style="color:var(--accent);font-weight:600;font-size:13px">🔥 连对 {{ streak }}</span>
            <select class="bk-mini" style="margin-left:auto" :value="cur.subject" @change="setQuestionSubject($event.target.value)" title="改本题科目（纠正分类）"><option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option></select>
            <button class="bk-del" @click="deleteCurrentQuestion" title="从题库删除本题">删除本题</button>
          </div>
          <question-card :q="cur" :key="cur.id" @answered="onAnswered" @favorite="onFav" @master="onMaster" @note="onNote" @next="next" />
          <div class="q-nav-bar">
            <button class="btn subtle" :disabled="qi<=0" @click="prev">← 上一题</button>
            <button class="btn" @click="next">{{ qi>=queue.length-1 ? '换一批 ↻' : '下一题 →' }}</button>
          </div>
          <div v-if="queue.length>1" class="qnav-wrap">
            <button class="qnav-toggle" @click="qnavOpen=!qnavOpen">
              <span>答题卡 · 已答 {{ sessionDone }}/{{ queue.length }}</span>
              <span class="qnav-legend" v-if="qnavOpen"><i class="ok"></i>对<i class="bad"></i>错/待复习<i class="done"></i>做过<i class="un"></i>未做</span>
              <span class="qnav-caret">{{ qnavOpen?'收起 ▴':'展开 ▾' }}</span>
            </button>
            <div v-if="qnavOpen" class="qnav">
              <button v-for="(q,i) in queue" :key="q.id" class="qnav-dot" :class="qnavCls(q,i)" @click="qi=i" :title="'第'+(i+1)+'题'">{{ i+1 }}</button>
            </div>
          </div>
        </div>
        <div v-else class="empty">
          <template v-if="view==='practice' && f._mode==='unseen'">
            <div class="big">🎉</div>
            <p>太棒了！{{ f.subject==='all'?'全部':subjName(f.subject) }}{{ f.chapter?('· '+f.chapter):'' }} 的题都做过一遍了。</p>
            <svg v-if="stats" class="acc-ring" viewBox="0 0 120 120" width="132" height="132">
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--surface-2)" stroke-width="12"/>
              <circle cx="60" cy="60" r="52" fill="none" :stroke="accPct>=60?'var(--ok)':'var(--bad)'" stroke-width="12" stroke-linecap="round" :stroke-dasharray="ringDash" transform="rotate(-90 60 60)"/>
              <text x="60" y="56" text-anchor="middle" font-size="27" font-weight="700" fill="var(--ink)">{{ accPct }}%</text>
              <text x="60" y="77" text-anchor="middle" font-size="12" fill="var(--ink-soft)">正确率</text>
            </svg>
            <p class="muted" v-if="stats">已作答 {{ statTotals.seen }} / {{ statTotals.totalQ }} · 待复习 {{ statTotals.wrongOpen }} · 已掌握 {{ statTotals.mastered }}</p>
            <p class="muted">本次用时 {{ sessionElapsed }} · 最高连对 {{ bestStreak }}</p>
            <div class="row" style="justify-content:center;margin-top:16px;gap:8px;flex-wrap:wrap">
              <button class="btn" v-if="statTotals.wrongOpen" @click="go('wrong')">复习错题（{{ statTotals.wrongOpen }}）</button>
              <button class="btn subtle" @click="f._mode='all'; startSession()">重做全部</button>
              <button class="btn subtle" @click="go('stats')">查看统计</button>
            </div>
          </template>
          <template v-else-if="view==='wrong'">
            <div class="big">✓</div><p>暂无错题，做得不错。</p>
            <div class="row" style="justify-content:center;margin-top:14px"><button class="btn" @click="go('practice')">去刷题</button></div>
          </template>
          <template v-else-if="view==='favorite'">
            <div class="big">☆</div><p>暂无收藏题。刷题时点题目上的 ★ 可收藏。</p>
            <div class="row" style="justify-content:center;margin-top:14px"><button class="btn" @click="go('practice')">去刷题</button></div>
          </template>
          <template v-else-if="f._mode==='mastered'">
            <div class="big">∅</div><p>还没有标记为「已掌握」的题。</p>
            <div class="row" style="justify-content:center;margin-top:14px"><button class="btn subtle" @click="f._mode='all'; startSession()">看全部题</button></div>
          </template>
          <template v-else>
            <div class="big">∅</div><p>没有匹配的题目。请调整筛选条件，或先导入题目。</p>
            <div class="row" style="justify-content:center;margin-top:14px">
              <button class="btn subtle" @click="startSession">重新加载</button>
              <button class="btn" @click="view='ingest'">前往导入</button>
            </div>
          </template>
        </div>
      </template>
    </div>


    <div v-else-if="view==='books'">
      <h2 style="margin:.2em 0 .5em">教材阅读</h2>
      <div class="seg" style="margin-bottom:16px">
        <button :class="{on:booksMode==='notes'}" @click="booksMode='notes'">整理笔记</button>
        <button :class="{on:booksMode==='pdf'}" @click="booksMode='pdf'">PDF 原书</button>
      </div>
      <div v-show="booksMode==='pdf'">
        <p class="muted" style="margin-bottom:14px">选一个 PDF 在浏览器里直接渲染原版页面（公式/图表/排版原样，不转换）。「本地打开」仅本次有效；「上传到云端」会存到 R2，之后任何设备都能打开。</p>
        <div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:14px">
          <label class="btn subtle" style="cursor:pointer">本地打开（仅本次）<input type="file" accept="application/pdf,.pdf" @change="pdfvOpenLocal" style="display:none" /></label>
          <label class="btn" style="cursor:pointer"><span v-if="pdfShelf.uploading" class="spin"></span>上传 PDF 到云端<input type="file" accept="application/pdf,.pdf" :disabled="pdfShelf.uploading" @change="uploadPdf" style="display:none" /></label>
          <span v-if="pdfv.loading" class="muted"><span class="spin"></span> {{ pdfv.msg || '正在打开 PDF…' }}</span>
          <span v-else-if="pdfShelf.loading" class="muted"><span class="spin"></span> 正在加载 PDF 列表…</span>
        </div>
        <div v-if="pdfShelf.uploading" style="margin:0 0 14px;max-width:520px">
          <div class="muted" style="font-size:13px;margin-bottom:6px">{{ pdfShelf.prog }} <span v-if="pdfShelf.pct">· {{ pdfShelf.pct }}%</span></div>
          <div style="height:9px;background:var(--surface-2);border-radius:99px;overflow:hidden;border:1px solid var(--line)"><div :style="{width:pdfShelf.pct+'%',height:'100%',background:'var(--accent)',transition:'width .2s'}"></div></div>
        </div>
        <div v-if="pdfShelf.note" class="hint" style="border:1px solid color-mix(in srgb,#c0392b 35%,var(--line));background:color-mix(in srgb,#c0392b 6%,var(--surface));margin-bottom:14px">{{ pdfShelf.note }}</div>
        <template v-if="pdfShelf.items.length">
          <template v-for="(list,sub) in pdfShelfBySubject()" :key="sub">
            <div v-if="list.length" class="bk-shelf">
              <div class="bk-shelf-label fold-head" @click="bookFold['pdf_'+sub]=!bookFold['pdf_'+sub]"><span>{{ subjName(sub)==='other'? '其他' : subjName(sub) }} <span class="muted" style="font-weight:400;font-size:12px">{{ list.length }} 本</span></span><span class="fold-arrow" :class="{open:!bookFold['pdf_'+sub]}">▾</span></div>
              <div v-show="!bookFold['pdf_'+sub]" class="bk-grid">
                <div v-for="it in list" :key="it.id" class="bk-card" @click="openShelfPdf(it)">
                  <span class="spine"></span>
                  <span class="t">{{ it.title }}</span>
                  <span class="m">{{ (it.size/1048576).toFixed(1) }} MB · 云端 · <a href="#" style="color:#c0392b" @click.stop.prevent="deleteShelfPdf(it)">删除</a></span>
                </div>
              </div>
            </div>
          </template>
        </template>
        <div v-if="!pdfv.open && !pdfv.loading" class="empty"><p>选择一个 PDF 直接在线阅读。适合公式、图表多、不想被 OCR 弄花的教材。<br>提示：PDF 仅在本次打开期间保留；想长期保存请用「整理笔记」导入，或把 PDF 放进部署的 public/。</p></div>
      </div>
      <div v-show="booksMode==='notes'">
      <template v-if="!materials.loaded">
        <div class="bk-loading" style="min-height:200px"><span class="bk-loadbar"></span><span class="muted" style="margin-top:10px">正在加载教材… {{ loadProgMsg }}</span></div>
      </template>
      <template v-else-if="!materialBooks.length">
        <div class="empty">
          <p>还没有教材资料。去「导入」粘贴教材正文或上传教材 PDF，整理好的知识点会显示在这里。</p>
          <button class="btn" @click="view='ingest'">去导入教材</button>
        </div>
      </template>
      <template v-else>
        <template v-for="(list,sub) in booksBySubject" :key="sub">
          <div v-if="list.length" class="bk-shelf">
            <div class="bk-shelf-label fold-head" @click="bookFold[sub]=!bookFold[sub]"><span>{{ subjName(sub)==='other'? '其他' : subjName(sub) }} <span class="muted" style="font-weight:400;font-size:12px">{{ list.length }} 本</span></span><span class="fold-arrow" :class="{open:!bookFold[sub]}">▾</span></div>
            <div v-show="!bookFold[sub]" class="bk-grid">
              <button v-for="b in list" :key="b.key" class="bk-card" :class="{on:currentBookId===b.key}" @click="currentBookId=b.key">
                <span class="spine"></span>
                <span class="t">{{ b.title }}</span>
                <span class="m">{{ b.pages.length }} 页</span>
              </button>
            </div>
          </div>
        </template>
        <div v-if="currentBook && currentPageMat" class="bk-reader" :class="{'toc-collapsed':!bookTocOpen,'toc-open':bookTocOpen}">
          <aside class="bk-toc">
            <h4>目录 <span class="muted">{{ currentBook.pages.length }} 篇</span><button class="toc-close" @click="bookTocOpen=false" title="关闭">✕</button></h4>
            <div class="tip">按每页正文标题/首行生成，点击跳转</div>
            <div v-for="(m,i) in currentBook.pages" :key="m.id" class="bk-toc-item" :class="{on:i===bookIdx}" @click="bookGoto(i); bookTocOpen = (window.innerWidth>860)">{{ pageLabel(m) }}</div>
          </aside>
          <div class="bk-toc-backdrop" @click="bookTocOpen=false"></div>
          <div class="bk-page">
            <div class="bk-bar">
              <button class="bk-toctoggle" @click="bookTocOpen=!bookTocOpen" :title="bookTocOpen?'收起目录':'展开目录'">{{ bookTocOpen ? '⟨ 收起目录' : '☰ 目录' }}</button>
              <div style="flex:1;min-width:160px">
                <div class="ttl">{{ currentPageMat.title }}</div>
                <div class="sub">{{ subjName(currentPageMat.subject) }}<span v-if="currentPageMat.page"> · 第 {{ currentPageMat.page }} 页</span> · 本书第 {{ bookIdx+1 }} / {{ currentBook.pages.length }} 篇</div>
              </div>
              <div class="bk-nav">
                <button :disabled="bookIdx<=0" @click="bookPrev">← 上一页</button>
                <button :disabled="bookIdx>=currentBook.pages.length-1" @click="bookNext">下一页 →</button>
              </div>
              <button class="bk-toctoggle" @click="readerOpen" title="全屏沉浸阅读：可调字号、行距、主题，点两侧翻篇">📖 沉浸阅读</button>
              <input class="bk-jump inp" type="number" min="1" @keyup.enter="bookJumpPage($event.target.value)" placeholder="跳页" title="输入页码回车跳转" />
            </div>
            <div class="bk-body">
              <div v-if="pageRendering" class="bk-loading"><span class="bk-loadbar"></span><span class="muted" style="margin-top:10px">正在加载本页…</span></div>
              <template v-else>
                <div v-if="currentPageMat.summary" class="summary">{{ currentPageMat.summary }}</div>
                <img v-if="currentPageMat.page_image" :src="currentPageMat.page_image" style="max-width:100%;border-radius:12px;border:1px solid var(--line);margin-bottom:16px" />
                <rich-text :content="currentPageMat.content_md" />
                <div v-if="genq.result" class="ref" style="margin-top:20px">
                  <h5>已生成 {{ genq.result.inserted_questions ?? genq.result.inserted ?? 0 }} 道题（进题库 · {{ subjName(currentPageMat.subject) }}）</h5>
                  <div v-for="(s,i) in (genq.result.sample||[])" :key="i" class="muted">· [{{ typeMap[s.type]||s.type }}] {{ s.stem }}</div>
                </div>
              </template>
            </div>
            <div class="bk-foot">
              <div class="bk-nav">
                <button :disabled="bookIdx<=0" @click="bookPrev">← 上一页</button>
                <button :disabled="bookIdx>=currentBook.pages.length-1" @click="bookNext">下一页 →</button>
              </div>
              <select class="bk-mini" :value="currentPageMat.subject" @change="setBookSubject($event.target.value)" title="修改本书科目"><option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option></select>
              <button class="btn" :disabled="bookExtract.busy" @click="localExtractPage" title="用规则解析本页现成的习题+解答，直接入题库，不消耗 AI"><span v-if="bookExtract.busy" class="spin"></span>本页抽题入库（不花 AI）</button>
              <button class="btn subtle" :disabled="bookExtract.busy" @click="localExtractBook" title="把整本书的习题一次性抽进题库，不消耗 AI"><span v-if="bookExtract.busy" class="spin"></span>整本抽题入库</button>
              <button class="btn subtle" :disabled="genq.busy || !ai.hasAI" @click="genQuestionsFromMaterial" title="让 AI 依据本页内容出题（会消耗 AI 额度）"><span v-if="genq.busy" class="spin"></span>AI 出题</button>
              <span v-if="bookExtract.busy && bookExtract.prog" class="muted">{{ bookExtract.prog }}</span>
              <button class="bk-del" style="margin-left:auto" @click="deleteCurrentBook">删除本书</button>
            </div>
          </div>
        </div>
      </template>
      </div>
    </div>

    <div v-else-if="view==='mock'">
      <div v-if="!mock.started && !mock.finished">
        <h2 style="margin:.2em 0 .5em">模拟测试</h2>
        <p class="muted" style="margin-bottom:16px">限时测试。提交后自动判分；错题会进入复习。</p>
        <div class="toolbar">
          <div class="field"><label>科目</label>
            <select v-model="mock.subject">
              <option value="all">全部科目</option>
              <option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option>
            </select></div>
          <div class="field"><label>题数</label>
            <select v-model.number="mock.count"><option :value="10">10</option><option :value="20">20</option><option :value="30">30</option><option :value="50">50</option><option :value="100">100</option></select></div>
          <div class="field"><label>时间（分钟）</label>
            <select v-model.number="mock.minutes"><option :value="15">15</option><option :value="30">30</option><option :value="60">60</option><option :value="90">90</option><option :value="120">120</option></select></div>
        </div>
        <label class="row" style="margin:6px 0 18px;cursor:pointer"><input type="checkbox" v-model="mock.objectiveOnly" /> <span class="muted">仅自动判分题（单选 / 多选 / 判断）</span></label>
        <button class="btn" :disabled="loading" @click="startMock"><span v-if="loading" class="spin"></span>开始测试</button>
      </div>

      <template v-else>
        <div v-if="mock.started" class="mock-bar">
          <span class="timer" :class="{warn:mock.remaining<60}">{{ fmtTime(mock.remaining) }}</span>
          <span class="muted">{{ mock.questions.length }} 题 · {{ subjName(mock.subject==='all'?'':mock.subject)||'全部科目' }}</span>
          <div class="spacer" style="flex:1"></div>
          <button class="btn" @click="submitMock">提交</button>
        </div>

        <div v-if="mock.finished" class="card" style="text-align:center">
          <div class="stamp" :class="mockPct>=60?'ok':'bad'"><div><div class="s">{{ mockPct }}</div><div class="u">得分</div></div></div>
          <div style="font-weight:700;font-size:18px">得分 {{ mockResult.correct }} / {{ mockResult.total }}</div>
          <p class="muted" style="margin-top:6px">用时 {{ fmtTime(mock.elapsed) }}<span v-if="mockResult.graded<mockResult.total"> · 还有 {{ mockResult.total-mockResult.graded }} 道主观题需自评</span></p>
          <div class="row" style="justify-content:center;margin-top:14px">
            <button class="btn subtle" @click="quitMock">返回</button>
            <button class="btn" @click="startMock">重新测试</button>
          </div>
        </div>
        <h3 v-if="mock.finished" style="margin:22px 0 10px">复盘</h3>

        <div v-for="(q,i) in mock.questions" :key="q.id" style="margin-bottom:16px">
          <div class="q-counter" style="margin-bottom:6px">第 {{ i+1 }} 题
            <template v-if="mock.finished">·
              <span v-if="mock.answers[q.id]===true" style="color:var(--ok)">正确</span>
              <span v-else-if="mock.answers[q.id]===false" style="color:var(--bad)">错误</span>
              <span v-else class="muted">自评</span>
            </template>
          </div>
          <question-card ref="mockCards" :q="q" mode="exam" :exam-reveal="mock.finished" @answered="onMockAnswer" />
        </div>

        <button v-if="mock.started" class="btn" style="width:100%" @click="submitMock">提交</button>
      </template>
    </div>

    <div v-else-if="view==='bank'">
      <div class="filters">
        <div class="field"><label>科目</label>
          <select v-model="bank.subject" @change="loadBank(true)"><option value="">全部科目</option><option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option></select></div>
        <div class="field"><label>题型</label>
          <select v-model="bank.type" @change="loadBank(true)"><option value="">全部题型</option><option v-for="t in types" :key="t.v" :value="t.v">{{ t.t }}</option></select></div>
        <div class="field" style="flex:1;min-width:180px"><label>关键词</label>
          <input class="inp" v-model="bank.kw" @keyup.enter="loadBank(true)" placeholder="搜题干 / 章节，回车搜索" /></div>
        <button class="btn subtle" @click="loadBank(true)" style="align-self:flex-end">↻ 搜索</button>
      </div>

      <div class="bank-toolbar">
        <label class="bank-check"><input type="checkbox" :checked="bank.items.length && bank.items.every(q=>bank.sel.includes(q.id))" @change="bankAllOnPage" /> 全选本页</label>
        <span class="muted">已选 {{ bank.sel.length }} · 共 {{ bank.total }} 题(已加载 {{ bank.items.length }})</span>
        <button class="btn subtle" v-if="bank.items.length" @click="bankAutoClassify" title="按题干内容自动纠正科目（仅强特征命中）">🪄 智能归类(本页)</button>
        <button class="btn subtle" v-if="bank.total" @click="bankDedup" title="扫描整个题库，删除题干完全相同的重复题（每组保留一道）">🧹 清理重复</button>
        <template v-if="bank.sel.length">
          <select class="bk-mini" v-model="bank.batchSubject"><option value="">改科目为…</option><option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option></select>
          <button class="btn subtle" @click="bankBatchSubject">应用</button>
          <button class="bk-del" @click="bankBatchDelete">删除选中 ({{ bank.sel.length }})</button>
        </template>
      </div>

      <div v-if="bank.loading && !bank.items.length" class="empty"><span class="spin"></span> 加载中…</div>
      <div v-else-if="!bank.items.length" class="empty"><div class="big">∅</div><p>题库为空或没有匹配的题目。</p></div>
      <template v-else>
        <div v-for="(q,i) in bank.items" :key="q.id" class="bank-row" :class="{sel:bank.sel.includes(q.id)}">
          <input type="checkbox" class="bank-rowck" :checked="bank.sel.includes(q.id)" @change="bankToggle(q.id)" />
          <div class="bank-main">
            <div class="bank-meta"><span class="tag">{{ subjName(q.subject) }}</span><span class="tag2">{{ typeMap[q.type]||q.type }}</span><span v-if="q.mastered" class="q-badge" style="color:var(--ok);border-color:var(--ok)">已掌握</span><span v-else-if="q.wrong_count>0" class="q-badge" style="color:var(--bad);border-color:var(--bad)">错 {{ q.wrong_count }} 次</span><span v-else-if="q.right_count>0" class="q-badge" style="color:var(--ok);border-color:var(--ok)">已做对</span><span v-if="q.favorited" class="q-badge" style="color:var(--accent);border-color:var(--accent)">★ 收藏</span><span class="muted" style="font-size:12px">#{{ i+1 }}</span></div>
            <div class="bank-stem"><rich-text :content="q.stem || '（空题干）'" /></div>
            <div v-if="q.source || q.page" class="bank-src"><span class="bank-src-book" :title="q.source">📖 {{ srcBook(q.source) }}</span><span v-if="q.page" class="bank-src-pg">P{{ q.page }}</span></div>
          </div>
          <div class="bank-side">
            <button class="btn subtle xs" @click="bankOpenEdit(q)">编辑</button>
            <button class="bk-del xs" @click="bankDelete(q)">删除</button>
          </div>
        </div>
        <div class="row" style="justify-content:center;margin:16px 0" v-if="bank.items.length < bank.total">
          <button class="btn subtle" :disabled="bank.loading" @click="bankMore"><span v-if="bank.loading" class="spin"></span>加载更多（还有 {{ bank.total - bank.items.length }} 题）</button>
        </div>
      </template>

      <div v-if="bankEdit.open" class="modal-mask" @click.self="bankCloseEdit">
        <div class="modal">
          <div class="modal-h"><b>编辑题目</b><button class="toc-close" @click="bankCloseEdit">✕</button></div>
          <div class="modal-b">
            <div class="row" style="gap:10px;margin-bottom:10px">
              <div class="field" style="flex:1"><label>科目</label><select v-model="bankEdit.subject"><option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option></select></div>
              <div class="field" style="flex:1"><label>题型</label><select v-model="bankEdit.type"><option v-for="t in types" :key="t.v" :value="t.v">{{ t.t }}</option></select></div>
            </div>
            <label class="lbl">题干（支持 Markdown / LaTeX，行内公式用 $…$ 需成对）</label>
            <textarea class="inp" v-model="bankEdit.stem" rows="5"></textarea>
            <template v-if="isChoiceType(bankEdit.type) && bankEdit.type!=='true_false'">
              <label class="lbl" style="margin-top:10px">选项</label>
              <div v-for="(o,i) in bankEdit.options" :key="i" class="row" style="gap:8px;margin-bottom:6px">
                <input class="inp" style="width:54px;text-align:center" v-model="o.key" placeholder="A" />
                <input class="inp" style="flex:1" v-model="o.text" placeholder="选项内容" />
                <button class="btn subtle xs" @click="bankEditDelOpt(i)">删</button>
              </div>
              <button class="btn subtle xs" @click="bankEditAddOpt">+ 添加选项</button>
            </template>
            <label class="lbl" style="margin-top:10px">正确答案
              <span class="muted" style="font-weight:400">{{ bankEdit.type==='single_choice' ? '（填选项字母，如 C）' : bankEdit.type==='multiple_choice' ? '（多个字母用逗号，如 A,C）' : bankEdit.type==='true_false' ? '（填 T 或 F）' : bankEdit.type==='fill_blank' ? '（每空一行）' : '（参考答案文本）' }}</span>
            </label>
            <textarea class="inp" v-model="bankEdit.answerText" :rows="isChoiceType(bankEdit.type)?1:4" placeholder="答案"></textarea>
            <label class="lbl" style="margin-top:10px">解析（可选）</label>
            <textarea class="inp" v-model="bankEdit.analysis" rows="3"></textarea>
            <div class="prev-box"><div class="lbl">预览</div><rich-text :content="bankEdit.stem || '（空）'" /></div>
          </div>
          <div class="modal-f">
            <button class="btn subtle" @click="bankCloseEdit">取消</button>
            <button class="btn" :disabled="bankEdit.busy" @click="bankSaveEdit"><span v-if="bankEdit.busy" class="spin"></span>保存</button>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="view==='stats'">
      <div v-if="statsLoading" class="empty"><span class="spin"></span> 加载中…</div>
      <template v-else-if="stats">
        <div class="stat-grid">
          <div class="stat"><div class="n">{{ statTotals.totalQ }}</div><div class="l">题目总数</div></div>
          <div class="stat"><div class="n">{{ statTotals.seen }}</div><div class="l">已作答</div></div>
          <div class="stat"><div class="n" style="color:var(--bad)">{{ statTotals.wrongOpen }}</div><div class="l">待复习</div></div>
          <div class="stat"><div class="n" style="color:var(--ok)">{{ statTotals.mastered }}</div><div class="l">已掌握</div></div>
        </div>
        <div v-if="!statTotals.totalQ" class="empty"><p>暂无题目。请到导入页面添加题目。</p><button class="btn" @click="view='ingest'">前往导入</button></div>
        <template v-else>
          <h3 style="margin:6px 0 12px">按科目统计正确率</h3>
          <div v-for="r in stats.bySubject" :key="r.subject" class="subj-row">
            <div class="top"><span>{{ subjName(r.subject) }}</span><span class="muted">{{ rate(r) }}% · 正确 {{ r.right_sum||0 }} / 已答 {{ (r.right_sum||0)+(r.wrong_sum||0) }}</span></div>
            <div class="bar"><span :style="{width:rate(r)+'%', background: rate(r)>=60?'var(--ok)':'var(--bad)'}"></span></div>
            <div class="muted" style="margin-top:6px">总数 {{ r.total_q }} · 待复习 {{ r.wrong_open||0 }} · 收藏 {{ r.favorited||0 }}</div>
          </div>
          <template v-if="stats.mocks && stats.mocks.length">
            <h3 style="margin:22px 0 12px">近期测试</h3>
            <div v-for="(m,i) in stats.mocks" :key="i" class="subj-row">
              <div class="top"><span>{{ subjName(m.subject) }} · {{ m.correct }}/{{ m.total }}</span><span class="muted">{{ fmtTime(m.duration_seconds) }}</span></div>
              <div class="bar"><span :style="{width:(m.total?Math.round(m.correct/m.total*100):0)+'%', background:(m.total&&m.correct/m.total>=0.6)?'var(--ok)':'var(--bad)'}"></span></div>
            </div>
          </template>
        </template>
      </template>
      <div v-else class="empty"><span class="spin"></span> 加载中…</div>
    </div>

    <div v-else-if="view==='ingest'">
      <h2 style="margin:.2em 0 .5em">导入</h2>
      <div class="seg" style="margin-bottom:14px">
        <button :class="{on:ingest.tab==='manual'}" @click="ingest.tab='manual'">手动录入</button>
        <button :class="{on:ingest.tab==='photo'}" @click="ingest.tab='photo'">拍照辅助</button>
        <button :class="{on:ingest.tab==='json'}" @click="ingest.tab='json'">导入 JSON</button>
        <button :class="{on:ingest.tab==='pdf'}" @click="ingest.tab='pdf'">PDF 文本</button>
        <button :class="{on:ingest.tab==='md'}" @click="ingest.tab='md'">Markdown</button>
        <button :class="{on:ingest.tab==='mineru'}" @click="ingest.tab='mineru'">MinerU</button>
        <button :class="{on:ingest.tab==='ai'}" @click="ingest.tab='ai'">AI 整理</button>
      </div>
      <div class="toolbar">
        <div class="field" v-if="!['manual','json','md','mineru'].includes(ingest.tab)"><label>导入类型</label>
          <select v-model="ingest.kind"><option value="auto">自动分辨（题库 / 教材）</option><option value="questions">只当题库</option><option value="material">只当教材</option></select></div>
        <div class="field"><label>默认科目</label>
          <select v-model="ingest.subject"><option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option></select></div>
        <div class="field" v-if="['photo','pdf','ai','md','mineru'].includes(ingest.tab)"><label>教材名称（转教材时用作书名，按科目归类）</label><input class="inp" v-model="ingest.bookTitle" placeholder="如 谭浩强C程序设计（选 PDF/MD 会自动填）" /></div>
        <template v-if="!['json','md','mineru'].includes(ingest.tab)">
          <div class="field"><label>章节预设</label>
            <select v-model="ingest.chapter"><option value="">选择 / 下方自定义</option><option v-for="c in ingestChapterOptions" :key="c.chapter" :value="c.chapter">{{ c.chapter }} {{ c.n ? '('+c.n+')' : '' }}</option></select></div>
          <div class="field"><label>自定义章节</label><input class="inp" v-model="ingest.chapter" placeholder="例如：C语言-指针" /></div>
        </template>
        <template v-if="ingest.tab==='manual'">
          <div class="field"><label>书本 / 来源模式</label><label class="row" style="height:40px;cursor:pointer"><input type="checkbox" v-model="ingest.bookMode" /> <span class="muted">小红本自动来源</span></label></div>
          <template v-if="ingest.bookMode">
            <div class="field"><label>书名</label><input class="inp" v-model="ingest.bookName" placeholder="小红本" /></div>
            <div class="field"><label>页码</label><input class="inp" v-model="ingest.pageNo" placeholder="12" /></div>
            <div class="field"><label>题号</label><input class="inp" v-model="ingest.questionNo" placeholder="3" /></div>
          </template>
          <div class="field" v-else><label>来源</label><input class="inp" v-model="ingest.source" placeholder="例如：2023 真题" /></div>
        </template>
        <div class="field" v-else-if="['photo','ai'].includes(ingest.tab)"><label>来源（可选，作题目出处）</label><input class="inp" v-model="ingest.source" placeholder="例如：2023 真题" /></div>
      </div>
      <div class="hint" v-if="!['json','md','mineru'].includes(ingest.tab)">当前分类： <b>{{ subjName(ingest.subject) }}</b><span v-if="ingest.chapter"> · {{ ingest.chapter }}</span><span v-if="['photo','pdf','ai'].includes(ingest.tab) && ingest.bookTitle"> · 教材：{{ ingest.bookTitle }}</span><br>题目来源： <code>{{ currentSource() || '（无）' }}</code></div>
      <template v-if="ingest.tab==='manual' || ingest.tab==='photo'">
        <div v-if="ingest.tab==='photo'" class="card" style="margin-bottom:14px">
          <label class="btn subtle" style="cursor:pointer">拍摄 / 选择照片
            <input type="file" accept="image/*" capture="environment" @change="onPhotoFile" style="display:none" />
          </label>
          <div class="hint">照片先保留在浏览器本地。“AI OCR 识别并导入”会把图片发给你配置的 AI 视觉模型，识别出的题目写入题库。若模型不支持图片，可用“本地 OCR 存为教材”，全程在浏览器里识别、不花 AI 额度。</div>
          <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:8px"><button class="btn" :disabled="ingest.busy || ingest.local.busy || !ingest.photoDataUrl" @click="aiPhotoImport"><span v-if="ingest.busy" class="spin"></span>AI OCR 识别并导入</button><button class="btn subtle" :disabled="ingest.busy || ingest.local.busy || !ingest.photoDataUrl" @click="photoToMaterialLocal"><span v-if="ingest.local.busy" class="spin"></span>本地 OCR 存为教材（不调用 AI）</button></div>
          <div class="hint" v-if="ingest.local.busy || ingest.local.prog">{{ ingest.local.prog || '处理中…' }}</div>
          <img v-if="ingest.photoUrl" :src="ingest.photoUrl" style="max-width:100%;margin-top:12px;border-radius:12px;border:1px solid var(--line)" />
        </div>
        <div class="toolbar">
          <div class="field"><label>题型</label><select v-model="ingest.manual.type"><option v-for="t in types" :key="t.v" :value="t.v">{{ t.t }}</option></select></div>
          <div class="field"><label>难度</label><select v-model.number="ingest.manual.difficulty"><option v-for="n in [1,2,3,4,5]" :key="n" :value="n">{{ n }}</option></select></div>
        </div>
        <textarea v-model="ingest.manual.passage" style="min-height:80px;margin-bottom:10px" placeholder="可选：材料 / 阅读文本"></textarea>
        <textarea v-model="ingest.manual.stem" placeholder="题干。数学可用 $...$；代码可用 Markdown 代码块。"></textarea>
        <div v-if="ingest.manual.type==='single_choice'||ingest.manual.type==='multiple_choice'" style="margin-top:10px">
          <div v-for="o in ingest.manual.options" :key="o.key" class="row" style="margin-bottom:8px"><span class="chip">{{ o.key }}</span><input class="inp" style="flex:1" v-model="o.text" :placeholder="'选项 '+o.key" /></div>
        </div>
        <input class="inp" style="width:100%;margin-top:10px" v-model="ingest.manual.answer" placeholder="答案：单选填 A；多选填 A,C；判断填 T 或 F；填空每行一个；主观题填写参考答案" />
        <textarea v-model="ingest.manual.analysis" style="min-height:90px;margin-top:10px" placeholder="解析 / 分析（可选）"></textarea>
        <input class="inp" style="width:100%;margin-top:10px" v-model="ingest.manual.tags" placeholder="标签，用逗号分隔（可选）" />
        <div class="hint">这会通过 /api/process 将结构化 JSON 直接保存到 D1。无需 AI、无需 OCR、无需付费服务。</div>
        <div class="row" style="margin-top:12px"><button class="btn" :disabled="ingest.busy" @click="saveManual"><span v-if="ingest.busy" class="spin"></span>免费保存题目</button><button class="btn subtle" @click="resetManual">清空</button></div>
      </template>
      <template v-else-if="ingest.tab==='ai'">
        <textarea v-model="ingest.raw" placeholder="粘贴任意原文：可以是杂乱的题目，也可以是教材正文。AI 会自动分辨——是题目就结构化进题库，是教材就整理成知识点笔记进「教材阅读」。此功能消耗 AI 中转额度。"></textarea>
        <div class="hint">上方「导入类型」选<b>自动分辨</b>时，AI 会判断这段是题库还是教材并分别入库；也可强制只当题库 / 只当教材。纯免费零成本请用手动录入、JSON 或 PDF 本地提取文本。</div>
        <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:8px"><button class="btn" :disabled="ingest.busy || ingest.local.busy" @click="doIngest"><span v-if="ingest.busy" class="spin"></span>用 AI 整理并导入</button><button class="btn subtle" :disabled="ingest.busy || ingest.local.busy" @click="saveTextAsMaterial"><span v-if="ingest.local.busy" class="spin"></span>不调用 AI，直接存为教材</button></div>
        <div class="hint" v-if="ingest.local.busy || ingest.local.prog">{{ ingest.local.prog || '处理中…' }}</div>
      </template>
      <template v-else-if="ingest.tab==='json'">
        <textarea class="code" v-model="ingest.json" placeholder='Paste a JSON array, e.g. [{"subject":"computer","type":"single_choice","stem":"...","options":[{"key":"A","text":"..."}],"answer":["B"]}]'></textarea>
        <div class="hint">如果你已经有结构化题目，请用这里。<b>无 AI 成本</b>。数据格式见项目 README。</div>
        <div class="row" style="margin-top:12px">
          <button class="btn" :disabled="ingest.busy" @click="doIngest"><span v-if="ingest.busy" class="spin"></span>导入</button>
          <button class="btn subtle" @click="loadSample">加载示例题集</button>
        </div>
      </template>
      <template v-else-if="ingest.tab==='pdf'">
        <label class="btn subtle" style="cursor:pointer">选择 PDF
          <input type="file" accept="application/pdf,.pdf" @change="onPdfFile" style="display:none" />
        </label>
        <span v-if="ingest.pdf.pages" class="muted" style="margin-left:10px">已加载，{{ ingest.pdf.pages }} 页</span>
        <div class="hint">扫描版勾「扫描页用本地 OCR」后选引擎：<b>中转站·你的视觉模型</b>（最准，识别成带标题/公式的 Markdown，按你中转额度计费）；Scribe.js / tesseract（免费本地，公式弱）；Workers AI（Cloudflare 免费额度，每天 {{ cfocr.limit }} 页封顶）。公式会输出 LaTeX 并用 KaTeX 显示。建议每次先测 1–3 页。</div>
        <div class="toolbar" style="margin-top:12px" v-if="ingest.pdf.pages">
          <div class="field"><label>开始页</label><input class="inp" type="number" min="1" :max="ingest.pdf.pages" v-model.number="ingest.pdf.start" /></div>
          <div class="field"><label>结束页</label><input class="inp" type="number" min="1" :max="ingest.pdf.pages" v-model.number="ingest.pdf.end" /></div>
          <div class="field"><label>清晰度</label><input class="inp" type="number" step="0.1" min="1" max="2.5" v-model.number="ingest.pdf.scale" /></div>
        </div>
        <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:8px" v-if="ingest.pdf.pages">
          <button class="btn subtle" :disabled="ingest.pdf.busy || ingest.local.busy" @click="pdfExtractText"><span v-if="ingest.pdf.busy" class="spin"></span>本地提取文本</button>
          <button class="btn" :disabled="ingest.pdf.busy || ingest.local.busy" @click="pdfByImages"><span v-if="ingest.pdf.busy" class="spin"></span>AI OCR 当前页范围并导入（题库）</button>
          <button class="btn subtle" :disabled="ingest.pdf.busy || ingest.local.busy" @click="pdfToMaterialLocal"><span v-if="ingest.local.busy" class="spin"></span>当前页范围转教材存入 Books（不调用 AI）</button>
          <button class="btn subtle" :disabled="ingest.pdf.busy || ingest.local.busy" @click="pdfAllToMaterialLocal">全部页转教材（共 {{ ingest.pdf.pages }} 页）</button>
          <button v-if="ingest.local.busy" class="btn subtle" @click="ingest.local.stop=true">停止</button>
          <label class="row" style="height:40px;cursor:pointer;gap:6px"><input type="checkbox" v-model="ingest.local.ocr" /> <span class="muted">扫描页用本地 OCR</span></label>
          <div class="field" v-if="ingest.local.ocr" style="margin:0"><label>OCR 引擎</label><select v-model="ingest.local.engine" @change="ingest.local.engine==='cfai' && loadCfUsage()"><option value="relay" :disabled="!ai.hasAI && !ocrCfg.key">中转站·你的视觉模型（最准）</option><option value="scribe">Scribe.js（免费·较慢）</option><option value="tesseract">tesseract（免费·一般）</option><option value="cfai" :disabled="!ai.hasCfAI">Workers AI（免费额度{{ ai.hasCfAI?'':'·未绑定' }}）</option></select></div>
          <template v-if="ingest.local.ocr && ingest.local.engine==='relay'">
            <div class="field" style="margin:0;min-width:260px"><label>视觉模型（须支持看图，如 gpt-4o / qwen-vl-max / gemini-1.5-pro）</label><input class="inp" v-model="ocrCfg.model" @change="saveOcrCfg" placeholder="留空用服务端 AI_VISION_MODEL" /></div>
            <details style="flex-basis:100%;margin-top:4px"><summary class="muted" style="cursor:pointer;font-size:13px">高级：自定义 Base URL / API Key（可选）</summary>
              <div class="toolbar" style="margin-top:8px">
                <div class="field" style="margin:0;min-width:280px"><label>Base URL（留空用服务端）</label><input class="inp" v-model="ocrCfg.base" @change="saveOcrCfg" placeholder="https://你的中转站/v1" /></div>
                <div class="field" style="margin:0;min-width:280px"><label>API Key（留空用服务端）</label><input class="inp" type="password" v-model="ocrCfg.key" @change="saveOcrCfg" placeholder="sk-..." /></div>
              </div>
              <div class="hint" style="margin-top:6px">⚠ 这里填的 Key 仅保存在你本机浏览器（localStorage），请求时经本站后端转发给你的中转站；公用电脑勿填，建议用额度受限的子 Key。留空则用服务端环境变量里的配置。</div>
            </details>
          </template>
          <template v-if="ingest.local.ocr && ingest.local.engine==='cfai'">
            <div class="field" style="margin:0"><label>每日页数上限（防超额度）</label><select v-model.number="ingest.local.cfPageLimit"><option :value="30">30 页（约 {{ 30*cfocr.npp }} 神经元·很保守）</option><option :value="50">50 页（约 {{ 50*cfocr.npp }} 神经元·推荐）</option><option :value="70">70 页（约 {{ 70*cfocr.npp }} 神经元·接近上限）</option></select></div>
            <div class="field" style="margin:0;min-width:320px"><label>Workers AI 模型（留空=默认 Llama 3.2 Vision；可粘贴 @cf/ 模型）</label><input class="inp" v-model="ingest.local.cfModel" list="cfModelList" placeholder="@cf/meta/llama-3.2-11b-vision-instruct" />
              <datalist id="cfModelList">
                <option value="@cf/meta/llama-3.2-11b-vision-instruct">Llama 3.2 11B Vision（默认·最稳妥）</option>
                <option value="@cf/meta/llama-4-scout-17b-16e-instruct">Llama 4 Scout 17B（更新·多模态·可试）</option>
                <option value="@cf/google/gemma-3-12b-it">Gemma 3 12B（多模态·可试）</option>
                <option value="@cf/mistralai/mistral-small-3.1-24b-instruct">Mistral Small 3.1 24B（多模态·可试）</option>
              </datalist>
            </div>
            <div class="hint" style="flex-basis:100%">今日 Workers AI：已用 <b>{{ cfocr.used }}</b> 页 · 约 <b>{{ cfocr.used*cfocr.npp }}</b> / {{ cfocr.budget }} 神经元，剩约 <b>{{ Math.max(0, cfocr.budget - cfocr.used*cfocr.npp) }}</b>（估算 {{ cfocr.npp }}/页，实际因模型与页面内容而异；精确值看 Cloudflare 后台「神经元」）。免费层每天 {{ cfocr.budget }} 神经元，UTC 0 点重置。默认 Llama 3.2 最稳；其它为多模态模型，<b>调用图片的格式不一定兼容，可能识别效果差或报错，不行就换回默认</b>。Workers AI 模型库里没有 Qwen-VL。</div>
          </template>
          <span v-if="ingest.pdf.inserted" class="muted">已导入 {{ ingest.pdf.inserted }} 题</span>
        </div>
        <div class="hint" v-if="ingest.pdf.pages">转教材将存入：<b>{{ materialBaseTitle() }}</b>（即上方「教材名称」；同名同页会覆盖，换书请改书名）</div>
        <div v-if="ingest.local.busy || (ingest.local.prog && !ingest.pdf.busy)" class="ocr-panel">
          <div class="top"><div><b>本地转教材进度</b><div class="muted">不调用 AI，全程在浏览器内完成</div></div><div class="row" style="gap:10px;align-items:center"><button v-if="ingest.local.busy" class="btn subtle" style="color:#c0392b;height:32px;padding:0 14px" @click="ingest.local.stop=true">■ 停止</button><div class="pct">{{ ingest.local.total ? Math.round(ingest.local.done/ingest.local.total*100) : 0 }}%</div></div></div>
          <div class="bar accent"><span :style="{width:(ingest.local.total ? Math.round(ingest.local.done/ingest.local.total*100) : 0)+'%'}"></span></div>
          <div class="hint" style="margin-top:10px"><span v-if="ingest.local.busy" class="spin"></span> {{ ingest.local.prog || '等待开始' }} · {{ ingest.local.done }}/{{ ingest.local.total || 0 }} · 已存 {{ ingest.local.inserted }} 段教材</div>
          <div v-if="ingest.local.log.length" style="margin-top:10px">
            <div class="muted" style="font-size:12px;margin-bottom:4px">逐页明细（共 {{ ingest.local.log.length }} 条，最新在下）：</div>
            <div style="max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:8px 10px;font-size:12.5px;line-height:1.6;font-family:var(--mono,monospace)">
              <div v-for="(l,i) in ingest.local.log" :key="i" :style="{color: l.t==='ok'?'var(--ink)': l.t==='skip'?'#b8860b':'#c0392b'}">{{ l.t==='ok'?'✓':l.t==='skip'?'⚠':'✗' }} 第 {{ l.p }} 页 · {{ l.msg }}</div>
            </div>
          </div>
        </div>
        <div v-if="!ingest.local.busy && ingest.local.lastPage && ingest.local.lastPage < ingest.local.endPage" class="hint" style="margin-top:10px;color:var(--accent)">已处理到第 {{ ingest.local.lastPage }} 页（共到第 {{ ingest.local.endPage }} 页未完）。「开始页」已自动设为 {{ ingest.pdf.start }}，直接再点「当前页范围转教材」即可从断点继续。</div>
        <div v-if="ingest.pdf.busy || ingest.pdf.prog" class="ocr-panel">
          <div class="top"><div><b>AI OCR 进度</b><div class="muted">模型：{{ ocrModelName }}</div></div><div class="pct">{{ ingest.pdf.total ? Math.round(ingest.pdf.done/ingest.pdf.total*100) : 0 }}%</div></div>
          <div class="bar accent"><span :style="{width:(ingest.pdf.total ? Math.round(ingest.pdf.done/ingest.pdf.total*100) : 0)+'%'}"></span></div>
          <div class="hint" style="margin-top:10px"><span v-if="ingest.pdf.busy" class="spin"></span> {{ ingest.pdf.prog || '等待开始' }} · {{ ingest.pdf.done }}/{{ ingest.pdf.total || 0 }} 页 · 已导入 {{ ingest.pdf.inserted }} 题</div>
        </div>
        <textarea v-if="ingest.pdf.extracted" class="code" style="margin-top:10px" v-model="ingest.pdf.extracted" placeholder="提取出的 PDF 文本会显示在这里"></textarea><div class="hint" style="margin-top:10px">如果是文字 PDF，可复制文本到“AI 整理”；如果是扫描版，直接用“AI OCR 当前页范围并导入”。</div>
      </template>
      <template v-else-if="ingest.tab==='md'">
        <label class="btn subtle" style="cursor:pointer">选择 Markdown 文件（可多选）
          <input type="file" accept=".md,.markdown,text/markdown" multiple @change="onMdFiles" style="display:none" />
        </label>
        <span v-if="ingest.mdFiles.length" class="muted" style="margin-left:10px">已选 {{ ingest.mdFiles.length }} 个文件</span>
        <div class="hint">把本地转好的章节 Markdown（如 chapter-01.md … 或 front-matter.md）选进来，按「## 第 N 页」自动拆成页存入 Books，复用翻页/目录/出题阅读器。<b>免费、无 OCR、文本干净。</b></div>
        <div class="hint">书名取上方「教材名称」（首个文件的「来源」会自动填）；多文件会按页码合并成同一本书。页面原图若引用 <code>public/textbooks-pages/…</code>，需把对应图片文件夹放进部署的 <code>public/</code> 才能显示；折叠的检索文本始终可读。</div>
        <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:8px">
          <button class="btn" :disabled="ingest.local.busy || !ingest.mdFiles.length" @click="importMarkdown"><span v-if="ingest.local.busy" class="spin"></span>导入到 Books</button>
        </div>
        <div class="hint" v-if="ingest.local.busy || ingest.local.prog">{{ ingest.local.prog || '处理中…' }} · {{ ingest.local.done }}/{{ ingest.local.total || 0 }}</div>
      </template>
      <template v-else-if="ingest.tab==='mineru'">
        <label class="btn subtle" style="cursor:pointer">选择 PDF<input type="file" accept="application/pdf,.pdf" @change="onMineruFile" style="display:none" /></label>
        <span v-if="ingest.mineru.name" class="muted" style="margin-left:10px">{{ ingest.mineru.name }}</span>
        <div class="hint">用 <b>MinerU 云端</b>把整本 PDF 转成高质量 Markdown（公式 LaTeX、版面规整），自动按段导入 Books——很适合高数这类公式书。需先在 Cloudflare 配 <code>MINERU_API_KEY</code>（控制台「API 管理 → 创建 Token」生成的 Token，不是 Access/Secret Key）。解析在 MinerU 服务器进行，按你的 MinerU 额度计费（每天 1000 页高优先级）。书名取上方「教材名称」，科目自动判断。</div>
        <div class="field" style="margin-top:8px;max-width:420px"><label>模式</label><select v-model="ingest.mineru.mode"><option value="agent">免 Token 轻量（≤10MB·≤20页·公式较弱·现在就能用）</option><option value="precise">精准 vlm（需 Token·≤200MB·≤200页·公式最好）</option></select></div>
        <div class="field" style="margin-top:8px;max-width:340px"><label>页码范围（轻量≤20页不支持逗号；精准留空=整本自动按200页分段连跑）</label><input class="inp" v-model="ingest.mineru.pageRange" placeholder="轻量如 1-20；精准留空=整本，或填 1-200" /></div>
        <div class="hint" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:16px;align-items:center">
          <span>今日已用（本工具统计）：<b :style="(Number(mineruCfg.pageLimit)>0 && mineruUsageView.pages>=Number(mineruCfg.pageLimit))?'color:var(--bad)':''">{{ mineruUsageView.pages }}</b> / {{ mineruCfg.pageLimit||'∞' }} 页 · {{ mineruUsageView.files }} / {{ mineruCfg.fileLimit||'∞' }} 文件</span>
          <span v-if="mineruTokenDays()!=null" :style="mineruTokenDays()<=7?'color:var(--bad);font-weight:600':''">⏳ Token 还有 {{ mineruTokenDays() }} 天过期</span>
          <a href="#" @click.prevent="view='settings'" style="color:var(--accent)">配额 / Token 设置 ›</a>
        </div>
        <div v-if="mineruTokenDays()!=null && mineruTokenDays()<=7" class="hint" style="color:var(--bad);background:color-mix(in srgb,var(--bad) 8%,transparent);border:1px solid color-mix(in srgb,var(--bad) 35%,var(--line));border-radius:8px;padding:8px 10px;margin-top:6px">Token {{ mineruTokenDays()<0?'已过期':'即将过期' }}：MinerU 不支持续期，请去控制台「API 管理 → 创建 Token」重建，把新 Token 填到 Cloudflare Pages 环境变量 <code>MINERU_API_KEY</code> 后重新部署（应用无法自动创建）。</div>
        <div v-if="mineruTokenBad" class="hint" style="color:var(--bad);background:color-mix(in srgb,var(--bad) 10%,transparent);border:1px solid color-mix(in srgb,var(--bad) 45%,var(--line));border-radius:8px;padding:8px 10px;margin-top:6px"><b>MinerU Token 已过期或无效</b>（接口返回 A0211 / A0202）。请去 MinerU 控制台「API 管理 → 创建 Token」重建，把新 Token 填到 Cloudflare Pages 环境变量 <code>MINERU_API_KEY</code> 后重新部署。<a href="#" @click.prevent="mineruTokenOk()" style="color:var(--accent);margin-left:6px">我已更新，清除提示</a></div>
        <div class="row" style="margin-top:12px;gap:8px"><button class="btn" :disabled="ingest.mineru.busy || !ingest.mineru.name" @click="mineruConvert"><span v-if="ingest.mineru.busy" class="spin"></span>转换并导入 Books</button></div>
        <div v-if="ingest.mineru.busy || ingest.mineru.log.length" class="ocr-panel" style="margin-top:12px">
          <div class="top"><div><b>MinerU 转换进度</b><div class="muted">提交 → 解析 → 取回 Markdown → 导入</div></div><div class="pct">{{ ingest.mineru.pct }}%</div></div>
          <div class="bar accent"><span :style="{width:ingest.mineru.pct+'%'}"></span></div>
          <div class="hint" style="margin-top:8px"><span v-if="ingest.mineru.busy" class="spin"></span> {{ ingest.mineru.prog || '等待开始' }}</div>
          <div v-if="ingest.mineru.log.length" style="max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:8px 10px;font-size:12.5px;line-height:1.6;margin-top:8px;font-family:var(--mono,monospace)"><div v-for="(l,i) in ingest.mineru.log" :key="i">{{ l }}</div></div>
        </div>
      </template>
      <div v-if="ingest.result" class="ref" style="margin-top:16px">
        <h5>导入完成<span v-if="ingest.result.kind"> · 识别为{{ ingest.result.kind==='material'?'教材':ingest.result.kind==='mixed'?'题目+教材':'题库' }}</span></h5>
        <div class="muted">题目 {{ ingest.result.inserted_questions ?? ingest.result.inserted ?? 0 }} 道<span v-if="ingest.result.inserted_materials"> · 教材 {{ ingest.result.inserted_materials }} 段（已进「教材阅读」）</span></div>
        <div v-for="(s,i) in ingest.result.sample" :key="i" class="muted">· [{{ subjName(s.subject) }} / {{ typeMap[s.type]||s.type }}] {{ s.stem }}</div>
        <div v-for="(s,i) in (ingest.result.material_sample||[])" :key="'m'+i" class="muted">· [{{ subjName(s.subject) }} / 教材] {{ s.title }}</div>
      </div>
    </div>

    <div v-else-if="view==='settings'">
      <h2 style="margin:.2em 0 .5em">设置</h2>
      <div class="card" style="max-width:520px">
        <div class="field" style="margin-bottom:14px"><label>访问码（APP_TOKEN）</label>
          <input class="inp" style="width:100%" type="password" v-model="tokenInput" :placeholder="token?'已设置（重新输入可修改）':'输入你在 Cloudflare 设置的 APP_TOKEN'" @keyup.enter="saveToken" />
        </div>
        <div class="row">
          <button class="btn" @click="saveToken">保存</button>
          <button class="btn subtle" v-if="token" @click="logout">清空</button>
          <span class="muted" v-if="token">状态：已连接 ✓</span>
        </div>
        <div class="hint" style="margin-top:16px">访问码是你在 Cloudflare Pages 控制台设置的 <code>APP_TOKEN</code> 环境变量。它用于保护数据并防止他人使用你的 AI 额度。仅存储在当前浏览器中。</div>
      </div>
      <div class="card" style="max-width:680px;margin-top:14px">
        <div class="fold-head" @click="settFold.mineru=!settFold.mineru"><span style="font-weight:700;font-size:15px">MinerU 配额与 Token</span><span class="fold-arrow" :class="{open:!settFold.mineru}">▾</span></div>
        <div v-show="!settFold.mineru" class="fold-body" style="margin-top:10px">
        <div class="hint" style="margin-bottom:14px">用于限制导入页数、避免超出 MinerU 每日额度，并在 Token 快过期时提醒你。用量为<b>本工具本地统计</b>（按提交的页数估算），实际以 MinerU 后台为准；每天 0 点自动归零。</div>
        <div class="row" style="gap:12px;flex-wrap:wrap;margin-bottom:12px">
          <div class="field" style="flex:1;min-width:150px"><label>每日页数上限</label><input class="inp" type="number" min="0" v-model.number="mineruCfg.pageLimit" placeholder="1000" /></div>
          <div class="field" style="flex:1;min-width:150px"><label>每日文件数上限</label><input class="inp" type="number" min="0" v-model.number="mineruCfg.fileLimit" placeholder="5000" /></div>
          <div class="field" style="flex:1;min-width:170px"><label>Token 过期日期（从 MinerU 后台抄）</label><input class="inp" type="date" v-model="mineruCfg.tokenExp" /></div>
        </div>
        <div class="row" style="gap:14px;align-items:center;flex-wrap:wrap">
          <span class="muted">今日已用：<b>{{ mineruUsageView.pages }}</b> / {{ mineruCfg.pageLimit||'∞' }} 页 · <b>{{ mineruUsageView.files }}</b> / {{ mineruCfg.fileLimit||'∞' }} 文件</span>
          <span v-if="mineruTokenDays()!=null" class="muted" :style="mineruTokenDays()<=7?'color:var(--bad);font-weight:600':''">Token 剩余 {{ mineruTokenDays() }} 天</span>
          <button class="btn subtle xs" @click="mineruResetUsage">重置今日用量</button>
        </div>
        <div class="hint" style="margin-top:12px">设上限为 0 表示不限制。Token 到期后 MinerU <b>不支持续期</b>，需到控制台「API 管理 → 创建 Token」重建，再把新 Token 填到 Cloudflare Pages 环境变量 <code>MINERU_API_KEY</code> 并重新部署——这一步无法由应用自动完成。</div>
        </div>
      </div>
      <div class="card" style="max-width:680px;margin-top:14px">
        <div class="fold-head" @click="settFold.offline=!settFold.offline"><span style="font-weight:700;font-size:15px">离线使用（地铁/通勤）</span><span class="fold-arrow" :class="{open:!settFold.offline}">▾</span></div>
        <div v-show="!settFold.offline" class="fold-body" style="margin-top:10px">
        <div class="hint" style="margin-bottom:14px">把全部题目和教材一次性下载到本机，之后<b>彻底断网也能刷全部题、翻全部书、用筛选</b>。离线作答会排队，联网后自动补传。建议先「添加到主屏幕」装成 App 再用。</div>
        <div class="row" style="gap:12px;align-items:center">
          <button class="btn" :disabled="offlineSyncing || offline" @click="offlineSync"><span v-if="offlineSyncing" class="spin"></span>{{ offlineSyncing ? '下载中…' : '下载全部供离线使用' }}</button>
          <span v-if="offlineSyncing" class="muted">{{ offlineSyncMsg }}</span>
          <span v-else-if="offlineSynced" class="muted">已缓存 {{ offlineSynced.q }} 题 · {{ offlineSynced.m }} 页教材 · {{ new Date(offlineSynced.at).toLocaleString() }}</span>
          <span v-else class="muted">尚未下载离线包</span>
        </div>
        <div class="hint" style="margin-top:12px">题库更新后想让离线包同步，重新点一次即可覆盖。离线包存在本机浏览器，换设备需各自下载。</div>
        </div>
      </div>
      <div class="card" style="max-width:680px;margin-top:14px">
        <div class="fold-head" @click="settFold.subjects=!settFold.subjects"><span style="font-weight:700;font-size:15px">科目管理</span><span class="fold-arrow" :class="{open:!settFold.subjects}">▾</span></div>
        <div v-show="!settFold.subjects" class="fold-body" style="margin-top:10px">
        <div class="hint" style="margin-bottom:14px">在这里增删改科目;新增后,刷题、题库、导入等所有科目下拉会自动出现该科目。「关键词」用于导入与「智能归类」时自动判断科目(术语类,逗号分隔);代码 / 数学符号 / 英文等结构特征已内置在程序里,无需填写。</div>
        <div v-for="s in subjects" :key="s.v" class="subj-edit">
          <div class="subj-row">
            <span class="subj-code">{{ s.v }}</span>
            <input class="inp" style="width:140px" v-model="s.t" placeholder="科目名称" />
            <input class="inp" type="number" style="width:72px" v-model="s.sort" title="排序(小在前)" />
            <button class="btn subtle xs" @click="subjSave(s)">保存</button>
            <button class="bk-del xs" @click="subjDelete(s)">删除</button>
          </div>
          <input class="inp" style="width:100%;margin-top:6px" v-model="s.keywords" placeholder="自动判断关键词，逗号分隔（可留空）" />
        </div>
        <div class="subj-add">
          <div style="font-weight:600;font-size:13px;margin-bottom:8px">＋ 新增科目</div>
          <div class="subj-row">
            <input class="inp" style="width:130px" v-model="subjMgr.code" placeholder="代码 如 major" title="小写字母/数字/下划线" />
            <input class="inp" style="width:140px" v-model="subjMgr.name" placeholder="名称 如 专业课" />
            <input class="inp" type="number" style="width:72px" v-model="subjMgr.sort" placeholder="排序" />
            <button class="btn xs" :disabled="subjMgr.busy" @click="subjAdd"><span v-if="subjMgr.busy" class="spin"></span>新增</button>
          </div>
          <input class="inp" style="width:100%;margin-top:6px" v-model="subjMgr.keywords" placeholder="关键词，逗号分隔（可留空，之后也能改）" />
        </div>
        </div>
      </div>

      <div class="card" style="max-width:520px;margin-top:14px">
        <div class="field" style="margin-bottom:14px"><label>显示名称（浏览器标签页 + 页头）</label>
          <input class="inp" style="width:100%" v-model="appName" placeholder="例如：刷题 / 资料库 / 仪表盘 / 笔记" />
        </div>
        <div class="row" style="justify-content:space-between;margin-bottom:12px"><span style="font-weight:600">外观</span>
          <button class="btn subtle" @click="theme=theme==='light'?'dark':'light'">{{ theme==='light'?'深色模式 ☾':'浅色模式 ☀' }}</button>
        </div>
        <label class="row" style="cursor:pointer"><input type="checkbox" v-model="stealth.autoHide" /> <span class="muted">窗口失焦时自动隐藏（返回时恢复）</span></label>
        <div class="hint" style="margin-top:14px">快速隐藏：点击眼睛图标，或按 <code>&#96;</code>（1 左侧的按键）。再次按下或点击即可恢复。隐藏时页面只显示“同步中…”。</div>
      </div>
      <div class="muted" style="text-align:center;margin-top:28px;font-size:12px;opacity:.4">刷题文档 {{ appVer }}</div>
    </div>

  </div>

        <div v-if="pdfv.open" class="pdfv pdfv-fs">
          <div class="pdfv-bar">
            <div class="ttl">{{ pdfv.title }}</div>
            <div class="bk-nav">
              <button :disabled="pdfv.cur<=1" @click="pdfvPrev">← 上一页</button>
              <button :disabled="pdfv.cur>=pdfv.pages" @click="pdfvNext">下一页 →</button>
            </div>
            <span class="muted">{{ pdfv.cur }} / {{ pdfv.pages }}</span>
            <input class="bk-jump inp" type="number" min="1" :max="pdfv.pages" @keyup.enter="pdfvGoto($event.target.value)" placeholder="跳页" />
            <div class="pdfv-zoom"><button @click="pdfvZoom(-0.2)">−</button><span>{{ Math.round(pdfv.scale*100) }}%</span><button @click="pdfvZoom(0.2)">+</button></div>
            <button v-if="!pdfvMobile" class="btn subtle" @click="pdfvToggleMode" :title="pdfv.mode==='scroll'?'切换为单页模式':'切换为连续滚动'">{{ pdfv.mode==='scroll' ? '单页' : '连续' }}</button>
            <button class="btn subtle" @click="pdfvClose">关闭</button>
          </div>
          <div class="pdfv-body" :class="{'one-col': pdfv.mode==='page'}">
            <div class="pdfv-rail" ref="pdfvRail" v-if="pdfv.mode==='scroll'">
              <div v-for="n in pdfv.pages" :key="n" class="pdfv-thumb" :class="{on:n===pdfv.cur}" :data-page="n" @click="pdfvGoto(n)"><canvas></canvas><span>{{ n }}</span></div>
            </div>
            <div class="pdfv-main" ref="pdfvMain" v-if="pdfv.mode==='scroll'">
              <div v-for="n in pdfv.pages" :key="n" class="pdfv-page" :data-page="n"><canvas></canvas></div>
            </div>
            <div class="pdfv-single" v-if="pdfv.mode==='page'"><canvas ref="pdfvSingle"></canvas></div>
          </div>
          <div class="pdfv-foot">
            <button v-if="pdfvMobile" @click="pdfvTocOpen=true">☰ 目录</button>
            <button :disabled="pdfv.cur<=1" @click="pdfvPrev">← 上一页</button>
            <span class="muted">{{ pdfv.cur }} / {{ pdfv.pages }}</span>
            <button :disabled="pdfv.cur>=pdfv.pages" @click="pdfvNext">下一页 →</button>
          </div>
          <div v-if="pdfvMobile" class="pdfv-drawer" :class="{open:pdfvTocOpen}">
            <div class="pdfv-drawer-h"><b>目录</b><span class="muted" style="margin-left:6px">共 {{ pdfv.pages }} 页</span><button class="toc-close" @click="pdfvTocOpen=false" style="margin-left:auto">✕</button></div>
            <input class="inp pdfv-drawer-jump" type="number" min="1" :max="pdfv.pages" @keyup.enter="pdfvGoto($event.target.value); pdfvTocOpen=false" placeholder="输入页码跳转" style="margin:0 12px 8px;width:calc(100% - 24px)" />
            <div class="pdfv-drawer-list">
              <div v-for="n in pdfv.pages" :key="n" :class="{on:n===pdfv.cur}" @click="pdfvGoto(n); pdfvTocOpen=false">第 {{ n }} 页</div>
            </div>
          </div>
          <div v-if="pdfvMobile && pdfvTocOpen" class="pdfv-backdrop" @click="pdfvTocOpen=false"></div>
        </div>
  <div v-if="reader.open && currentBook && currentPageMat" class="reader" :class="['t-'+reader.theme, {serif:reader.serif, 'bars-hidden':reader.barsHidden}]" :style="{'--rfs':reader.fontSize+'px','--rlh':reader.lineGap}">
    <div class="r-scroll" ref="readerScroll" @click="readerTap" @touchstart.passive="readerTouchStart" @touchend.passive="readerTouchEnd">
      <div class="r-wrap">
        <div class="r-head">
          <div class="rt">{{ currentPageMat.title }}</div>
          <div class="rs">{{ subjName(currentPageMat.subject) }}<span v-if="currentPageMat.page"> · 第 {{ currentPageMat.page }} 页</span> · 第 {{ bookIdx+1 }} / {{ currentBook.pages.length }} 篇</div>
          <div v-if="currentPageMat.summary" class="rsum">{{ currentPageMat.summary }}</div>
        </div>
        <img v-if="currentPageMat.page_image" :src="currentPageMat.page_image" style="max-width:100%;height:auto;display:block;margin:0 auto 18px;border-radius:10px;border:1px solid var(--rline);background:#fff;padding:6px" />
        <rich-text :content="currentPageMat.content_md" :key="currentPageMat.id" />
      </div>
    </div>
    <div class="r-top">
      <button class="ricon" @click="readerClose" title="退出阅读">‹ 退出</button>
      <div class="rttl">{{ currentBook.title }}</div>
      <button class="ricon" @click="reader.tocOpen=true" title="目录">☰</button>
      <button class="ricon" @click="reader.panel=!reader.panel; reader.barsHidden=false" title="字号 / 主题">Aa</button>
    </div>
    <div class="r-bot">
      <div class="rprog">第 <b>{{ bookIdx+1 }}</b> / {{ currentBook.pages.length }} 篇 · {{ Math.round((bookIdx+1)/currentBook.pages.length*100) }}%</div>
      <div class="rrow">
        <button class="rbtn" :disabled="bookIdx<=0" @click="readerPrev">← 上一篇</button>
        <button class="rbtn" :disabled="bookIdx>=currentBook.pages.length-1" @click="readerNext">下一篇 →</button>
      </div>
    </div>
    <div v-if="reader.panel" class="r-panel-backdrop" @click="reader.panel=false"></div>
    <div class="r-panel" :class="{open:reader.panel}">
      <div class="pr"><span class="lbl">字号</span><div class="step"><button @click="readerFont(-1)">A−</button><span class="val">{{ reader.fontSize }} px</span><button @click="readerFont(1)">A+</button></div></div>
      <div class="pr"><span class="lbl">行距</span><div class="seg"><button :class="{on:reader.lineGap===1.6}" @click="readerSetGap(1.6)">紧凑</button><button :class="{on:reader.lineGap===1.9}" @click="readerSetGap(1.9)">适中</button><button :class="{on:reader.lineGap===2.3}" @click="readerSetGap(2.3)">宽松</button></div></div>
      <div class="pr"><span class="lbl">字体</span><div class="seg"><button :class="{on:!reader.serif}" @click="readerSetSerif(false)">黑体</button><button :class="{on:reader.serif}" @click="readerSetSerif(true)">宋体</button></div></div>
      <div class="pr"><span class="lbl">主题</span><div class="seg" style="gap:14px"><span class="sw paper" :class="{on:reader.theme==='paper'}" @click="readerSetTheme('paper')" title="纸白"></span><span class="sw sepia" :class="{on:reader.theme==='sepia'}" @click="readerSetTheme('sepia')" title="米黄"></span><span class="sw green" :class="{on:reader.theme==='green'}" @click="readerSetTheme('green')" title="护眼绿"></span><span class="sw night" :class="{on:reader.theme==='night'}" @click="readerSetTheme('night')" title="夜间"></span></div></div>
    </div>
    <div v-if="reader.tocOpen" class="r-toc-backdrop" @click="reader.tocOpen=false"></div>
    <div class="r-toc" :class="{open:reader.tocOpen}">
      <h4>目录 <span style="color:var(--rsoft);font-weight:400;margin-left:6px">{{ currentBook.pages.length }} 篇</span><button class="ricon" style="margin-left:auto" @click="reader.tocOpen=false">✕</button></h4>
      <div class="list">
        <div v-for="(m,i) in currentBook.pages" :key="m.id" :class="{on:i===bookIdx}" @click="readerGoto(i)">{{ pageLabel(m) }}</div>
      </div>
    </div>
  </div>

  <div v-if="extractPreview.open" class="modal-mask" @click.self="extractClose">
    <div class="modal" style="max-width:860px;width:94vw">
      <div class="modal-h"><b>抽题预览 · {{ extractPreview.title }}</b><button class="toc-close" @click="extractClose">✕</button></div>
      <div class="modal-b">
        <div class="row" style="gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
          <span>共解析 <b>{{ extractPreview.items.length }}</b> 题，已勾选 <b>{{ extractUseCount() }}</b> 题导入</span>
          <span v-if="extractPreview.dup" class="muted">（已自动去重 {{ extractPreview.dup }} 题）</span>
          <span v-if="extractMissingCount()" class="muted" style="color:var(--bad)">其中 {{ extractMissingCount() }} 题没抽到答案</span>
          <button v-if="extractPreview.items.some(q=>!(q.answer&&q.answer.length))" class="btn subtle xs" @click="extractToggleMissing">勾选/取消「无答案」的题</button>
          <span class="muted" style="font-size:12px">提示：计算/证明题按「简答题」入库；导入后仍可在「题库」编辑修改。</span>
        </div>
        <div class="prev-list">
          <div v-for="(q,i) in extractPreview.items" :key="i" class="prev-item" :class="{off:!q._use, noans:!(q.answer&&q.answer.length)}">
            <label class="prev-ck"><input type="checkbox" v-model="q._use" /></label>
            <div class="prev-body">
              <div class="prev-meta"><span class="tag2">{{ typeName(q.type) }}</span><span v-if="q.chapter" class="muted" style="font-size:12px">{{ q.chapter }}</span><span v-if="!(q.answer&&q.answer.length)" class="tag" style="color:var(--bad);border-color:var(--bad)">无答案</span></div>
              <div class="prev-q"><span class="prev-lab">题干</span><rich-text :content="q.stem || '（空）'" /></div>
              <div v-if="q.options&&q.options.length" class="prev-opts"><span v-for="o in q.options" :key="o.key" class="prev-opt"><b>{{ o.key }}.</b> {{ o.text }}</span></div>
              <div v-if="q.answer&&q.answer.length" class="prev-q"><span class="prev-lab ans">答案</span><rich-text :content="ansLines(q)" /></div>
              <div v-if="q.page" class="muted" style="font-size:11.5px;margin-top:6px;opacity:.8">📄 出自第 {{ q.page }} 页</div>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-f">
        <span v-if="bookExtract.busy" class="muted">{{ bookExtract.prog }}</span>
        <button class="btn subtle" :disabled="bookExtract.busy" @click="extractClose">取消</button>
        <button class="btn" :disabled="bookExtract.busy || !extractUseCount()" @click="extractDoImport"><span v-if="bookExtract.busy" class="spin"></span>导入勾选的 {{ extractUseCount() }} 题（不花 AI）</button>
      </div>
    </div>
  </div>

  <div v-if="toast" class="toast" :class="{err:toast.err}">{{ toast.msg }}</div>
  <div v-if="stealth.hidden" class="stealth" @click="stealthShow">
    <div class="stealth-box"><span class="spin"></span><div>同步中…</div></div>
  </div>
  `
};

const app = createApp(App);
app.config.globalProperties.AUTO = AUTO;
app.config.globalProperties.OBJECTIVE = OBJECTIVE;
app.mount('#app');
