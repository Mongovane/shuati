const { createApp } = Vue;
// 队列缓存：放在模块级（不在 Vue 实例上），绕过 Vue 3 代理对动态属性的限制
let qCache = {};
let scrollCache = {};  // 各视图切走时的滚动位置，切回来恢复
const MIXINS = [ApiMixin, ReaderMixin, PracticeMixin, BankMixin, MockStatsMixin, IngestMixin, MineruMixin, BooksMixin, PdfToolMixin, SavedMixin, SettingsMixin];

// —— 通用防重入 ——
// 这些操作都写库（批量改/删、取消收藏、AI 归类）或触发下载，而按钮上没有 :disabled，
// 慢的时候用户会连点：轻则重复下载、重复扣 AI 额度，重则第二次点击落在已经变化的状态上
// （例如删题：第一次 await 期间队列还没 splice，第二次会把相邻的题一起从队列里抹掉）。
// 只列「纯由点击触发」的方法——startSession 有 onFilter 等 4 处程序化调用，
// 加了守卫会把正常的重新开局静默吞掉，所以不在名单里（它本身只是 GET，重入无害）。
const GUARDED_OPS = [
  'dropFromReview', 'deleteCurrentQuestion',
  'bankDelete', 'bankBatchDelete', 'bankBatchSubject', 'bankBatchChapter', 'bankBatchTag', 'bankAutoClassify', 'bankAiFillAnswers', 'bankSelectAllMatching',
  'favUnstarOne', 'favUnstarSel',
  'deleteBook', 'deleteMock', 'subjSave', 'subjDelete', 'loadSample',
  'bankExportSel', 'favExportSel', 'resumeMock', 'reviewMock',
];
// 放在 mixins 末尾：Vue 按顺序合并 methods，后面的同名方法覆盖前面的，
// 于是这里包装过的版本生效，而原实现通过闭包保留。
const GuardMixin = { methods: (function(){
  const out = {};
  for(const name of GUARDED_OPS){
    let orig = null;
    for(const mx of MIXINS){ if(mx.methods && mx.methods[name])orig = mx.methods[name]; }
    if(!orig)continue;                       // 名字写错就跳过；tests/reentrancy 会红
    out[name] = function(...args){
      if(this.busyOps[name])return;          // 正在跑，忽略这次点击
      this.busyOps[name] = true;
      const done = () => { this.busyOps[name] = false; };
      let r;
      try{ r = orig.apply(this, args); }
      catch(e){ done(); throw e; }
      if(r && typeof r.then === 'function')return r.then((v)=>{ done(); return v; }, (e)=>{ done(); throw e; });
      done(); return r;
    };
  }
  return out;
})() };

