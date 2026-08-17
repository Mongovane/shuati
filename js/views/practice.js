// 刷题主流程：取题队列 / 筛选 / 作答 / 收藏 / 掌握 / 笔记
// —— 由 app.js 按功能域拆分而来；与其余 mixin 合并进同一个 Vue 实例，this.* 跨文件可用 ——
const PracticeMixin = { methods: {
async loadMeta(force){ if(!this.token)return;
      if(!force){ try{ const c=JSON.parse(localStorage.getItem('zb_meta_cache')||'null'); if(c&&c.ts&&Date.now()-c.ts<300000&&c.d){ this.meta=c.d; return; } }catch(_){} }
      try{ const d=await this.api('/api/questions?meta=1'); this.meta=d; try{localStorage.setItem('zb_meta_cache',JSON.stringify({d,ts:Date.now()}));}catch(_){} }catch(e){} },
qs(extra={}){ const p=new URLSearchParams();
      if(this.f.subject&&this.f.subject!=='all') p.set('subject',this.f.subject);
      if(this.f.chapter) p.set('chapter',this.f.chapter);
      if(this.f.type) p.set('type',this.f.type);
      if(this.f.tag&&this.f.tag.trim()) p.set('tag',this.f.tag.trim());
      p.set('order', this.sessionMode==='wrong' ? 'weak' : (this.sessionMode==='due' ? 'due' : this.f.order)); p.set('mode',this.sessionMode);
      Object.entries(extra).forEach(([k,v])=>p.set(k,v)); return p.toString();
    },
onFilter(){ if(this.filterLock)return; this.startSession(); },
async startSession(keep){ if(!this.token||this.loading)return;
      const forView=this.view;
      this.loading=true; this.batchDone=false; this.queue=[]; this.qi=0; this.sessionAns={}; this.qStates={}; this.aiStates={}; this.sessionView=this.view;
      this.reviewSession=null;  // 常规取题即离开「错题回顾」会话
      if(!keep){ this.sessionStart=Date.now(); this.streak=0; this.bestStreak=0; }
      const dedup=(arr)=>{ const m=new Map(); for(const q of (arr||[])){ if(q&&q.id!=null&&!m.has(q.id))m.set(q.id,q); } return [...m.values()]; };
      try{
        // light=1：不取 analysis / ai_cards。答题阶段不显示它们，揭晓时再按 id 补
        //（实测 30 题响应 220KB 里这两样占 94KB，骨架屏转很久主要是被它们拖的）
        const extra={limit:30, light:1}; if(keep && this.sessionMode!=='wrong' && this.sessionMode!=='due')extra.nocount=1; /* 复习视图(wrong/due)保持计数新鲜（集小，COUNT 便宜）*/
        const d=await this.api('/api/questions?'+this.qs(extra));
        if(this.view!==forView){ this.loading=false; return; }
        this.queue=dedup(d.items);
        if(!keep || d.total>0) this.queueTotal=(d.total!=null&&d.total>=0?d.total:this.queue.length);
        this.loadedOnce=true;
        this.qnavOpen=this.queue.length<=16;
        if(!this.queue.length){ this.batchDone=true;
          if(this.view==='wrong'){ try{ this.stats=await this.api('/api/progress'); this.statsDirty=false; }catch(_){ } } }
      }
      catch(e){ if(e.message!=='unauth')this.flash(e.message,true); }
      this.loading=false;
    },
// 按需补齐当前题的 analysis / ai_cards（列表用 light=1 没取）。
// 只在真的要看时发一次小请求，比每批多传 94KB 划算得多。
async ensureFullQuestion(q){
  if(!q || !q._lite || q._fullLoading || q._full)return;
  if(!q.has_analysis && !q.has_cards){ q._full=true; return; }   // 本来就没有，不用跑一趟
  q._fullLoading=true;
  try{
    const d=await this.api('/api/questions?ids='+encodeURIComponent(q.id)+'&limit=1');
    const full=(d.items||[])[0];
    if(full){ q.analysis=full.analysis||''; q.ai_cards=full.ai_cards||null; }
    q._full=true;
  }catch(e){ if(e.message==='unauth')throw e; }
  finally{ q._fullLoading=false; }
},
srcBook(s){ const t=String(s||'').split(' · ')[0].trim(); return t || '未知来源'; },
cleanPageMd(md){
      if(!md)return '';
      const lines=md.split('\n');
      // 去页眉：只处理前 3 行
      let start=0;
      for(let i=0;i<Math.min(3,lines.length);i++){
        const ln=lines[i].trim();
        if(!ln){ start=i+1; continue; }
        // 纯数字页码
        if(/^\d{1,4}$/.test(ln)){ start=i+1; continue; }
        // 居中装饰 · XXX · 或 • XXX •
        if(/^[·•]\s*[\u4e00-\u9fa5]+\s*[·•]$/.test(ln)){ start=i+1; continue; }
        // 纯中文无标点（6-22字）——大概率是重复书名页眉
        // 只在首 2 行检查，且必须 ≥6 字（避免误删短句如"解"、"证明"）
        if(i<2 && /^[\u4e00-\u9fa5]{6,22}$/.test(ln)){ start=i+1; continue; }
        break;
      }
      // 去脚注
      let end=lines.length;
      for(let i=lines.length-1;i>=Math.max(start,lines.length-6);i--){
        const ln=lines[i].trim();
        if(!ln){ end=i; continue; }
        if(/^[①②③④⑤⑥⑦⑧⑨⑩]/.test(ln)){ end=i; continue; }
        if(/^\d{1,4}$/.test(ln)){ end=i; continue; }
        break;
      }
      return lines.slice(start,end).join('\n').trim();
    },
prev(){ if(this.qi>0)this.qi--; },
onSaveState(p){ if(p&&p.id){ this.qStates[p.id]=p.state; } },
// —— 会话持久化：PWA 被系统在后台重载后，恢复队列/进度/作答/AI 内容 ——
persistSession(){
  try{
    if(!['practice','wrong','favorite'].includes(this.view) || !this.queue.length) return;
    // 先把当前显示题的 AI 内容存进 aiStates（含翻卡/追问最新态）
    if(this.aiX && this.aiX.id){
      const st=this.aiStates[this.aiX.id] || (this.aiStates[this.aiX.id]={ id:this.aiX.id });
      st.view=this.aiX.view; st.text=this.aiX.text; st.chat=(this.aiX.chat||[]).slice(); st.model=this.aiX.model;
      st.cards=(this.aiX.cards||[]).slice(); st.cardsModel=this.aiX.cardsModel; st.flip={ ...(this.aiX.flip||{}) };
    }
    const snap={ v:this.view, sv:this.sessionView, q:this.queue, i:this.qi, t:this.queueTotal, a:this.sessionAns, bo:this.batchDone, lo:this.loadedOnce, rs:this.reviewSession, qs:this.qStates, ai:this.aiStates, ts:Date.now() };
    let s=JSON.stringify(snap);
    // 体积保护：超 4MB 时丢弃 AI 内容（题目/进度更重要），仍超则不存
    if(s.length>4_000_000){ const lite={ ...snap, ai:{} }; s=JSON.stringify(lite); }
    if(s.length>4_500_000) return;
    localStorage.setItem('zb_session', s);
  }catch(_){}
},
restoreSession(){
  try{
    const raw=localStorage.getItem('zb_session'); if(!raw) return false;
    const snap=JSON.parse(raw); if(!snap||!Array.isArray(snap.q)||!snap.q.length) return false;
    // 超过 12 小时的旧会话不恢复（避免陈旧）
    if(snap.ts && Date.now()-snap.ts > 12*3600*1000){ localStorage.removeItem('zb_session'); return false; }
    if(!['practice','wrong','favorite'].includes(snap.v)) return false;
    this.queue=snap.q; this.qi=snap.i||0; this.queueTotal=snap.t||snap.q.length;
    this.sessionAns=snap.a||{}; this.batchDone=!!snap.bo; this.loadedOnce=!!snap.lo;
    this.reviewSession=snap.rs||null; this.qStates=snap.qs||{}; this.aiStates=snap.ai||{};
    this.sessionView=snap.sv||snap.v; this.view=snap.v; this.loading=false;
    // 恢复当前题的 AI 显示
    const cq=this.queue[this.qi];
    if(cq && this.aiStates[cq.id]){ const s=this.aiStates[cq.id]; this.aiX={ id:cq.id, view:s.view||'', text:s.text||'', busy:false, chat:(s.chat||[]).slice(), asking:false, model:s.model||'', cards:(s.cards||[]).slice(), cardsModel:s.cardsModel||'', flip:{ ...(s.flip||{}) } }; }
    return true;
  }catch(_){ return false; }
},
qnavCls(q,i){ const c=[]; if(i===this.qi)c.push('cur'); const a=this.sessionAns[q.id]; if(a===true)c.push('ok'); else if(a===false)c.push('bad'); else if(q.mastered)c.push('ok'); else if(q.wrong_count>0)c.push('bad'); else if(q.right_count>0)c.push('done'); else c.push('un'); return c; },
next(){ if(this.qi<this.queue.length-1){ this.qi++; return; }
      // 错题回顾是封闭集：翻到最后一题不再自动续拉普通题，而是结束会话回到常规错题本
      if(this.reviewSession){ this.flash('本次错题已回顾完毕'); this.exitReviewSession(); return; }
      this.startSession(true); },
async deleteCurrentQuestion(){ const q=this.cur; if(!q)return; if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } if(!confirm('这会从「题库」彻底删除这道题（不只是移出复习），且无法恢复。\n\n只是不想再复习它？请改用「移出复习」。\n\n确定要永久删除吗？'))return; try{ await this.api('/api/questions',{method:'DELETE',body:JSON.stringify({ids:[q.id]})}); this.queue.splice(this.qi,1); if(this.qi>this.queue.length-1)this.qi=Math.max(0,this.queue.length-1); if(!this.queue.length)this.batchDone=true; this.flash('已从题库删除本题'); this.loadMeta(true); this.statsDirty=true; this.bankDirty=true; }catch(e){ if(e.message!=='unauth')this.flash('删除失败：'+e.message,true); } },
// 移出复习：标记为已掌握，从待复习队列剔除，但题目保留在题库（可在设置/题库处找回）
async dropFromReview(){ const q=this.cur; if(!q)return; if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'master',question_id:q.id,value:1})});
        q.mastered=true;
        this.queue.splice(this.qi,1);
        delete this.sessionAns[q.id];
        if(this.reviewSession) this.reviewSession.count=this.queue.length;
        if(!this.queue.length){
          if(this.reviewSession){ this.flash('已移出，本次错题已清空'); this.exitReviewSession(); return; }
          this.batchDone=true;
        } else if(this.qi>this.queue.length-1){ this.qi=this.queue.length-1; }
        this.flash('已移出复习（标记为掌握，题目仍在题库）'); this.statsDirty=true;
        // 后台刷新一次统计：让顶栏 Review 徽标立刻跟着错题数下降，而不是停在旧值
        try{ this.stats=await this.api('/api/progress'); this.statsDirty=false; }catch(_){ }
      }catch(e){ if(e.message!=='unauth')this.flash('操作失败：'+e.message,true); } },
