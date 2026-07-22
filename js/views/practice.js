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
async startSession(keep){ if(!this.token)return;
      const forView=this.view;
      this.loading=true; this.batchDone=false; this.queue=[]; this.qi=0; this.sessionAns={}; this.sessionView=this.view;
      this.reviewSession=null;  // 常规取题即离开「错题回顾」会话
      if(!keep){ this.sessionStart=Date.now(); this.streak=0; this.bestStreak=0; }
      const dedup=(arr)=>{ const m=new Map(); for(const q of (arr||[])){ if(q&&q.id!=null&&!m.has(q.id))m.set(q.id,q); } return [...m.values()]; };
      try{
        const extra={limit:30}; if(keep && this.sessionMode!=='wrong' && this.sessionMode!=='due')extra.nocount=1; /* 复习视图(wrong/due)保持计数新鲜（集小，COUNT 便宜）*/
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
      if(this.view===forView) this.loading=false;
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
async onAnswered(p){ this.sessionAns[p.id]=p.correct; if(p.correct){ this.streak++; if(this.streak>this.bestStreak)this.bestStreak=this.streak; } else { this.streak=0; }
      if(p.partial) this.flash('多选少选：按半分计，已计入错题复习');
      this.countNewToday(p.id);
      try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'answer',question_id:p.id,is_correct:p.correct,grade:p.grade||undefined,duration_ms:p.ms||undefined})}); }catch(e){ if(e.message!=='unauth')this.flash('作答记录保存失败：'+e.message,true); } },
countNewToday(id){ /* 每日新题软上限：只提醒不硬拦，帮着把节奏留给复习 */
      if(!(this.dailyNewLimit>0))return; const q=this.findQ(id); if(!q||q._seen)return;
      if((q.right_count>0)||(q.wrong_count>0))return; q._seen=true;
      const d=new Date(); const today=d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
      let day='',n=0; try{ day=localStorage.getItem('zb_newday')||''; n=parseInt(localStorage.getItem('zb_newcount')||'0',10)||0; }catch(_){ }
      if(day!==today){ day=today; n=0; }
      n++;
      try{ localStorage.setItem('zb_newday',day); localStorage.setItem('zb_newcount',String(n)); }catch(_){ }
      if(n===this.dailyNewLimit) this.flash('今日新题已达上限 '+this.dailyNewLimit+' 题，建议切到「今日待复习」巩固 💪');
      else if(n>this.dailyNewLimit && (n-this.dailyNewLimit)%10===0) this.flash('已超今日新题上限（'+n+'/'+this.dailyNewLimit+'），注意复习消化'); },
async onFav(p){ const q=this.findQ(p.id); if(q)q.favorited=p.value; this.flash(p.value?'已收藏':'已取消收藏'); this.favDirty=true; try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'favorite',question_id:p.id,value:p.value?1:0})}); }catch(e){ if(e.message!=='unauth')this.flash('收藏保存失败：'+e.message,true); } },
async onMaster(p){ const q=this.findQ(p.id); if(q)q.mastered=p.value; this.flash(p.value?'已标记为掌握':'已撤销'); try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'master',question_id:p.id,value:p.value?1:0})}); }catch(e){ if(e.message!=='unauth')this.flash('掌握状态保存失败：'+e.message,true); } },
async onNote(p){ const q=this.findQ(p.id); if(q)q.note=p.note; this.flash('笔记已保存'); try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'note',question_id:p.id,note:p.note})}); }catch(e){ if(e.message!=='unauth')this.flash('笔记保存失败：'+e.message,true); } }