const App={
  mixins: [...MIXINS, GuardMixin],
  components:{ QuestionCard, RichText },
  data(){ return {
    token: localStorage.getItem('zb_token')||'',
    theme: localStorage.getItem('zb_theme')||'light',
    appName: localStorage.getItem('zb_appname')||'刷题文档',
    stealth:{ hidden:false, autoHide: localStorage.getItem('zb_autohide')==='1' },
    tokenInput:'', view:'practice',
    subjects:SUBJECTS, types:TYPES, subjMap:SUBJ_MAP, typeMap:TYPE_MAP, currentBookId:'', bookIdx:0, bookTocOpen:false, bookSearch:'',
    f:{ subject:'all', chapter:'', type:'', order:'random', tag:'', _mode:'all' }, filterLock:false, filterOpen:false,
    reviewSession:null,  // 「回顾某次模考错题」独立会话：{title, count} —— 非空时 wrong 视图显示横幅、不被常规队列覆盖
    meta:{ subjects:[], chapters:[] },
    queue:[], qi:0, loading:false, batchDone:false, loadedOnce:false, queueTotal:0, sessionAns:{}, sessionView:'', qStates:{},
    sessionStart:0, streak:0, bestStreak:0, qnavOpen:true,
    ingest:{ subject:'computer', chapter:'', source:'', kind:'auto', bookTitle:'', bookMode:true, bookName:'小红本', pageNo:'', questionNo:'', raw:'', json:'', busy:false, result:null, tab:'manual', xl:{ busy:false, name:'', rows:[], issues:[], done:false }, photoUrl:'', photoDataUrl:'', manual:{ type:'single_choice', difficulty:3, stem:'', passage:'', options:[{key:'A',text:''},{key:'B',text:''},{key:'C',text:''},{key:'D',text:''}], answer:'', analysis:'', tags:'' }, pdf:{ pages:0, busy:false, prog:'', done:0, total:0, inserted:0, start:1, end:1, scale:1.7, quality:0.72 }, local:{ busy:false, prog:'', done:0, total:0, inserted:0, ocr:false, engine:'relay', cfModel:'', cfPageLimit:50, log:[], stop:false, lastPage:0, endPage:0 }, mineru:{ busy:false, prog:'', pct:0, name:'', log:[], pageRange:'', mode:'agent' } },
    aiX:{ id:'', view:'', text:'', busy:false, chat:[], asking:false, model:'', cards:[], cardsModel:'', flip:{}, reasoning:'', cardsReasoning:'', reasonOpen:true, usage:null, cardsUsage:null }, aiStates:{},  // AI 解析(text/chat)与知识点(cards)各存各的；view 控制当前显示；aiStates 按题缓存已生成内容。reasoning 是「本次生成的思维链」——只活在内存里，不写 aiStates、不落库、切题即弃
    stats:null, statsDirty:true, statsLoading:false, bankDirty:true, /* 题库脏标记：首次 true，此后仅题目增删改后置位 */ settFold:{ token:false, aicfg:true, mineru:true, offline:true, subjects:true, prefs:true },
    ai:{ model:'', visionModel:'', hasAI:false, hasCfAI:false, hasMineru:false },
    cfocr:{ used:0, limit:70, budget:10000, npp:115 },
    ocrCfg:{ model:'', base:'', key:'' },
    explainCfg:{ base:'', key:'', model:'', maxTokens:0 },  // AI 解析中转站（本机 localStorage，留空用服务端）。maxTokens=0 用服务端默认值
    autoSaveAi:false,  // 自动保存 AI 解析/知识点卡片到题目（默认关：手动保存更省存储/额度）
    modelPick:{ busy:false, list:[] }, modelBoxOpen:false, aiTestBusy:false,  // 「从端点拉取」到的模型候选列表
    explainStable:false,  // 稳定模式：关闭流式改用一次性返回（流式易断的模型/网络下更稳）
    materials:{ subject:'all', items:[], loading:false, loaded:false }, loadProgMsg:'',
    matProg:{ cur:0, total:0, pct:0, unit:'段' },   // 教材加载的数字进度（total>0 时进度条走确定进度）
    booksMode:'notes', bookFold:{},
    pageRendering:false,
    offline:false,
    offlineQueued:0,
    offlineSyncing:false, offlineSyncMsg:'', offlineSynced:null,
    mineruCfg:{ pageLimit:1000, fileLimit:5000, tokenExp:'', token:'' },  // token：用户自己的 MinerU API Token，留空用服务端
    mineruUsageView:{ date:'', pages:0, files:0 },
    mineruTokenBad:false,
    bookExtract:{ busy:false, prog:'', done:0, total:0 },
    busyOps:{},   // 防重入标志，键是方法名；模板可用 :disabled="busyOps.xxx" 拿到反馈
    bankAiFill:{ busy:false, prog:'', total:0, filled:0, skipped:0, failed:0, canceled:false, log:[], panel:false },   // AI 补答案进度（log 供过程面板逐题显示）
    extractSkippedToc:0,
    extractPreview:{ open:false, items:[], title:'', subject:'', source:'', dup:0, page:1, pageSize:40 },
    bank:{ items:[], total:0, loading:false, offset:0, limit:50, subject:'', type:'', kw:'', tag:'', status:'', mode:'all', sel:[], batchSubject:'', batchProg:'', chapter:'' },
    subjMgr:{ code:'', name:'', sort:'', keywords:'', busy:false },
    bankEdit:{ open:false, q:null, stem:'', analysis:'', subject:'', type:'', options:[], answerText:'', busy:false },
    pdfAi:{ open:false, input:'', asking:false, chat:[], pageAtOpen:0, _cacheP:0, _cacheT:'', _cacheImgP:0, _cacheImg:'' },
    pdfv:{ open:false, loading:false, rendering:false, pages:0, cur:1, scale:1, title:'', mode:'scroll', msg:'' , outline:[], invert:false, barsOff:false, curId:''},
    pdfvMobile:false, pdfvSliderTip:'', pdfvTocOpen:false,
    pdfShelf:{ items:[], loading:false, uploading:false, prog:'', pct:0, cloudReady:true, note:'' },
    genq:{ busy:false, result:null },
    mock:{ subject:'computer', count:20, minutes:60, objectiveOnly:true, started:false, finished:false, questions:[], answers:{}, remaining:0, timer:null, elapsed:0,
      bp:{ on:false, rows:[{type:'',chapter:'',count:10}] },   /* 组卷蓝图：章节×题型×数量 */
      touched:{}, lastId:null, sheetOpen:true },
    printW:{ items:[], withAns:true, busy:false },   /* 错题打印 */
    ankiBusy:false,
    examDate: localStorage.getItem('zb_examdate')||'',
    dailyNewLimit: parseInt(localStorage.getItem('zb_newlimit')||'0',10)||0,
    dup:{ open:false, busy:false, groups:[], del:{}, scanned:0 },   /* 近似查重 */
    qimgInline:false,   /* 插图：小图内嵌 dataURL */
    mockSaved:null,               // 未完成模考的快照（供「继续上次考试」横幅）
    restoring:false, restoreReplace:false,  // 备份恢复：进行中标记 / 覆盖式开关
    toast:null, toastTimer:null, showTop:false, scrollDown:false, segActive:false,
    fav:{ items:[], total:0, loading:false, offset:0, limit:30, sel:[], listMode:true, loadedOnce:false }, favDirty:false,
    reviewScope:'due',   // 错题页范围：due=今日到期(SRS) / all=全部错题
    bookSubjPick:{ open:false, book:null, custom:'' },
    exporting:false,
  }; },
  computed:{
    materialBooks(){ const map=new Map(); for(const m of (this.materials.items||[])){ const key=this.bookKeyOf(m); if(!map.has(key))map.set(key,{key,subject:m.subject,title:this.bookTitleOf(m),pages:[]}); map.get(key).pages.push(m); } const out=[]; for(const b of map.values()){ const byPage=new Map(); const noPage=[]; for(const m of b.pages){ const pg=Number(m.page)||0; if(pg>0){ const ex=byPage.get(pg); if(!ex||(m.created_at||0)>=(ex.created_at||0))byPage.set(pg,m); } else noPage.push(m); } let pages=[...byPage.values()].sort((a,b)=>(a.page||0)-(b.page||0)); pages=pages.concat(noPage.sort((a,b)=>(a.created_at||0)-(b.created_at||0))); b.pages=pages; b.subject=pages[0]?.subject||b.subject; out.push(b); } return out; },
    booksBySubject(){ const kw=(this.bookSearch||'').trim().toLowerCase();
      const groups={}; const order=['math','computer','politics','english']; // 四科固定顺序在前
      for(const k of order)groups[k]=[];
      for(const b of this.materialBooks){ if(kw && !String(b.title||'').toLowerCase().includes(kw))continue; const k=b.subject||'other'; if(!groups[k])groups[k]=[]; groups[k].push(b); }
      // 移除空的固定科目组（无书就不显示空组），保留有书的自定义组
      const out={}; for(const k of Object.keys(groups)){ if(groups[k].length)out[k]=groups[k]; }
      return out; },
    booksTotalCount(){ return this.materialBooks.length; },
    bookSearchEmpty(){ const kw=(this.bookSearch||'').trim().toLowerCase(); if(!kw||this.currentBookId)return false; return !this.materialBooks.some(b=>String(b.title||'').toLowerCase().includes(kw)); },
    // 已存在的自定义分类（materials 里非四科的 subject 值），供分类弹窗快捷复用
    customCategories(){ const fixed=new Set(['math','computer','politics','english']); const s=new Set(); for(const b of this.materialBooks){ const k=b.subject; if(k && !fixed.has(k))s.add(k); } return [...s]; },
    modelSuggest(){ const list=this.modelPick.list||[]; if(!list.length)return []; const kw=String(this.explainCfg.model||'').trim().toLowerCase(); const hit=kw? list.filter(m=>String(m).toLowerCase().includes(kw)) : list; return hit.slice(0,20); },
    // 继续阅读：上次打开(zb_bookid)且仍存在、有阅读进度的书
    lastReadBook(){ let id=''; try{ id=localStorage.getItem('zb_bookid')||''; }catch(_){ } if(!id)return null; const b=this.materialBooks.find(x=>x.key===id); if(!b)return null; let pos=0; try{ pos=parseInt(localStorage.getItem('zb_readpos:'+id),10)||0; }catch(_){ } if(pos<=0)return null; return b; },
    currentBook(){ if(!this.currentBookId)return null; return this.materialBooks.find(b=>b.key===this.currentBookId)||null; },
    currentPageMat(){ const b=this.currentBook; if(!b||!b.pages.length)return null; const i=Math.min(Math.max(0,this.bookIdx),b.pages.length-1); return b.pages[i]; },
    bookCurBookPage(){ const m=this.currentPageMat; return (m&&m.page)?m.page:0; },
    ocrModelName(){ return this.ai.visionModel || this.ai.model || '未读取模型'; },
    sessionMode(){ if(this.view==='wrong')return this.reviewScope==='due'?'due':'wrong'; if(this.view==='favorite')return'favorite'; return this.f._mode||'all'; },
    chaptersForSubject(){ return this.meta.chapters.filter(c=> this.f.subject==='all'||c.subject===this.f.subject); },
    mockChapters(){ const seen=new Set(); const out=[];
      for(const c of this.meta.chapters){ if(this.mock.subject!=='all'&&c.subject!==this.mock.subject)continue; if(!seen.has(c.chapter)){ seen.add(c.chapter); out.push(c.chapter); } }
      return out; },
    ingestChapterOptions(){ const preset=(CHAPTER_PRESETS[this.ingest.subject]||[]).map(ch=>({chapter:ch,n:'预设'})); const existing=(this.meta.chapters||[]).filter(c=>c.subject===this.ingest.subject&&!preset.some(p=>p.chapter===c.chapter)); return [...preset,...existing]; },
    sourcePreview(){ return this.makeSource(); },
    wrongTotal(){ if(!this.stats)return 0; return this.stats.bySubject.reduce((s,r)=>s+(r.wrong_open||0),0); },
    cur(){ return this.queue[this.qi]||null; },
    // 版本号只有 js/constants.js 的 APP_VERSION 一份（npm run bump 会同步它）。
    // 以前这里另有一个手写的 APP_VER 常量，bump 不管它，界面版本号从 v4.4 起就冻住了。
    appVer(){ return APP_VERSION; },
    curStatus(){ const q=this.cur; if(!q)return null; if(q.mastered)return{t:'已掌握',c:'var(--ok)'}; if(q.wrong_count>0)return{t:'错过 '+q.wrong_count+' 次',c:'var(--bad)'}; if(q.right_count>0)return{t:'已做对',c:'var(--ok)'}; return null; },
    accPct(){ const t=this.statTotals; const d=t.right+t.wrong; return d?Math.round(t.right/d*100):0; },
    ringDash(){ const C=2*Math.PI*52; return (this.accPct/100*C).toFixed(1)+' '+C.toFixed(1); },
    sessionDone(){ return Object.keys(this.sessionAns).length; },
    sessionElapsed(){ if(!this.sessionStart)return '0:00'; let s=Math.max(0,Math.round((Date.now()-this.sessionStart)/1000)); const m=Math.floor(s/60); s=s%60; return m+':'+String(s).padStart(2,'0'); },
    statTotals(){ const z={totalQ:0,seen:0,wrongOpen:0,mastered:0,fav:0,right:0,wrong:0,rightQ:0}; if(!this.stats)return z;
      for(const r of this.stats.bySubject){ z.totalQ+=r.total_q||0; z.seen+=r.seen||0; z.wrongOpen+=r.wrong_open||0; z.mastered+=r.mastered||0; z.fav+=r.favorited||0; z.right+=r.right_sum||0; z.wrong+=r.wrong_sum||0; z.rightQ+=r.right_q||0; } return z; },
    // 总掌握率：已作答的题里，当前状态为「做对」的占比（按题计，比按作答次数更贴近真实掌握程度）
    overallRate(){ const t=this.statTotals; return t.seen? Math.round(t.rightQ/t.seen*100):0; },
    mockResult(){ const v=Object.values(this.mock.answers); const correct=v.filter(x=>x===true).length; const half=v.filter(x=>x===0.5).length;
      return { graded:v.filter(x=>x!==null).length, correct, half, score:correct+half*0.5, total:this.mock.questions.length }; },
    curAiText(){ const q=this.cur; return (q && this.aiX.id===q.id && this.aiX.view==='explain') ? this.aiX.text : ''; },
    // 按视图取，和 curAiModel 一致。以前 reasoning 只有一份，生成完卡片切回解析，
    // 解析下面挂的是卡片那次的思维链。
    curAiReasoning(){ const q=this.cur; if(!q||this.aiX.id!==q.id)return '';
      return this.aiX.view==='concept' ? (this.aiX.cardsReasoning||'') : (this.aiX.reasoning||''); },
    curAiUsage(){ const q=this.cur; if(!q||this.aiX.id!==q.id)return null;
      return this.aiX.view==='concept' ? (this.aiX.cardsUsage||null) : (this.aiX.usage||null); },
    curAiChat(){ const q=this.cur; return (q && this.aiX.id===q.id && (this.aiX.view==='explain'||this.aiX.view==='concept')) ? (this.aiX.chat||[]) : []; },
    readerCanAi(){ return (this.ai.hasAI || !!(this.explainCfg.base&&this.explainCfg.key)) && !this.offline; },
    // 刷题类视图且有当前题时，移动端底部有固定「上/下一题」栏；回顶按钮需上移避开它
    hasBottomBar(){ return !!this.cur && ['practice','wrong','favorite'].includes(this.view); },
    // 任何全屏浮层/弹窗/沉浸阅读打开时，回顶按钮应隐藏，避免遮挡浮层内的操作按钮
    anyOverlayOpen(){ return !!(this.extractPreview&&this.extractPreview.open) || !!(this.bankEdit&&this.bankEdit.open) || !!(this.dup&&this.dup.open) || !!(this.reader&&this.reader.open) || !!(this.pdfv&&this.pdfv.open) || !!(this.rdAi&&this.rdAi.open) || !!(this.stealth&&this.stealth.hidden) || this.segActive; },
    // 从当前书的「目录页」解析出「章节标题 → 页码」列表，供内嵌目录导航（像 PDF 书签那样可点跳转）
    // 目录页判定：pageLabel 或正文里出现「目录」，且含多处「…… 数字」页码引导。解析不出则返回 []（回退按篇列目录）
    bookOutline(){ const b=this.currentBook; if(!b||!b.pages||!b.pages.length)return [];
      // 目录常跨多页：收集所有"像目录"的页并按顺序拼接，避免只取第一页导致后面章节丢失
      const isTocPage=(c)=>/目\s*录|CONTENTS/i.test(c.slice(0,40)) || (c.match(/\.{3,}\s*\d+/g)||[]).length>=4 || (c.match(/\u2026+\s*\d+/g)||[]).length>=4;
      const parts=[]; let started=false, gap=0;
      for(const m of b.pages){ const c=String(m.content_md||''); if(isTocPage(c)){ parts.push(c); started=true; gap=0; } else if(started){ gap++; if(gap>=2)break; } }
      return this.parseBookOutline(parts.join('\n')); },
    curAiModel(){ const q=this.cur; if(!q||this.aiX.id!==q.id)return ''; return this.aiX.view==='concept' ? (this.aiX.cardsModel||'') : (this.aiX.model||''); },
    curAllFlipped(){ const q=this.cur; if(!q||this.aiX.id!==q.id)return false; const cards=this.aiX.cards||[]; return cards.length>0 && cards.every((c,i)=>this.aiX.flip&&this.aiX.flip[i]); },
    mockPct(){ const t=this.mock.questions.length||1; return Math.round(this.mockResult.score/t*100); },
    streakDays(){ /* 🔥 连续学习天数：今天有记录从今天起算，否则从昨天起算 */
      const heat=(this.stats&&this.stats.heat)||[]; if(!heat.length)return 0;
      const set=new Set(heat.filter(h=>(h.n|0)>0).map(h=>h.d));
      const day=(off)=>{ const d=new Date(Date.now()-off*86400000); return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'); };
      let off=0; if(!set.has(day(0))){ if(!set.has(day(1)))return 0; off=1; }
      let n=0; while(n<=400 && set.has(day(off+n))) n++;
      return n; },
    examDaysLeft(){ if(!this.examDate)return null; const t=new Date(this.examDate+'T00:00:00'); if(isNaN(t))return null;
      const today=new Date(); today.setHours(0,0,0,0); return Math.round((t-today)/86400000); },
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
    cur(nc, oc){
      const nid=nc&&nc.id, oid=oc&&oc.id;
      if(nid===oid) return;
      if(oid && this.aiX.id===oid){
        const st=this.aiStates[oid] || (this.aiStates[oid]={ id:oid });
        st.view=this.aiX.view; st.text=this.aiX.text; st.chat=(this.aiX.chat||[]).slice(); st.model=this.aiX.model;
        st.cards=(this.aiX.cards||[]).slice(); st.cardsModel=this.aiX.cardsModel; st.flip={ ...(this.aiX.flip||{}) };
      }
      const jobs=this._aiJobs||{};
      const genE=!!jobs[nid+':e'], genC=!!jobs[nid+':c'];
      const s=nid?this.aiStates[nid]:null;
      if(s){
        const view=s.view|| (genC?'concept':'explain');
        const busy=(view==='concept'&&genC)||(view==='explain'&&genE);
        this.aiX={ id:nid, view:view, text:s.text||'', busy:busy, chat:(s.chat||[]).slice(), asking:false, model:s.model||'', cards:(s.cards||[]).slice(), cardsModel:s.cardsModel||'', flip:{ ...(s.flip||{}) }, reasoning:'', cardsReasoning:'', reasonOpen:true, usage:null, cardsUsage:null };
      } else {
        // 无会话缓存：从题目已存的 ai_cards 和 analysis 同时恢复（两者可共存）
        const savedCards = nc && Array.isArray(nc.ai_cards) && nc.ai_cards.length ? nc.ai_cards.slice() : [];
        const savedText = this._extractSavedAi(nc) || '';
        if(savedCards.length || savedText){
          const view = savedCards.length ? 'concept' : 'explain';
          this.aiX={ id:nid, view:view, text:savedText, busy:false, chat:[], asking:false, model:'', cards:savedCards, cardsModel:'', flip:{}, reasoning:'', reasonOpen:true };
          this.aiStates[nid]={ id:nid, view:view, text:savedText, chat:[], model:'', cards:savedCards, cardsModel:'', flip:{} };
        } else {
          this.aiX={ id:'', view:'', text:'', busy:false, chat:[], asking:false, model:'', cards:[], cardsModel:'', flip:{}, reasoning:'', reasonOpen:true };
        }
      }
    },
    theme(v){ localStorage.setItem('zb_theme',v); this.applyTheme(); },
    examDate(v){ try{ v?localStorage.setItem('zb_examdate',v):localStorage.removeItem('zb_examdate'); }catch(_){ } },
    dailyNewLimit(v){ try{ localStorage.setItem('zb_newlimit',String(v|0)); }catch(_){ } },
    appName(v){ const n=(v||'').trim()||'刷题文档'; document.title=n; localStorage.setItem('zb_appname',n); },
    'stealth.autoHide'(v){ localStorage.setItem('zb_autohide', v?'1':'0'); },
    'f.subject'(){ this.f.chapter=''; },
    'ingest.subject'(){ this.ingest.chapter=''; if(this.ingest.bookMode)this.ingest.source=this.makeSource(); },
    'ingest.chapter'(){ if(this.ingest.bookMode)this.ingest.source=this.makeSource(); },
    'ingest.bookName'(){ if(this.ingest.bookMode)this.ingest.source=this.makeSource(); },
    'ingest.pageNo'(){ if(this.ingest.bookMode)this.ingest.source=this.makeSource(); },
    'ingest.questionNo'(){ if(this.ingest.bookMode)this.ingest.source=this.makeSource(); },
    'ingest.bookMode'(v){ if(v)this.ingest.source=this.makeSource(); },
    view(v){ try{ localStorage.setItem('zb_view', v); }catch(_){ } this._syncHash(v); this.$nextTick(()=>this._syncTabStrip()); },
    mineruCfg:{ handler(){ this.saveMineruCfg(); }, deep:true },
    currentBookId(v){ try{ localStorage.setItem('zb_bookid', v); }catch(_){ } let p=0; try{ const s=localStorage.getItem('zb_readpos:'+v); if(s!=null)p=Math.max(0,parseInt(s,10)||0); }catch(_){ } this.bookIdx=p; this.bookTocOpen=false; this.genq.result=null; this.flashPageRender();
      // 书架只载入了元信息，翻到这本书才把它的正文补齐（目录标题/阅读/抽题都依赖 content_md）
      if(v)this.ensureBookContent(); },
    bookIdx(v){ this.genq.result=null; try{ if(this.currentBookId)localStorage.setItem('zb_readpos:'+this.currentBookId, String(v)); }catch(_){ } },
    booksMode(v){ try{ localStorage.setItem('zb_booksmode', v); }catch(_){ } if(v!=='pdf' && this.pdfv.open) this.pdfvClose(); if(v==='pdf' && this.pdfv.open) this.$nextTick(()=>{ if(this.pdfv.mode==='page'){ this.pdfvRenderSingle(); } else { this.pdfvSetupPages(false); } this.pdfvSetupThumbs(); }); },
  },
  methods:{
    // 从题目 analysis 里提取自动/手动保存的 AI 内容（"**AI 解析**"或"**知识点卡片**"段），用于切题时恢复到 AI 容器显示
    _extractSavedAi(q){ if(!q||!q.analysis)return ''; const a=String(q.analysis);
      const i=a.search(/\*\*(AI 解析|知识点卡片)\*\*/); if(i<0)return '';
      return a.slice(i).replace(/^\*\*(AI 解析|知识点卡片)\*\*\s*/,'').trim();
    },
    // 导航条在窄屏是横向滚动的（9 项，500px 宽只放得下 6 项）。两件事必须做：
    //  1) 切到靠右的项（Bank/Import/Settings）时把它滚进可视区 —— 否则手机上刷新进设置页，
    //     导航条停在最左边，看起来「什么都没选中」。
    //  2) 两侧加渐变遮罩提示还有内容 —— 滚动条被 scrollbar-width:none 藏了，
    //     不给提示的话用户根本不知道右边还有三项。
    // 用 scrollLeft 算术而不是 scrollIntoView：后者会连带滚动祖先，把整个页面顶走。
    _syncTabStrip(){ try{
      const t=document.querySelector('.tabs'); if(!t)return;
      const a=t.querySelector('.tab.active');
      if(a){ const tr=t.getBoundingClientRect(), ar=a.getBoundingClientRect();
        if(ar.left<tr.left+1 || ar.right>tr.right-1){
          t.scrollLeft += (ar.left-tr.left) - Math.max(0,(t.clientWidth-ar.width)/2);
        } }
      this._syncTabFade(t);
    }catch(_){ } },
    _syncTabFade(t){ try{
      t=t||document.querySelector('.tabs'); if(!t)return;
      const max=t.scrollWidth-t.clientWidth;
      t.classList.toggle('more-l', t.scrollLeft>2);
      t.classList.toggle('more-r', max>2 && t.scrollLeft<max-2);
    }catch(_){ } },
    applyTheme(){ const v=this.theme==='auto' ? ((window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light') : this.theme;
      document.documentElement.dataset.theme=v;
      try{ const m=document.getElementById('theme-color-dynamic'); if(m)m.setAttribute('content', v==='dark'?'#10141B':'#F5F6F2'); }catch(_){} },
    cycleTheme(){ this.theme = this.theme==='light'?'dark':(this.theme==='dark'?'auto':'light'); this.flash({light:'浅色主题',dark:'深色主题',auto:'跟随系统'}[this.theme]); },
    onScroll(){ const y=window.pageYOffset||document.documentElement.scrollTop||0;
      const show=y>600; if(show!==this.showTop)this.showTop=show;
      // 悬浮按钮跟随滚动方向：往下滚就给「到底部」，往上滚就给「回顶部」。
      // 长篇 AI 解析里「跳到底部」很实用（追问输入框和下一题都在最下面）。
      const last=this._lastScrollY||0;
      if(Math.abs(y-last)>8){
        const D=document.documentElement;
        const nearBottom=(D.scrollHeight-(y+window.innerHeight))<120;
        const down=y>last && !nearBottom;      // 已经贴底了就别再给「到底部」
        if(down!==this.scrollDown)this.scrollDown=down;
        this._lastScrollY=y;
      } },
    scrollBottom(){ const h=document.documentElement.scrollHeight;
      try{ window.scrollTo({top:h,behavior:'smooth'}); }catch(_){ window.scrollTo(0,h); } },
    scrollTop(){ try{ window.scrollTo({top:0,behavior:'smooth'}); }catch(_){ window.scrollTo(0,0); } },
bookReadPct(b){ try{ let i; if(this.currentBookId===b.key){ i=this.bookIdx; } else { const s=localStorage.getItem('zb_readpos:'+b.key); if(s==null)return ''; i=parseInt(s,10)||0; }
      if(!b.pages||!b.pages.length||i<=0)return ''; const pct=Math.min(100,Math.round((i+1)/b.pages.length*100));
      return pct>=100?'读完':('读到 '+pct+'%'); }catch(_){ return ''; } },
    async aiFetch(body, signal, onDelta){
      const stable = this.explainStable || body.stream===false;
      const isNet = (e)=> /Failed to fetch|NetworkError|HTTP2|PROTOCOL|stream|INTERNAL_ERROR|network|aborted/i.test((e&&e.message)||'') || (e&&e.name==='AbortError');
      const attempt = async (useStream, tries)=>{
        const ctrl = new AbortController();
        const onAbort = ()=>{ try{ ctrl.abort(); }catch(_){} };
        if(signal){ if(signal.aborted)onAbort(); else signal.addEventListener('abort', onAbort, {once:true}); }
        let watchdog = useStream ? setTimeout(onAbort, 25000) : null;
        let res;
        try{
          res = await fetch('/api/explain', { method:'POST', signal:ctrl.signal,
            headers:{ 'authorization':'Bearer '+this.token, 'content-type':'application/json' },
            body: JSON.stringify({ ...body, stream: useStream }) });
          if(watchdog){ clearTimeout(watchdog); watchdog=null; }
        }catch(e){
          if(watchdog){ clearTimeout(watchdog); watchdog=null; }
          if(signal && signal.aborted) throw e;
          if(useStream) return attempt(false, tries);
          if(isNet(e) && tries>0){ await new Promise(r=>setTimeout(r, tries===2?1000:3000)); return attempt(false, tries-1); }
          throw e;
        }
        if(!res.ok){ return { res, text:'', ok:false }; }
        // 读取实际模型和降级信息
        const headerModel = res.headers.get('x-ai-model')||'';
        const headerFallback = res.headers.get('x-ai-fallback')||'';
        if(headerModel && onDelta) onDelta({model:headerModel});
        if(headerFallback && onDelta) onDelta({fallback:headerFallback});
        const ct = res.headers.get('content-type')||'';
        if(useStream && ct.includes('text/event-stream') && res.body){
          let acc=''; this._thinkBuf=undefined; this._hasReasonField=false; const reader=res.body.getReader(); const dec=new TextDecoder(); let buf='';
          try{
            while(true){ const {done,value}=await reader.read(); if(done)break;
              buf+=dec.decode(value,{stream:true});
              let i; while((i=buf.indexOf('\n'))>=0){ const line=buf.slice(0,i).trim(); buf=buf.slice(i+1);
                if(!line.startsWith('data:'))continue; const p=line.slice(5).trim();
                if(!p||p==='[DONE]')continue; let j=null; try{ j=JSON.parse(p); }catch(_){ continue; }
                if(j.error) throw new Error(j.error.message||String(j.error));
                if(j.model && onDelta) onDelta({model:j.model});
                // include_usage 会在结束前补发一帧：choices 为空数组、只带 usage。
                // reasoning token 的字段名各家不一样，全都收一遍。
                if(j.usage && onDelta){ const u=j.usage;
                  const det=u.completion_tokens_details||u.output_tokens_details||{};
                  onDelta({ usage:{
                    prompt: u.prompt_tokens ?? u.input_tokens ?? null,
                    completion: u.completion_tokens ?? u.output_tokens ?? null,
                    reasoning: det.reasoning_tokens ?? u.reasoning_tokens ?? u.completion_tokens_reasoning ?? null,
                    total: u.total_tokens ?? null,
                  } }); }
                const dt=j.choices&&j.choices[0]&&j.choices[0].delta;
                const fr=j.choices&&j.choices[0]&&j.choices[0].finish_reason;
                if(fr && onDelta) onDelta({finish_reason:fr});
                // 推理模型思维链——兼容多种格式：
                // DeepSeek-R1: delta.reasoning_content
                // Grok/部分中转站: delta.reasoning
                // QwQ/某些适配层: delta.thinking 或 delta.think
                const rt=dt&&(dt.reasoning_content||dt.reasoning||dt.thinking||dt.think);
                if(rt){ this._hasReasonField=true; if(onDelta) onDelta({reasoning:rt}); }
                const t=dt&&dt.content;
                // <think> tag parsing: only for models that don't use reasoning fields, only at stream start
                if(t && !rt && !this._hasReasonField){
                  if(!this._thinkBuf && !acc && t.trimStart().startsWith('<think>')){ this._thinkBuf=''; }
                  if(typeof this._thinkBuf==='string'){
                    const end=t.indexOf('</think>');
                    if(end>=0){ this._thinkBuf+=t.slice(0,end); if(onDelta)onDelta({reasoning:this._thinkBuf}); this._thinkBuf=undefined;
                      const after=t.slice(end+8); if(after){ acc+=after; if(onDelta)onDelta({text:after, acc}); } }
                    else { this._thinkBuf+=t.replace('<think>',''); if(onDelta)onDelta({reasoning:t.replace('<think>','')}); }
                  } else { acc+=t; if(onDelta)onDelta({text:t, acc}); }
                } else if(t){ acc+=t; if(onDelta)onDelta({text:t, acc}); }
                } }
            return { res, text:acc, ok:true };
          }catch(e){
            if(signal && signal.aborted) throw e;
            if(onDelta) onDelta({reset:true, streamFallback:true});
            return attempt(false, tries);
          }
        }
        try{
          const d = await res.json();
          if(d && d.error) return { res, text:'', ok:false, errText:d.error };
          const txt = (d && d.text) || '';
          if(d && d.model && onDelta) onDelta({model:d.model});
          if(d && d.usage && onDelta){ const u=d.usage;
            const det=u.completion_tokens_details||u.output_tokens_details||{};
            onDelta({ usage:{
              prompt: u.prompt_tokens ?? u.input_tokens ?? null,
              completion: u.completion_tokens ?? u.output_tokens ?? null,
              reasoning: det.reasoning_tokens ?? u.reasoning_tokens ?? null,
              total: u.total_tokens ?? null,
            } }); }
          if(txt && onDelta) onDelta({text:txt, acc:txt, full:true});
          return { res, text:txt, ok:true };
        }catch(e){
          if(isNet(e) && tries>0){ await new Promise(r=>setTimeout(r, tries===2?1000:3000)); return attempt(false, tries-1); }
          throw e;
        }
      };
      return attempt(!stable, 2);
    },
    aiOv(vision){ // 全局 AI 中转站覆盖：随所有 AI 请求携带（成对生效；拍照/看图另带视觉模型）
  const e=this.explainCfg||{}; const o={};
  if(e.base&&e.key){ o.base_url=e.base; o.api_key=e.key; }
  if(e.model) o.model=e.model;
  // 输出上限：推理模型会把思维链算进 completion_tokens，默认值不够时用户可自己调大
  if(Number(e.maxTokens)>0) o.max_tokens=Math.floor(Number(e.maxTokens));
  if(vision && this.ocrCfg && (this.ocrCfg.model||'').trim()) o.vision_model=this.ocrCfg.model.trim();
  return o; },
flash(msg,err){ this.toast={msg,err:!!err}; clearTimeout(this.toastTimer); this.toastTimer=setTimeout(()=>this.toast=null,2600); },
scrollChatEnd(ref){ this.$nextTick(()=>{ const el=ref?this.$refs[ref]:null; if(!el)return; const list=el.closest?el.closest('.rai-list'):null; if(list)list.scrollTop=list.scrollHeight; }); },
_scrollRaiList(ref){ this.$nextTick(()=>{ const el=this.$refs[ref]; if(el) el.scrollTop=el.scrollHeight; }); },
subjName(v){ return SUBJ_MAP[v]||v; },
_syncHash(v){ try{ const want='#/'+v; if(location.hash!==want)location.hash=want; }catch(_){ } },
_viewFromHash(){ let h=''; try{ h=(location.hash||'').replace(/^#\/?/,''); }catch(_){ } h=(h.split('?')[0]||'').split('/')[0]; return ['practice','wrong','favorite','books','bank','ingest','mock','stats','settings'].includes(h)?h:''; },
onHashChange(){ const v=this._viewFromHash(); if(v && v!==this.view){ if(!this.token && v!=='settings')return; this.go(v); } },
go(v){
      const prev=this.view;
      // 记录当前视图滚动位置，切回来时恢复
      try{ scrollCache[prev]=window.pageYOffset||document.documentElement.scrollTop||0; }catch(_){}
      if(this.pdfv && this.pdfv.open && typeof this.pdfvClose==='function'){ this.pdfvClose(); }
      // 模考进行中离开 Test 页：暂停计时器、保存快照，回来时恢复
      if(prev==='mock' && this.mock.started && v!=='mock'){ clearInterval(this.mock.timer); this.mock.timer=null; this.mockSnapSave(); this.flash('模考已暂停，回到 Test 页继续'); }
      if(['practice','wrong','favorite'].includes(prev) && this.queue.length){
        qCache[prev]={ q:this.queue.slice(), i:this.qi, t:this.queueTotal, a:Object.assign({},this.sessionAns), bo:this.batchDone, lo:this.loadedOnce };
      }
      this.view=v;
      this._syncHash(v);
      try{ localStorage.setItem('zb_view',v); }catch(_){}
      if(v==='favorite' && this.fav.listMode){
        if(!this.meta.subjects.length)this.loadMeta();
        this.loading=false;
        if(!this.fav.loadedOnce || this.favDirty){ this.favDirty=false; this.loadFav(true); }
      } else if(['practice','wrong','favorite'].includes(v)){
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
      // 回到 Test 页时恢复进行中的模考计时器
      if(v==='mock' && this.mock.started && !this.mock.timer){ this._mockStartTimer(); this.flash('模考已恢复计时'); }
      // 恢复该视图上次滚动位置（切回来停在原处，而非顶部）
      const sy=scrollCache[v]||0;
      this.$nextTick(()=>{ requestAnimationFrame(()=>{ try{ window.scrollTo(0, sy); }catch(_){} }); });
    },
sleep(ms){ return new Promise(r=>setTimeout(r,ms)); },
typeName(t){ return ({single_choice:'单选',multiple_choice:'多选',true_false:'判断',fill_blank:'填空',short_answer:'简答',code:'代码'})[t]||t; },
stealthHide(){ this.stealth.hidden=true; },
stealthShow(){ this.stealth.hidden=false; },
onKey(e){ const tag=(e.target&&e.target.tagName)||'';
      if(this.stealth.hidden){ e.preventDefault(); this.stealth.hidden=false; return; }
      // Escape 关闭弹窗（优先级高于其它快捷键）
      if(e.key==='Escape'){
        if(this.bankEdit&&this.bankEdit.open){ this.bankCloseEdit(); return; }
        if(this.dup&&this.dup.open&&!this.dup.busy){ this.dup.open=false; return; }
        if(this.extractPreview&&this.extractPreview.open){ this.extractClose(); return; }
        if(this.pdfAi&&this.pdfAi.open){ this.pdfAi.open=false; return; }
        if(this.pdfv&&this.pdfv.open){ this.pdfvClose(); return; }
      }
      if(this.reader.open){ if(e.key==='Escape'){ if(this.reader.tocOpen){this.reader.tocOpen=false;return;} if(this.reader.panel){this.reader.panel=false;return;} this.readerClose(); return; } if(tag==='INPUT'||tag==='TEXTAREA')return; if(e.key==='ArrowRight'||e.key==='PageDown'||e.key===' '){ e.preventDefault(); this.readerNext(); return; } if(e.key==='ArrowLeft'||e.key==='PageUp'){ e.preventDefault(); this.readerPrev(); return; } return; }
      // —— 内联阅读器（Books 页但未进沉浸模式）的键盘翻页 ——
      // 必须放在上面 reader.open 分支之后：沉浸模式已经由那一段处理，
      // 若另起一个监听而不判断 reader.open，一次按键会同时 readerNext + bookNext，直接翻两页。
      if(this.view==='books' && !this.reader.open && this.currentBook
         && !e.metaKey && !e.ctrlKey && !e.altKey
         && tag!=='INPUT' && tag!=='TEXTAREA' && tag!=='SELECT' && !(e.target&&e.target.isContentEditable)
         && !this.bookTocOpen && !(this.rdAi&&this.rdAi.open)){
        if(e.key==='ArrowRight'||e.key==='PageDown'){ e.preventDefault(); this.bookNext(); return; }
        if(e.key==='ArrowLeft'||e.key==='PageUp'){ e.preventDefault(); this.bookPrev(); return; }
      }
      // —— 刷题快捷键（练习/错题/收藏视图；输入框聚焦或按住修饰键时不拦截）——
      if(['practice','wrong','favorite'].includes(this.view) && this.cur && !this.mock.started
         && !e.metaKey && !e.ctrlKey && !e.altKey && tag!=='INPUT' && tag!=='TEXTAREA' && tag!=='SELECT'){
        const card=this.$refs.curCard, k=e.key, kl=(k&&k.length===1)?k.toLowerCase():'';
        if(k==='ArrowLeft'){ e.preventDefault(); this.prev(); return; }
        if(k==='ArrowRight'){ e.preventDefault(); this.next(); return; }
        if(card){
          if(!card.revealed){
            if(card.isChoice){
              let key='';
              if(/^[a-h]$/.test(kl)) key=kl.toUpperCase();
              else if(/^[1-8]$/.test(kl)){ const o=(this.cur.options||[])[+kl-1]; key=o?o.key:''; }
              if(key && (this.cur.options||[]).some(o=>o.key===key)){ e.preventDefault(); card.pick(key); return; }
            } else if(this.cur.type==='true_false'){
              if(kl==='1'||kl==='t'){ e.preventDefault(); card.pickTF('T'); return; }
              if(kl==='2'||kl==='f'){ e.preventDefault(); card.pickTF('F'); return; }
            }
            if(k==='Enter'){ if(card.canSubmit()){ e.preventDefault(); card.submit(); } return; }
          } else {
            if(k==='Enter'){ e.preventDefault(); this.next(); return; }
            if(!AUTO.includes(this.cur.type) && card.self==null){
              if(kl==='1'){ e.preventDefault(); card.grade4('again'); return; }
              if(kl==='2'){ e.preventDefault(); card.grade4('hard'); return; }
              if(kl==='3'){ e.preventDefault(); card.grade4('good'); return; }
              if(kl==='4'){ e.preventDefault(); card.grade4('easy'); return; }
            }
            if(kl==='f'){ e.preventDefault(); card.toggleFav(); return; }
            if(kl==='m'){ e.preventDefault(); card.markMastered(); return; }
            if(kl==='e'){ e.preventDefault(); this.aiExplain(); return; }
            if(kl==='k'){ e.preventDefault(); this.aiExplain('concept'); return; }
          }
        }
      }
      if(e.key==='`'||e.key==='~'){ if(tag==='INPUT'||tag==='TEXTAREA')return; e.preventDefault(); this.stealth.hidden=true; } },
onBlur(){ if(this.stealth.autoHide) this.stealth.hidden=true; },
onFocus(){ if(this.stealth.autoHide) this.stealth.hidden=false; }
  },
  mounted(){ try{ window.__hideSplash&&window.__hideSplash(); }catch(_){}
    // 导航条：首屏就把激活项滚进可视区，并跟随滚动/尺寸变化更新渐变提示
    this.$nextTick(()=>{ this._syncTabStrip();
      try{ const t=document.querySelector('.tabs');
        if(t)t.addEventListener('scroll',()=>this._syncTabFade(t),{passive:true});
        window.addEventListener('resize',()=>this._syncTabStrip(),{passive:true});
      }catch(_){ } });
    if(this.token)this.settFold.token=true;
    try{ console.log('[shuati] 前端版本 '+APP_VERSION); }catch(_){}
    this.applyTheme(); document.title=this.appName;
    try{ this._mq=window.matchMedia('(prefers-color-scheme: dark)'); this._mqFn=()=>{ if(this.theme==='auto')this.applyTheme(); };
      this._mq.addEventListener?this._mq.addEventListener('change',this._mqFn):this._mq.addListener(this._mqFn); }catch(_){ }
    try{ const bp=JSON.parse(localStorage.getItem('zb_mock_bp')||'null'); if(bp&&Array.isArray(bp.rows)&&bp.rows.length)this.mock.bp={on:!!bp.on,rows:bp.rows.slice(0,8)}; }catch(_){ }
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('scroll', this.onScroll, { passive:true });
    document.addEventListener('click', this.settBlankClick, true);
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('focus', this.onFocus);
    try{ const oc=JSON.parse(localStorage.getItem('zb_ocrcfg')||'null'); if(oc&&typeof oc==='object'){ this.ocrCfg.model=oc.model||''; this.ocrCfg.base=oc.base||''; this.ocrCfg.key=oc.key||''; } }catch(_){}
    try{ const ec=JSON.parse(localStorage.getItem('zb_explaincfg')||'null'); if(ec&&typeof ec==='object'){ this.explainCfg.base=ec.base||''; this.explainCfg.key=ec.key||''; this.explainCfg.model=ec.model||''; } }catch(_){}
    try{ this.autoSaveAi = localStorage.getItem('zb_autosave_ai')==='1'; }catch(_){}
    try{ this.explainStable = localStorage.getItem('zb_explain_stable')==='1'; }catch(_){}
    try{ const mc=JSON.parse(localStorage.getItem('zb_mineru_cfg')||'null'); if(mc&&typeof mc==='object'){ if(mc.pageLimit!=null)this.mineruCfg.pageLimit=mc.pageLimit; if(mc.fileLimit!=null)this.mineruCfg.fileLimit=mc.fileLimit; this.mineruCfg.tokenExp=mc.tokenExp||''; this.mineruCfg.token=mc.token||''; } }catch(_){}
    this.mineruRefreshUsage();
    try{ if(localStorage.getItem('zb_mineru_tokenbad')==='1')this.mineruTokenBad=true; }catch(_){}
    if(this.token){ this.loadSubjects(); this.loadMeta(); this.loadConfig(); this.loadMaterials(); this.loadPdfShelf(); this.loadCfUsage();
      const restored=this.restoreSession();
      if(!restored) this.startSession();
      try{ const bm=localStorage.getItem('zb_booksmode'); if(bm==='notes'||bm==='pdf')this.booksMode=bm; }catch(_){ }
      try{ const sb=localStorage.getItem('zb_bookid'); if(sb)this.currentBookId=sb; }catch(_){ }
      if(restored){
        // 会话已恢复：保持恢复的视图与队列，仅同步地址栏 hash，不再走 go() 覆盖
        this._syncHash(this.view);
      } else {
        let startView=this._viewFromHash();
        if(!startView){ try{ const sv=localStorage.getItem('zb_view'); if(sv && sv!=='settings')startView=sv; }catch(_){ } }
        if(startView && startView!==this.view){ this.go(startView); } else { this._syncHash(this.view); }
      }
      this.$nextTick(()=>this.mineruResume());
    } else { this.view='settings'; }
    window.addEventListener('hashchange', this.onHashChange);
    try{ this.offline = (typeof navigator!=='undefined' && navigator.onLine===false); }catch(_){ }
    window.addEventListener('online', this._onOnline);
    window.addEventListener('offline', this._onOffline);
    // 模考断点续考：读取未完成的快照（横幅提示）；切后台/关页前抢救一次快照
    this.mockSaved=this.mockSnapPeek();
    window.addEventListener('pagehide', this._mockPagehide);
    document.addEventListener('visibilitychange', this._mockVis);
    // 会话持久化：PWA 被系统在后台回收/重载后，切回来仍能恢复队列与 AI 内容
    this._persistHandler=()=>{ try{ if(document.visibilityState==='hidden')this.persistSession(); }catch(_){} };
    document.addEventListener('visibilitychange', this._persistHandler);
    window.addEventListener('pagehide', ()=>{ try{ this.persistSession(); }catch(_){} });
    // 兜底：有积压的作答记录（离线或服务端 5xx 暂存的）每分钟尝试补传一次
    this._flushTimer=setInterval(()=>{ if(this.offlineQueued>0 && !this.offline)this._offFlush(); },60000);
    this._offQueueCount().then(n=>{ this.offlineQueued=n; if(n>0)this._offFlush(); }).catch(()=>{});
    this._loadOfflineSynced();
    // 开屏动画：等动画播完 + Vue 渲染完后淡出
    const sp=document.getElementById('splash'); if(sp){ const dismiss=()=>{ sp.classList.add('out'); setTimeout(()=>sp.remove(),600); }; const elapsed=performance.now(); const minTime=2000; if(elapsed>=minTime)dismiss(); else setTimeout(dismiss,minTime-elapsed); }
  },
  beforeUnmount(){ window.removeEventListener('keydown', this.onKey); window.removeEventListener('scroll', this.onScroll); document.removeEventListener('click', this.settBlankClick, true); window.removeEventListener('blur', this.onBlur); window.removeEventListener('focus', this.onFocus); window.removeEventListener('hashchange', this.onHashChange); window.removeEventListener('online', this._onOnline); window.removeEventListener('offline', this._onOffline); window.removeEventListener('pagehide', this._mockPagehide); document.removeEventListener('visibilitychange', this._mockVis); clearInterval(this._flushTimer); },
  template:APP_TEMPLATE
};

const app = createApp(App);
app.component('icon', Icon);
app.config.globalProperties.AUTO = AUTO;
app.config.globalProperties.OBJECTIVE = OBJECTIVE;
app.mount('#app');