// 退出「错题回顾」独立会话，回到常规错题本
exitReviewSession(){ this.reviewSession=null; this.filterLock=false; this.startSession(); },
async setQuestionSubject(subj){ const q=this.cur; if(!q||!subj||subj===q.subject)return; if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } try{ await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids:[q.id],subject:subj})}); q.subject=subj; this.flash('已改为「'+this.subjName(subj)+'」'); this.loadMeta(true); this.bankDirty=true; }catch(e){ if(e.message!=='unauth')this.flash('改科目失败：'+e.message,true); } },
findQ(id){ return this.queue.find(q=>q.id===id)||(this.mock.questions||[]).find(q=>q.id===id); },
async onAnswered(p){
      // 取消自评：清除本题作答记录（答题卡圆点恢复灰色）
      if(p.cancel){ delete this.sessionAns[p.id]; return; }
      // 揭晓答案 = 马上要看参考解析了，这时才把 analysis / ai_cards 取回来。
      // 不 await：让计分和界面先走，解析到了自然渲染出来。
      { const q=(this.queue||[]).find(x=>x&&x.id===p.id); if(q)this.ensureFullQuestion(q).catch(()=>{}); }
      this.sessionAns[p.id]=p.correct; if(p.correct){ this.streak++; if(this.streak>this.bestStreak)this.bestStreak=this.streak; } else { this.streak=0; }
      if(p.partial) this.flash('多选少选：按半分计，已计入错题复习');
      this.countNewToday(p.id);
      try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'answer',question_id:p.id,is_correct:p.correct,grade:p.grade||undefined,duration_ms:p.ms||undefined})}); this.statsDirty=true; }catch(e){ if(e.message!=='unauth')this.flash('作答记录保存失败：'+e.message,true); } },