,
async aiExplain(kind){ const q=this.cur; if(!q)return;
  if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
  if(this._aiCtrl){ try{ this._aiCtrl.abort(); }catch(_){} }
  const ctrl=new AbortController(); this._aiCtrl=ctrl;
  const isConcept=kind==='concept';
  this.aiX={ id:q.id, text:'', busy:true, chat:[], asking:false, model:'', kind:isConcept?'concept':'' };
  const ov={ ...( (this.explainCfg&&this.explainCfg.base)?{base_url:this.explainCfg.base,api_key:this.explainCfg.key}:{} ), ...( (this.explainCfg&&this.explainCfg.model)?{model:this.explainCfg.model}:{} ) };
  try{
    const r=await this.aiFetch({ ...ov, ...(isConcept?{kind:'concept'}:{}), question:{ stem:q.stem, passage:q.passage, options:q.options, answer:q.answer, type:q.type, subject:q.subject } }, ctrl.signal,
      (d)=>{ if(this.aiX.id!==q.id)return; if(d.reset)this.aiX.text=''; if(d.model)this.aiX.model=d.model; if(d.text)this.aiX.text=d.acc; });
    if(r.res && r.res.status===401){ this.token=''; localStorage.removeItem('zb_token'); this.go('settings'); throw new Error('访问码无效'); }
    if(!r.ok){ let msg=r.errText||''; if(!msg){ try{ const d=await r.res.json(); msg=(d&&d.error)||('HTTP '+r.res.status); }catch(_){ msg='HTTP '+(r.res?r.res.status:'?'); } } throw new Error(msg); }
    if(this.aiX.id===q.id && !this.aiX.text) throw new Error('模型没有返回内容，可换个模型再试');
  }catch(e){ if(e.name!=='AbortError' && this.aiX.id===q.id){ let msg=e.message||'未知错误'; if(/429/.test(msg))msg+='（中转站限流，稍等几秒再重试）'; else if(/Failed to fetch|NetworkError|HTTP2|PROTOCOL|stream/i.test(msg))msg='网络异常，请检查网络后重试'; this.flash('AI 解析失败：'+msg,true); } }
  if(this.aiX.id===q.id) this.aiX.busy=false;
  if(this._aiCtrl===ctrl) this._aiCtrl=null;
},
async aiSaveToAnalysis(){ const q=this.cur; if(!q || this.aiX.id!==q.id || !this.aiX.text)return;
  let merged=(q.analysis?String(q.analysis).trim()+'\n\n---\n\n':'')+'**AI 解析**\n\n'+this.aiX.text.trim();
  const chat=(this.aiX.chat||[]).filter(c=>c.a&&!c.a.startsWith('_回答失败'));
  if(chat.length){ merged+='\n\n**追问记录**\n\n'+chat.map(c=>'> 🙋 '+c.q+'\n\n'+c.a.trim()).join('\n\n'); }
  try{ await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids:[q.id],analysis:merged})});
    q.analysis=merged; this.bankDirty=true; this.flash('已保存进本题解析（可在 Bank 编辑中查看）');
  }catch(e){ if(e.message!=='unauth')this.flash('保存失败：'+e.message,true); }
}


,
async aiAsk(text){ const q=this.cur; if(!q||this.aiX.id!==q.id||!this.aiX.text)return;
  if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
  if(this._aiCtrl){ try{ this._aiCtrl.abort(); }catch(_){} }
  const ctrl=new AbortController(); this._aiCtrl=ctrl;
  if(!Array.isArray(this.aiX.chat))this.aiX.chat=[];
  const entry={ q:text, a:'' }; this.aiX.chat.push(entry); this.aiX.asking=true;
  const history=[]; for(const c of this.aiX.chat.slice(0,-1)){ history.push({role:'user',content:c.q}); if(c.a&&!c.err)history.push({role:'assistant',content:c.a}); }
  const ov={ ...( (this.explainCfg&&this.explainCfg.base)?{base_url:this.explainCfg.base,api_key:this.explainCfg.key}:{} ), ...( (this.explainCfg&&this.explainCfg.model)?{model:this.explainCfg.model}:{} ) };
  try{
    const r=await this.aiFetch({ ...ov, question:{ stem:q.stem, passage:q.passage, options:q.options, answer:q.answer, type:q.type, subject:q.subject }, analysis:this.aiX.text.slice(0,6000), history, ask:text }, ctrl.signal,
      (d)=>{ if(d.reset)entry.a=''; if(d.text)entry.a=d.acc; });
    if(r.res && r.res.status===401){ this.token=''; localStorage.removeItem('zb_token'); this.go('settings'); throw new Error('访问码无效'); }
    if(!r.ok){ let msg=r.errText||''; if(!msg){ try{ const d=await r.res.json(); msg=(d&&d.error)||('HTTP '+r.res.status); }catch(_){ msg='HTTP '+(r.res?r.res.status:'?'); } } throw new Error(msg); }
    if(!entry.a){ entry.a='_（模型没有返回内容）_'; }
  }catch(e){ if(e.name!=='AbortError'){ let msg=e.message||'未知错误'; if(/429/.test(msg))msg+='（中转站限流，稍等几秒再重试）'; else if(/Failed to fetch|NetworkError|HTTP2|PROTOCOL|stream/i.test(msg))msg='网络异常，请检查网络后重试'; entry.a='_回答失败：'+msg+'_'; entry.err=true; this.flash('追问失败：'+msg,true); } }
  if(this.aiX.id===q.id) this.aiX.asking=false;
  if(this._aiCtrl===ctrl) this._aiCtrl=null;
},
aiNoteFromChat(p){ const q=this.cur; if(!q||!p||!p.a)return;
  const add='**🙋 '+p.q.trim()+'**\n\n'+p.a.trim();
  const note=(q.note?String(q.note).trim()+'\n\n---\n\n':'')+add;
  this.onNote({ id:q.id, note }); // 复用既有保存链路：本地更新 + POST progress + 提示
}


,
aiRetryAsk(i){ const list=this.aiX.chat||[]; const c=list[i];
  if(!c || !c.err || this.aiX.asking) return;
  const q=c.q; list.splice(i,1);   // 移除失败轮次，原问题重发（历史不包含失败文本）
  return this.aiAsk(q);
}

} };
