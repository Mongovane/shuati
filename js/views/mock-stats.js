// 模拟考与统计：限时测验 / 逐题记录与错题回顾 / 热力图 / 数据导出
// —— 由 app.js 按功能域拆分而来；与其余 mixin 合并进同一个 Vue 实例，this.* 跨文件可用 ——
const MockStatsMixin = { methods: {
async reviewMock(m){ if(!m||!m.id){ this.flash('这次记录没有逐题明细（旧版本考的）',true); return; } try{
        const d=await this.api('/api/progress?mock_id='+m.id);
        const wrong=(d.items||[]).filter(x=>x.is_correct===0).map(x=>x.question_id).filter(Boolean);
        if(!wrong.length){ this.flash('这次模考没有错题 🎉'); return; }
        const qd=await this.api('/api/questions?ids='+encodeURIComponent(wrong.join(','))+'&limit=200&order=seq');
        if(!qd.items||!qd.items.length){ this.flash('错题已被删除或找不到了',true); return; }
        this.queue=qd.items; this.qi=0; this.queueTotal=qd.items.length; this.batchDone=false; this.loadedOnce=true; this.sessionAns={}; this.sessionStart=Date.now(); this.streak=0; this.view='practice'; this.filterLock=true;
        this.flash('已载入该次模考的 '+qd.items.length+' 道错题');
      }catch(e){ if(e.message!=='unauth')this.flash(e.message,true); } },
async exportBackup(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } this.exporting=true; try{
        const res=await fetch('/api/export',{headers:{authorization:'Bearer '+this.token}});
        if(res.status===401){ this.flash('访问码无效',true); this.exporting=false; return; }
        if(!res.ok)throw new Error('导出失败 '+res.status);
        const blob=await res.blob(); const a=document.createElement('a');
        a.href=URL.createObjectURL(blob); a.download='shuati-backup-'+new Date().toISOString().slice(0,10)+'.json';
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),3000);
        this.flash('已导出备份（含题库/进度/教材/模考）');
      }catch(e){ this.flash(e.message,true); } this.exporting=false; },
heatColor(n){ if(!n)return''; if(n>=60)return'l4'; if(n>=30)return'l3'; if(n>=10)return'l2'; return'l1'; },
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
      let correct=0; const details=[];
      for(const c of cards){ if(c.graded){ if(c.finalCorrect)correct++; try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'answer',question_id:c.q.id,is_correct:c.finalCorrect})}); }catch(e){} }
        details.push({question_id:c.q.id,is_correct:c.graded?c.finalCorrect:null}); }
      try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'mock',subject:this.mock.subject,total:this.mock.questions.length,correct,duration_seconds:this.mock.elapsed,details})}); }catch(e){}
      window.scrollTo({top:0,behavior:'smooth'});
    },
async onMockAnswer(p){ this.mock.answers[p.id]=p.correct; try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'answer',question_id:p.id,is_correct:p.correct})}); }catch(e){} },
quitMock(){ clearInterval(this.mock.timer); this.mock.started=false; this.mock.finished=false; this.mock.questions=[]; this.mock.answers={}; },
fmtTime(s){ s=Math.max(0,s); const m=Math.floor(s/60),x=s%60; return String(m).padStart(2,'0')+':'+String(x).padStart(2,'0'); }
} };