countNewToday(id){ /* 每日新题软上限：只提醒不硬拦，帮着把节奏留给复习 */
      if(!(this.dailyNewLimit>0))return; const q=this.findQ(id); if(!q||q._seen)return;
      if((q.right_count>0)||(q.wrong_count>0))return; q._seen=true;
      const d=new Date(); const today=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
      let day='',n=0; try{ day=localStorage.getItem('zb_newday')||''; n=parseInt(localStorage.getItem('zb_newcount')||'0',10)||0; }catch(_){ }
      if(day!==today){ day=today; n=0; }
      n++;
      try{ localStorage.setItem('zb_newday',day); localStorage.setItem('zb_newcount',String(n)); }catch(_){ }
      if(n===this.dailyNewLimit) this.flash('今日新题已达上限 '+this.dailyNewLimit+' 题，建议切到「今日待复习」巩固');
      else if(n>this.dailyNewLimit && (n-this.dailyNewLimit)%10===0) this.flash('已超今日新题上限（'+n+'/'+this.dailyNewLimit+'），注意复习消化'); },
async onFav(p){ const q=this.findQ(p.id); const prev=q&&q.favorited; if(q)q.favorited=p.value; this.flash(p.value?'已收藏':'已取消收藏'); this.favDirty=true; try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'favorite',question_id:p.id,value:p.value?1:0})}); }catch(e){ if(e.message!=='unauth'){ if(q)q.favorited=prev; this.flash('收藏保存失败，已撤回：'+e.message,true); } } },
async onMaster(p){ const q=this.findQ(p.id); const prev=q&&q.mastered; if(q)q.mastered=p.value; this.flash(p.value?'已标记为掌握':'已撤销'); this.statsDirty=true; this.favDirty=true; try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'master',question_id:p.id,value:p.value?1:0})}); }catch(e){ if(e.message!=='unauth'){ if(q)q.mastered=prev; this.flash('掌握状态保存失败，已撤回：'+e.message,true); } } },
async onNote(p){ const q=this.findQ(p.id); const prev=q&&q.note; if(q)q.note=p.note; this.flash('笔记已保存'); try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'note',question_id:p.id,note:p.note})}); }catch(e){ if(e.message!=='unauth'){ if(q)q.note=prev; this.flash('笔记保存失败，已撤回：'+e.message,true); } } }

