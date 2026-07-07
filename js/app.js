const { createApp } = Vue;
const APP_VER = 'v4.4';
// 队列缓存：放在模块级（不在 Vue 实例上），绕过 Vue 3 代理对动态属性的限制
let qCache = {};
const App={
  mixins: [ApiMixin, ReaderMixin, PracticeMixin, BankMixin, MockStatsMixin, IngestMixin, MineruMixin, BooksMixin, SettingsMixin],
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
    aiX:{ id:'', text:'', busy:false, chat:[], asking:false, model:'' },  // AI 解析：流式内容 + 追问对话（按题 id 归属）
    stats:null, statsDirty:true, statsLoading:false, bankDirty:true, /* 题库脏标记：首次 true，此后仅题目增删改后置位 */ settFold:{ mineru:true, offline:true, subjects:true },
    ai:{ model:'', visionModel:'', hasAI:false, hasCfAI:false, hasMineru:false },
    cfocr:{ used:0, limit:70, budget:10000, npp:115 },
    ocrCfg:{ model:'', base:'', key:'' },
    explainCfg:{ base:'', key:'', model:'' },  // AI 解析中转站（本机 localStorage，留空用服务端）
    materials:{ subject:'all', items:[], loading:false, loaded:false }, loadProgMsg:'',
    booksMode:'notes', bookFold:{},
    pageRendering:false,
    offline:false,
    offlineQueued:0,
    offlineSyncing:false, offlineSyncMsg:'', offlineSynced:null,
    mineruCfg:{ pageLimit:1000, fileLimit:5000, tokenExp:'', token:'' },  // token：用户自己的 MinerU API Token，留空用服务端
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
    exporting:false,
  }; },
  computed:{
    materialBooks(){ const map=new Map(); for(const m of (this.materials.items||[])){ const key=this.bookKeyOf(m); if(!map.has(key))map.set(key,{key,subject:m.subject,title:this.bookTitleOf(m),pages:[]}); map.get(key).pages.push(m); } const out=[]; for(const b of map.values()){ const byPage=new Map(); const noPage=[]; for(const m of b.pages){ const pg=Number(m.page)||0; if(pg>0){ const ex=byPage.get(pg); if(!ex||(m.created_at||0)>=(ex.created_at||0))byPage.set(pg,m); } else noPage.push(m); } let pages=[...byPage.values()].sort((a,b)=>(a.page||0)-(b.page||0)); pages=pages.concat(noPage.sort((a,b)=>(a.created_at||0)-(b.created_at||0))); b.pages=pages; b.subject=pages[0]?.subject||b.subject; out.push(b); } return out; },
    booksBySubject(){ const groups={math:[],computer:[],politics:[],english:[],other:[]}; for(const b of this.materialBooks){ (groups[b.subject]||groups.other).push(b); } return groups; },
    currentBook(){ if(!this.currentBookId)return null; return this.materialBooks.find(b=>b.key===this.currentBookId)||null; },
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
    curAiText(){ const q=this.cur; return (q && this.aiX.id===q.id) ? this.aiX.text : ''; },
    curAiChat(){ const q=this.cur; return (q && this.aiX.id===q.id) ? (this.aiX.chat||[]) : []; },
    curAiModel(){ const q=this.cur; return (q && this.aiX.id===q.id) ? (this.aiX.model||'') : ''; },
    mockPct(){ const t=this.mock.questions.length||1; return Math.round(this.mockResult.correct/t*100); },
    heatCells(){ const map={}; for(const h of ((this.stats&&this.stats.heat)||[]))map[h.d]=h;
      const out=[]; const today=new Date(); today.setHours(0,0,0,0);
      const start=new Date(today); start.setDate(start.getDate()-(139+((today.getDay()+6)%7))); /* 对齐到周一，共 20 列 */
      for(let i=0;i<140;i++){ const d=new Date(start); d.setDate(start.getDate()+i); if(d>today)break;
        const key=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
        const h=map[key]; out.push({key,n:h?h.n:0,r:h?(h.r||0):0}); }
      return out; },
    heatTotal(){ return this.heatCells.reduce((s,c)=>s+c.n,0); },
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
    booksMode(v){ try{ localStorage.setItem('zb_booksmode', v); }catch(_){ } if(v!=='pdf' && this.pdfv.open) this.pdfvClose(); if(v==='pdf' && this.pdfv.open) this.$nextTick(()=>{ if(this.pdfv.mode==='page'){ this.pdfvRenderSingle(); } else { this.pdfvSetupPages(false); } this.pdfvSetupThumbs(); }); },
  },
  methods:{
aiOv(vision){ // 全局 AI 中转站覆盖：随所有 AI 请求携带（成对生效；拍照/看图另带视觉模型）
  const e=this.explainCfg||{}; const o={};
  if(e.base&&e.key){ o.base_url=e.base; o.api_key=e.key; }
  if(e.model) o.model=e.model;
  if(vision && this.ocrCfg && (this.ocrCfg.model||'').trim()) o.vision_model=this.ocrCfg.model.trim();
  return o; },
flash(msg,err){ this.toast={msg,err:!!err}; clearTimeout(this.toastTimer); this.toastTimer=setTimeout(()=>this.toast=null,2600); },
subjName(v){ return SUBJ_MAP[v]||v; },
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
        if(this.sessionView===v && this.queue.length){
          // 内存里就是本视图的活会话（比任何缓存快照都新，如「错题回顾」直接写入的队列）：
          // 原地保留当前题目与作答进度，并丢弃已过期的缓存快照
          this.loading=false; delete qCache[v];
        } else if(c && c.q.length){
          this.queue=c.q; this.qi=c.i; this.queueTotal=c.t; this.sessionAns=c.a; this.sessionView=v; this.batchDone=c.bo; this.loadedOnce=c.lo; this.loading=false;
          delete qCache[v];
          this.filterLock=true; this.$nextTick(()=>{ this.filterLock=false; });
        } else { this.startSession(); }
      }
      if(v==='stats' && this.statsDirty) this.loadStats();
      if(v==='bank'){ if(!this.meta.subjects.length)this.loadMeta();
        // 惰性加载：仅首次进入或数据改动过(bankDirty)才重拉；单纯来回切导航不再刷新（保住滚动/翻页/勾选）
        if(this.bankDirty){ this.bankDirty=false; this.loadBank(true); } }
    },
