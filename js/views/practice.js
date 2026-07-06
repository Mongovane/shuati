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
next(){ if(this.qi<this.queue.length-1)this.qi++; else this.startSession(true); },
async deleteCurrentQuestion(){ const q=this.cur; if(!q)return; if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } if(!confirm('确定删除这道题？此操作不可恢复。'))return; try{ await this.api('/api/questions',{method:'DELETE',body:JSON.stringify({ids:[q.id]})}); this.queue.splice(this.qi,1); if(this.qi>this.queue.length-1)this.qi=Math.max(0,this.queue.length-1); if(!this.queue.length)this.batchDone=true; this.flash('已删除本题'); this.loadMeta(true); this.statsDirty=true; }catch(e){ if(e.message!=='unauth')this.flash('删除失败：'+e.message,true); } },
async setQuestionSubject(subj){ const q=this.cur; if(!q||!subj||subj===q.subject)return; if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } try{ await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids:[q.id],subject:subj})}); q.subject=subj; this.flash('已改为「'+this.subjName(subj)+'」'); this.loadMeta(true); }catch(e){ if(e.message!=='unauth')this.flash('改科目失败：'+e.message,true); } },
findQ(id){ return this.queue.find(q=>q.id===id)||(this.mock.questions||[]).find(q=>q.id===id); },
async onAnswered(p){ this.sessionAns[p.id]=p.correct; if(p.correct){ this.streak++; if(this.streak>this.bestStreak)this.bestStreak=this.streak; } else { this.streak=0; } try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'answer',question_id:p.id,is_correct:p.correct})}); }catch(e){} },
async onFav(p){ const q=this.findQ(p.id); if(q)q.favorited=p.value; this.flash(p.value?'已收藏':'已取消收藏'); try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'favorite',question_id:p.id,value:p.value?1:0})}); }catch(e){} },
async onMaster(p){ const q=this.findQ(p.id); if(q)q.mastered=p.value; this.flash(p.value?'已标记为掌握':'已撤销'); try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'master',question_id:p.id,value:p.value?1:0})}); }catch(e){} },
async onNote(p){ const q=this.findQ(p.id); if(q)q.note=p.note; this.flash('笔记已保存'); try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'note',question_id:p.id,note:p.note})}); }catch(e){} }
} };