,
// 解析 concept 返回的 JSON 卡片（极健壮：兼容各种模型的 JSON 输出怪癖）
_parseConceptCards(raw){ let s=String(raw||'').trim();
  // 1. 剥离所有代码围栏（可能有多层或不成对）
  s=s.replace(/```(?:json|javascript|js)?\s*/gi,'').replace(/```/g,'').trim();
  // 2. 提取数组或对象片段
  const a=s.indexOf('['), b=s.lastIndexOf(']');
  const c=s.indexOf('{'), d=s.lastIndexOf('}');
  if(a>=0 && b>a) s=s.slice(a,b+1);
  else if(c>=0 && d>c) s='['+s.slice(c,d+1)+']'; // 单对象 → 包成数组
  else return [];
  const tryParse=(str)=>{ try{ const r=JSON.parse(str); return Array.isArray(r)?r:(r&&typeof r==='object'?[r]:null); }catch(_){ return null; } };
  // 3. LaTeX 反斜杠修复
  const fixBackslash=(str)=> str.replace(/\\\\|\\u[0-9a-fA-F]{4}|\\([a-zA-Z])/g, (m,c)=> c ? '\\\\'+c : m);
  // 4. 尝试多级解析：原始 → 修反斜杠 → 修 key 引号 → 修尾逗号
  const fixKeys=(str)=> str.replace(/([{,]\s*)([a-zA-Z_]\w*)\s*:/g, '$1"$2":');
  const fixTrailing=(str)=> str.replace(/,\s*([}\]])/g, '$1');
  let arr = tryParse(fixBackslash(s)) || tryParse(s)
         || tryParse(fixKeys(fixBackslash(s))) || tryParse(fixTrailing(fixBackslash(s)))
         || tryParse(fixTrailing(fixKeys(fixBackslash(s))));
  // 5. 最后手段：尝试逐行提取多个 JSON 对象
  if(!arr){
    const objs=[]; const re=/\{[^{}]{10,}\}/g; let m;
    while((m=re.exec(s))!==null){ const o=tryParse(fixBackslash(m[0]))||tryParse(m[0]); if(o)objs.push(...o); }
    if(objs.length)arr=objs;
  }
  if(!arr||!arr.length)return [];
  // 后处理：给 plain / example 里裸露的数学符号自动补 $...$ 包裹 + 编号换行
  const wrapMath=(text)=>{
    if(!text)return text;
    // ①②③ 等编号前加换行，让条目分行显示
    text=text.replace(/([^\n])([①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮])/g, '$1\n\n$2');
    const parts=[]; let last=0, inside=false, i=0;
    while(i<text.length){
      if(text[i]==='$' && (i===0||text[i-1]!=='\\')){
        if(inside){ parts.push({t:text.slice(last,i+1),m:true}); last=i+1; inside=false; }
        else { if(last<i)parts.push({t:text.slice(last,i),m:false}); last=i; inside=true; }
      }
      i++;
    }
    if(last<text.length)parts.push({t:text.slice(last),m:inside});
    return parts.map(p=>{
      if(p.m)return p.t;
      return p.t
        .replace(/(?<!\$)(\b[a-zA-ZΦΨαβγδεζηθλμξρσφψω][a-zA-Z0-9_]*['′]?\s*\([^)]{1,30}\))(?!\$)/g, (m)=>'$'+m.trim()+'$')
        .replace(/(?<=[\u4e00-\u9fff\s，。；：、])([a-zA-ZΔΣΠαβγδεθλμξρσφψω][_0-9₀-₉]*)(?=[\u4e00-\u9fff\s，。；：、])/g, '$$$1$$')
        .replace(/(?<!\$)(\b[a-zA-Z][a-zA-Z0-9_]*\s*[><=≥≤≠]+\s*[0-9a-zA-Z]+)(?!\$)/g, '$$$1$$');
    }).join('');
  };
  return arr.filter(x=>x&&typeof x==='object'&&(x.term||x.plain)).slice(0,8).map(x=>({ term:String(x.term||'').trim()||'知识点', formula:String(x.formula||'').trim(), plain:wrapMath(String(x.plain||'').trim()), example:wrapMath(String(x.example||'').trim()) })); },
toggleCard(i){ const f={ ...(this.aiX.flip||{}) }; f[i]=!f[i]; this.aiX.flip=f; },
toggleAllCards(){ const cards=this.aiX.cards||[]; if(!cards.length)return; const allNow=cards.every((_,i)=>this.aiX.flip&&this.aiX.flip[i]); const f={}; if(!allNow){ cards.forEach((_,i)=>{ f[i]=true; }); } this.aiX.flip=f; },
async aiExplain(kind, force){ const q=this.cur; if(!q)return;
  if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
  const isConcept=kind==='concept';
  const qid=q.id;
  // 同题：若目标内容已生成且非强制重做，只切换显示、不重新请求
  // 切视图前，先从缓存把该题已生成的内容同步到 aiX（后台生成完但当时没在看这个视图的情况）
  const cache=this.aiStates[qid];
  if(cache){
    if(isConcept && cache.cards && cache.cards.length && (!this.aiX.cards || !this.aiX.cards.length)){ this.aiX.cards=cache.cards.slice(); this.aiX.cardsModel=cache.cardsModel||''; this.aiX.flip={ ...(cache.flip||{}) }; }
    if(!isConcept && cache.text && !this.aiX.text){ this.aiX.text=cache.text; this.aiX.model=cache.model||''; this.aiX.chat=(cache.chat||[]).slice(); }
  }
  if(this.aiX.id===qid && !force){
    if(isConcept && this.aiX.cards && this.aiX.cards.length){ this.aiX.view='concept'; this.aiX.busy=!!(this._aiJobs&&this._aiJobs[qid+':c']); return; }
    if(!isConcept && this.aiX.text){ this.aiX.view='explain'; this.aiX.busy=!!(this._aiJobs&&this._aiJobs[qid+':e']); return; }
  }
  // 该题该类型若已在生成中，仅切换显示（不重复发起）
  if(!this._aiJobs)this._aiJobs={};
  const jobKey=qid+':'+(isConcept?'c':'e');
  if(this._aiJobs[jobKey] && !force){ if(this.aiX.id===qid){ this.aiX.view=isConcept?'concept':'explain'; this.aiX.busy=true; } return; }
  // 确保 aiStates 有该题条目（承载后台生成结果，切题也不丢）
  const st=this.aiStates[qid] || (this.aiStates[qid]={ id:qid, view:'', text:'', chat:[], model:'', cards:[], cardsModel:'', flip:{} });
  st.view=isConcept?'concept':'explain';
  if(isConcept){ st.cards=[]; st.cardsModel=''; st.flip={}; } else { st.text=''; st.chat=[]; st.model=''; }
  // 若当前正显示这道题，把显示切过去并标记生成中
  const showing=()=> this.cur && this.cur.id===qid;
  // 思维链和用量按视图分开存：解题解析和知识点卡片是两套独立结果。
  // 以前 reasoning 是单一字段、usage 也是（我加的），于是生成完卡片再切回解析，
  // 解析标题下面挂的是卡片那次的思维链和用量 —— 和 model/cardsModel 的做法不一致。
  // 注意必须声明在函数作用域：下面 let acc 那行和流回调里都要用。
  const RK=isConcept?'cardsReasoning':'reasoning';
  const UK=isConcept?'cardsUsage':'usage';
  if(showing()){
    this.aiX.id=qid; this.aiX.view=st.view; this.aiX.busy=true; this.aiX.asking=false;
    this.aiX[RK]='';   // 思维链：每次生成从零开始，只存内存
    if(isConcept){ this.aiX.cards=[]; this.aiX.cardsModel=''; this.aiX.flip={}; if(this.aiX.text&&!force)this.flash('解题解析已保留，随时可切回'); }
    else { this.aiX.text=''; this.aiX.chat=[]; this.aiX.model=''; if(this.aiX.cards&&this.aiX.cards.length&&!force)this.flash('知识点卡片已保留，随时可切回'); }
  }
  const ctrl=new AbortController(); this._aiJobs[jobKey]=ctrl;
  const ov=this.aiOv();   // 统一走 aiOv：base/key 成对生效 + model + 输出上限，避免各处内联拼漏字段
  let acc=''; if(this.aiX.id===qid)this.aiX[UK]=null;
  // 自动续写：正文被 token 上限截断时接着写，而不是甩给用户一句「可追问请继续」。
  // 两种截断都要接住：
  //   ① 正文写了一半被截 → finish_reason=length 且已有正文
  //   ② 推理模型把预算全花在思维链上，正文一个字都没有 → length 且正文为空
  //      （旧代码在这里直接 throw「模型没有返回内容」，连同整段思维链一起丢掉）
  const MAX_CONT=3;
  let cont=0, truncated=false, kickoff=false;
  // d.acc 是「这一次请求」的累加器，续写轮会从 0 重新累加。
  // 直接 st.text=d.acc 会把前半段覆盖掉，所以要记住已写部分作为前缀。
  let contBase='';
  const question={ stem:q.stem, passage:q.passage, options:q.options, answer:q.answer, type:q.type, subject:q.subject };
  try{
    let r;
    do{
      truncated=false;
      const body={ ...ov, ...(isConcept?{kind:'concept'}:{}), question };
      contBase = cont>0 ? (isConcept?acc:(st.text||'')) : '';
      if(cont>0){ if(kickoff)body.continue_kickoff=1; else body.continue_from=contBase.slice(-6000); }
      r=await this.aiFetch(body, ctrl.signal,
      (d)=>{
        // 思维链只写 aiX（内存），不写 st（aiStates 缓存），因此切题/刷新即消失，也不会被自动保存写库
        if(d.reasoning && showing()){ this.aiX[RK]=(this.aiX[RK]||'')+d.reasoning; }
        if(d.reset && showing()){ this.aiX[RK]=''; }
        if(d.fallback && showing()){ this.flash('⚠ 模型 '+d.fallback+' 不可用，已降级到 '+(d.model||'备选模型')); }
        if(d.streamFallback && showing()){ this.flash('流式中断，已切换为一次性返回'); }
        // 跑飞被拦下：告诉用户为什么停了，否则会以为是网络断了
        if(d.runawayStop && showing()){ truncated=false;   // 别再自动续写，续了还是会打转
          this.flash(d.runawayStop==='loop' ? '⚠ 模型开始重复输出，已自动停止（已生成的内容保留）'
                                            : '⚠ 输出过长已自动停止（已生成的内容保留）', true); }
        // 用量：累加各轮（含续写轮），让「谁吃掉了预算」变成可观测的数字而不是推测
        if(d.usage && showing()){ const u=d.usage; const a=this.aiX[UK]||{prompt:0,completion:0,reasoning:0,rounds:0};
          this.aiX[UK]={ prompt:(a.prompt||0)+(u.prompt||0), completion:(a.completion||0)+(u.completion||0),
            reasoning:(a.reasoning||0)+(u.reasoning||0), rounds:(a.rounds||0)+1 }; }
        if(isConcept){ if(d.model){ st.cardsModel=d.model; if(showing())this.aiX.cardsModel=d.model; } if(d.text)acc=contBase+d.acc; }
        else { if(d.model){ st.model=d.model; if(showing())this.aiX.model=d.model; } if(d.text){ st.text=contBase+d.acc; if(showing()&&this.aiX.view==='explain')this.aiX.text=st.text; } }
        // 正文开始输出 → 自动收起思维链（用户想看再点开）
        if(d.text && showing() && this.aiX.reasonOpen && (this.aiX[RK]||'').length) this.aiX.reasonOpen=false;
        // 被截断 → 记下来，退出流后自动续写（不再要求用户手动追问「请继续」）
        if(d.finish_reason==='length') truncated=true;
      });
      if(r.res && r.res.status===401)break;
      if(!r.ok)break;
      if(!truncated || cont>=MAX_CONT)break;
      // 正文一个字都没有 = 预算被思维链吃光，下一轮让它跳过思考直接给结论
      kickoff = isConcept ? !acc : !st.text;
      cont++;
      // 文案保持中性：正文为空 + finish_reason=length 只能说明「撞了某个上限」，
      // 至于是 reasoning 吃掉了 completion 额度还是中转站截流，要看 usage 才知道。
      if(showing())this.flash(kickoff
        ? ('只输出了推理、正文为空（已达输出上限），正在直接索取正文…（'+cont+'/'+MAX_CONT+'）')
        : ('正文较长，正在自动续写…（'+cont+'/'+MAX_CONT+'）'));
    }while(cont<=MAX_CONT);
    if(r.res && r.res.status===401){ this.token=''; localStorage.removeItem('zb_token'); this.go('settings'); throw new Error('访问码无效'); }
    if(!r.ok){ let msg=r.errText||''; if(!msg){ try{ const d=await r.res.json(); msg=(d&&d.error)||('HTTP '+r.res.status); }catch(_){ msg='HTTP '+(r.res?r.res.status:'?'); } } throw new Error(msg); }
    if(isConcept){
      let cards=this._parseConceptCards(acc);
      // 首次解析失败 → 自动重试一次（某些模型第一轮输出不稳定但第二轮能成功）
      if(!cards.length && !force && !this._conceptRetried){
        this._conceptRetried=true; if(showing())this.flash('卡片解析失败，自动重试中…');
        return this.aiExplain('concept', true);
      }
      this._conceptRetried=false;
      if(!cards.length) throw new Error('知识点卡片生成失败，可点重试');
      st.cards=cards; if(showing()&&this.aiX.view==='concept')this.aiX.cards=cards;
    }
    else if(!st.text){
      // 区分「真没输出」和「思考占满预算」——后者续写 MAX_CONT 轮仍为空才算失败，
      // 提示也要说清是哪种情况，否则用户只会反复换模型而问题依旧。
      if(cont>=MAX_CONT && (this.aiX[RK]||'').length){
        const u=this.aiX[UK];
        const detail=u&&u.completion ? ('（本次用量：输出 '+u.completion+' token'+(u.reasoning?('，其中推理 '+u.reasoning):'')+'）') : '';
        throw new Error(MAX_CONT+' 轮都只有推理、没有正文'+detail+'。可在「设置 → AI 解析」里换一个非推理模型再试');
      }
      throw new Error('模型没有返回内容，可换个模型再试');
    }
  }catch(e){ if(e.name!=='AbortError'){ this._conceptRetried=false; let msg=e.message||'未知错误'; if(/429/.test(msg))msg+='（中转站限流，稍等几秒再重试）'; else if(/Failed to fetch|NetworkError|HTTP2|PROTOCOL|stream/i.test(msg))msg='网络异常，请检查网络后重试'; this.flash((isConcept?'知识点生成失败：':'AI 解析失败：')+msg,true); if(showing()&&this.aiX.busy)this.aiX.busy=false; if(this._aiJobs[jobKey]===ctrl)delete this._aiJobs[jobKey]; return; } }
  if(this._aiJobs[jobKey]===ctrl) delete this._aiJobs[jobKey];
  // 生成完成：结果已在 st（aiStates）里；若仍在显示这道题，同步结束态
  if(showing() && this.aiX.id===qid){ if(!this._aiJobs[qid+':e'] && !this._aiJobs[qid+':c'])this.aiX.busy=false; else if((isConcept&&this.aiX.view==='concept')||(!isConcept&&this.aiX.view==='explain'))this.aiX.busy=false; }
  // 自动保存（默认关）：生成成功后静默存入题目，不打扰
  if(this.autoSaveAi){ try{ if(isConcept){ if(st.cards&&st.cards.length)await this._autoSaveConcept(qid, st.cards); } else { if(st.text)await this._autoSaveExplain(qid, st.text, st.chat); } }catch(_){} }
},
// 自动保存 AI 解析到题目「解析」字段（静默，供 autoSaveAi 用）
async _autoSaveExplain(qid, text, chat){ const q=this.findQ(qid); if(!q||!text)return; if(q._aiSaved)return;
  let aiBlock='**AI 解析**\n\n'+String(text).trim();
  const cs=(chat||[]).filter(c=>c.a&&!c.a.startsWith('_回答失败'));
  if(cs.length){ aiBlock+='\n\n**追问记录**\n\n'+cs.map(c=>'> '+c.q+'\n\n'+c.a.trim()).join('\n\n'); }
  // 已有 AI 解析段时替换而非追加（防止刷新后重新生成导致无限膨胀）
  const existing=String(q.analysis||'').trim();
  const aiIdx=existing.search(/\*\*AI 解析\*\*/);
  let merged; if(aiIdx>0){ merged=existing.slice(0,aiIdx).replace(/\n*---\s*$/, '').trim()+'\n\n---\n\n'+aiBlock; } else if(aiIdx===0){ merged=aiBlock; } else { merged=(existing?existing+'\n\n---\n\n':'')+aiBlock; }
  await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids:[qid],analysis:merged})}); q.analysis=merged; q._aiSaved=true; this.bankDirty=true;
},
// 自动保存知识点卡片（转 markdown 追加到题目「解析」）
async _autoSaveConcept(qid, cards){ const q=this.findQ(qid); if(!q||!cards||!cards.length)return; if(q._conceptSaved)return;
  await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids:[qid],ai_cards:cards})}); q.ai_cards=cards.slice(); q._conceptSaved=true; this.bankDirty=true;
},
async aiSaveToAnalysis(){ const q=this.cur; if(!q || this.aiX.id!==q.id || !this.aiX.text)return;
  let merged=(q.analysis?String(q.analysis).trim()+'\n\n---\n\n':'')+'**AI 解析**\n\n'+this.aiX.text.trim();
  const chat=(this.aiX.chat||[]).filter(c=>c.a&&!c.a.startsWith('_回答失败'));
  if(chat.length){ merged+='\n\n**追问记录**\n\n'+chat.map(c=>'> '+c.q+'\n\n'+c.a.trim()).join('\n\n'); }
  try{ await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids:[q.id],analysis:merged})});
    q.analysis=merged; this.bankDirty=true; this.flash('已保存进本题解析（可在 Bank 编辑中查看）');
  }catch(e){ if(e.message!=='unauth')this.flash('保存失败：'+e.message,true); }
}