sleep(ms){ return new Promise(r=>setTimeout(r,ms)); },
typeName(t){ return ({single_choice:'单选',multiple_choice:'多选',true_false:'判断',fill_blank:'填空',short_answer:'简答',code:'代码'})[t]||t; },
stealthHide(){ this.stealth.hidden=true; },
stealthShow(){ this.stealth.hidden=false; },
onKey(e){ const tag=(e.target&&e.target.tagName)||'';
      if(this.stealth.hidden){ e.preventDefault(); this.stealth.hidden=false; return; }
      if(this.reader.open){ if(e.key==='Escape'){ if(this.reader.tocOpen){this.reader.tocOpen=false;return;} if(this.reader.panel){this.reader.panel=false;return;} this.readerClose(); return; } if(tag==='INPUT'||tag==='TEXTAREA')return; if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' '){ e.preventDefault(); this.readerNext(); return; } if(e.key==='ArrowLeft'||e.key==='PageUp'){ e.preventDefault(); this.readerPrev(); return; } return; }
      if(e.key==='`'||e.key==='~'){ if(tag==='INPUT'||tag==='TEXTAREA')return; e.preventDefault(); this.stealth.hidden=true; } },
onBlur(){ if(this.stealth.autoHide) this.stealth.hidden=true; },
onFocus(){ if(this.stealth.autoHide) this.stealth.hidden=false; }
  },
  mounted(){ try{ window.__hideSplash&&window.__hideSplash(); }catch(_){}
    try{ console.log('[shuati] 前端版本 '+APP_VERSION); }catch(_){}
    document.documentElement.dataset.theme=this.theme; document.title=this.appName;
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focus', this.onFocus);
    try{ const oc=JSON.parse(localStorage.getItem('zb_ocrcfg')||'null'); if(oc&&typeof oc==='object'){ this.ocrCfg.model=oc.model||''; this.ocrCfg.base=oc.base||''; this.ocrCfg.key=oc.key||''; } }catch(_){}
    try{ const ec=JSON.parse(localStorage.getItem('zb_explaincfg')||'null'); if(ec&&typeof ec==='object'){ this.explainCfg.base=ec.base||''; this.explainCfg.key=ec.key||''; this.explainCfg.model=ec.model||''; } }catch(_){}
    try{ const mc=JSON.parse(localStorage.getItem('zb_mineru_cfg')||'null'); if(mc&&typeof mc==='object'){ if(mc.pageLimit!=null)this.mineruCfg.pageLimit=mc.pageLimit; if(mc.fileLimit!=null)this.mineruCfg.fileLimit=mc.fileLimit; this.mineruCfg.tokenExp=mc.tokenExp||''; this.mineruCfg.token=mc.token||''; } }catch(_){}
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
  template:APP_TEMPLATE
};

const app = createApp(App);
app.config.globalProperties.AUTO = AUTO;
app.config.globalProperties.OBJECTIVE = OBJECTIVE;
app.mount('#app');