,
async aiAsk(text){ const q=this.cur; if(!q||this.aiX.id!==q.id)return; if(!this.aiX.text && !(this.aiX.cards&&this.aiX.cards.length))return;
  if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
  if(this._aiCtrl){ try{ this._aiCtrl.abort(); }catch(_){} }
  const ctrl=new AbortController(); this._aiCtrl=ctrl;
  if(!Array.isArray(this.aiX.chat))this.aiX.chat=[];
  // Vue 3 的坑：push 进响应式数组的是「原始对象」，数组下标读出来的才是代理。
  // 原来这里一直在改 push 之前的那个原始引用（entry.a=d.acc），改的是代理背后的
  // target，绕开了 setter，依赖收集完全不触发 —— 所以追问看不到流式，
  // 只有最后 asking=false 触发整体重渲染时文字才「啪」地一次性出现。
  // 必须拿 push 之后的代理来改。
  // 追问归属哪个视图：解题解析和知识点卡片是两条独立的线程。
  // 以前 chat 是一条共享数组，在解析里追问完切到卡片，那些问答照样显示在卡片下面，
  // 而输入框的占位符写着「对知识点卡片有疑问？」—— 上下文和界面在自相矛盾。
  const kind=(this.aiX.view==='concept')?'concept':'explain';
  this.aiX.chat.push({ q:text, a:'', r:'', kind });
  const entry=this.aiX.chat[this.aiX.chat.length-1];
  this.aiX.asking=true;
  // 方案 A：历史放宽到最近 10 条（5 轮），单条轻度截断防爆炸，不做总量一刀切
  // 历史只带同一视图的轮次，否则卡片的追问会把解析的问答当上下文
  const sameKind=this.aiX.chat.slice(0,-1).filter(c=>((c.kind||'explain')===kind));
  const history=[]; for(const c of sameKind.slice(-5)){
    history.push({role:'user',content:String(c.q||'').slice(0,3000)});
    if(c.a&&!c.err)history.push({role:'assistant',content:String(c.a).slice(0,4000)});
  }
  const ov=this.aiOv();   // 统一走 aiOv：base/key 成对生效 + model + 输出上限，避免各处内联拼漏字段
  // 构建上下文：explain 用 aiX.text，concept 用卡片序列化
  // 上下文必须跟着当前视图走。原来是 `aiX.text || cards`，只要生成过解析就永远优先用解析——
  // 于是在卡片视图里问「这张卡片的 not only 倒装怎么用」，模型收到的其实是解题解析，
  // 卡片内容它压根没看见。
  const cardsCtx=()=>(this.aiX.cards||[]).map((c,i)=>'【'+(i+1)+'】'+c.term+(c.formula?' '+c.formula:'')+'：'+c.plain+(c.example?' 例：'+c.example:'')).join('\n');
  let analysisCtx = kind==='concept' ? (cardsCtx() || this.aiX.text || '') : (this.aiX.text || cardsCtx());
  const isCtxErr=(m)=>/context[_\s-]*length|context window|maximum context|max(?:imum)?[_\s-]*tokens|too many tokens|reduce the length|too long|上下文|请求(?:体|内容)?过长|token\s*数(?:超|过)/i.test(m||'');
  // 方案 B：上下文超限时递增 trim_level 自动缩减历史重试（最多 2 次）
  let done=false, askTruncated=false, askCont=0;
  const ASK_MAX_CONT=2;
  for(let trimLevel=0; trimLevel<=2 && !done; trimLevel++){
    try{
      if(trimLevel>0){ entry.a=''; this.flash('上下文较长，正在精简后重试…'); }
      const r=await this.aiFetch({ ...ov, question:{ stem:q.stem, passage:q.passage, options:q.options, answer:q.answer, type:q.type, subject:q.subject }, analysis:analysisCtx.slice(0,6000), history, ask:text, trim_level:trimLevel }, ctrl.signal,
        (d)=>{
          if(d.reset){ entry.a=''; entry.r=''; }
          // 追问以前整个丢掉了 d.reasoning，所以有推理能力的模型在追问里看不到思维链
          if(d.reasoning)entry.r=(entry.r||'')+d.reasoning;
          if(d.text)entry.a=d.acc;
          if(d.fallback)this.flash('⚠ 模型 '+d.fallback+' 不可用，已降级到 '+(d.model||'备选模型'));
          if(d.streamFallback)this.flash('流式中断，已切换为一次性返回');
          if(d.finish_reason==='length')askTruncated=true;
        });
      if(r.res && r.res.status===401){ this.token=''; localStorage.removeItem('zb_token'); this.go('settings'); throw new Error('访问码无效'); }
      if(!r.ok){ let msg=r.errText||''; if(!msg){ try{ const d=await r.res.json(); msg=(d&&d.error)||('HTTP '+r.res.status); }catch(_){ msg='HTTP '+(r.res?r.res.status:'?'); } }
        if(isCtxErr(msg) && trimLevel<2){ continue; } // 上下文超限 → 下一级 trim 重试
        throw new Error(msg); }
      // 追问同样自动续写：被 token 上限截断就接着写，不要求用户手动打「请继续」
      while(askTruncated && askCont<ASK_MAX_CONT && !ctrl.signal.aborted){
        askCont++; askTruncated=false;
        this.flash('回答较长，正在自动续写…（'+askCont+'/'+ASK_MAX_CONT+'）');
        const base=entry.a||'';
        const r2=await this.aiFetch({ ...ov, question:{ stem:q.stem, passage:q.passage, options:q.options, answer:q.answer, type:q.type, subject:q.subject },
          analysis:analysisCtx.slice(0,6000), history, ask:text, trim_level:trimLevel,
          continue_from:base.slice(-6000) }, ctrl.signal,
          (d)=>{
            if(d.reasoning)entry.r=(entry.r||'')+d.reasoning;
            if(d.text)entry.a=base+d.acc;
            if(d.finish_reason==='length')askTruncated=true;
          });
        if(!r2 || !r2.ok)break;
      }
      if(!entry.a){ entry.a='_（模型没有返回内容）_'; }
      done=true;
    }catch(e){ if(e.name==='AbortError'){ done=true; break; }
      let msg=e.message||'未知错误';
      if(isCtxErr(msg) && trimLevel<2){ continue; }
      if(/429/.test(msg))msg+='（中转站限流，稍等几秒再重试）'; else if(/Failed to fetch|NetworkError|HTTP2|PROTOCOL|stream/i.test(msg))msg='网络异常，请检查网络后重试';
      entry.a='_回答失败：'+msg+'_'; entry.err=true; this.flash('追问失败：'+msg,true); done=true;
    }
  }
  if(this.aiX.id===q.id) this.aiX.asking=false;
  if(this._aiCtrl===ctrl) this._aiCtrl=null;
},
aiNoteFromChat(p){ const q=this.cur; if(!q||!p||!p.a)return;
  const add='**'+p.q.trim()+'**\n\n'+p.a.trim();
  const note=(q.note?String(q.note).trim()+'\n\n---\n\n':'')+add;
  this.onNote({ id:q.id, note }); // 复用既有保存链路：本地更新 + POST progress + 提示
}


,
aiStopAsk(){ if(this._aiCtrl){ try{ this._aiCtrl.abort(); }catch(_){} this._aiCtrl=null; } this.aiX.asking=false; this.flash('已停止生成'); },
aiClearChat(){ const kind=(this.aiX.view==='concept')?'concept':'explain';
  const mine=(this.aiX.chat||[]).filter(c=>((c.kind||'explain')===kind));
  if(!mine.length)return;
  const label=kind==='concept'?'知识点卡片':'解题解析';
  if(!confirm('清空「'+label+'」下的 '+mine.length+' 条追问记录？（另一个视图的追问和解析本身都不受影响）'))return;
  const keep=(this.aiX.chat||[]).filter(c=>((c.kind||'explain')!==kind));
  this.aiX.chat=keep; const st=this.aiStates[this.aiX.id]; if(st)st.chat=keep.slice();
  this.flash(label+'的追问记录已清空'); },
aiRetryAsk(i){ const list=this.aiX.chat||[]; const c=list[i];
  if(!c || this.aiX.asking) return;
  const q=c.q; list.splice(i,1);
  return this.aiAsk(q);
}

} };
