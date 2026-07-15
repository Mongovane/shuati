// 模拟考与统计：限时测验 / 逐题记录与错题回顾 / 热力图 / 数据导出
// —— 由 app.js 按功能域拆分而来；与其余 mixin 合并进同一个 Vue 实例，this.* 跨文件可用 ——
const MockStatsMixin = { methods: {
async reviewMock(m){ if(!m||!m.id){ this.flash('这次记录没有逐题明细（旧版本考的）',true); return; } try{
        const d=await this.api('/api/progress?mock_id='+m.id);
        const wrong=(d.items||[]).filter(x=>x.is_correct!=null&&x.is_correct<1).map(x=>x.question_id).filter(Boolean);
        if(!wrong.length){ this.flash('这次模考没有错题 🎉'); return; }
        const qd=await this.api('/api/questions?ids='+encodeURIComponent(wrong.join(','))+'&limit=200&order=seq');
        if(!qd.items||!qd.items.length){ this.flash('错题已被删除或找不到了',true); return; }
        this.queue=qd.items; this.qi=0; this.queueTotal=qd.items.length; this.batchDone=false; this.loadedOnce=true; this.sessionAns={}; this.sessionStart=Date.now(); this.streak=0; this.sessionView='practice'; this.view='practice'; this.filterLock=true;
        this.flash('已载入该次模考的 '+qd.items.length+' 道错题');
      }catch(e){ if(e.message!=='unauth')this.flash(e.message,true); } },
async exportBackup(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } this.exporting=true; try{
        const res=await fetch('/api/export',{headers:{authorization:'Bearer '+this.token}});
        if(res.status===401){ this.flash('访问码无效',true); this.exporting=false; return; }
        if(!res.ok)throw new Error('导出失败 '+res.status);
        const blob=await res.blob(); const a=document.createElement('a');
        a.href=URL.createObjectURL(blob); a.download='shuati-backup-'+new Date().toISOString().slice(0,10)+'.json';
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),3000);
        this.flash('已导出备份（含题库/进度/教材/模考/答题流水）');
      }catch(e){ this.flash(e.message,true); } this.exporting=false; },
restorePick(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } if(this.offline){ this.flash('当前离线，无法恢复',true); return; } const el=this.$refs.restoreFile; if(el){ el.value=''; el.click(); } },
async restoreBackup(ev){ const f=ev&&ev.target&&ev.target.files&&ev.target.files[0]; if(!f)return;
      let data=null;
      try{ data=JSON.parse(await f.text()); }catch(_){ this.flash('文件不是合法 JSON，请选择「导出数据备份」得到的文件',true); return; }
      const n=(k)=>Array.isArray(data[k])?data[k].length:0;
      const summary='题目 '+n('questions')+' · 进度 '+n('progress')+' · 教材 '+n('materials')+' 页 · 模考 '+n('mock_results')+' 次 · 答题流水 '+n('answer_log')+' 条';
      const mode=this.restoreReplace?'replace':'merge';
      const tip=mode==='replace'
        ? '⚠️ 覆盖式恢复：会先清空现有的题库/进度/教材/模考等数据，再写入备份内容（恢复到备份时刻）。\n\n'+summary+'\n\n确定继续？'
        : '合并恢复：保留现有数据，与备份同 ID 的条目以备份为准。\n\n'+summary+'\n\n确定恢复？';
      if(!confirm(tip))return;
      this.restoring=true;
      try{
        const r=await this.api('/api/restore',{method:'POST',body:JSON.stringify({mode,data})});
        const c=r.counts||{};
        this.flash('恢复完成：题目 '+(c.questions||0)+' · 进度 '+(c.progress||0)+' · 教材 '+(c.materials||0)+' · 模考 '+(c.mock_results||0));
        if(Array.isArray(r.notes)&&r.notes.length)alert('恢复提示：\n\n· '+r.notes.join('\n· '));
        // 恢复后各处缓存全部标脏并重拉
        this.statsDirty=true; this.bankDirty=true;
        try{ localStorage.removeItem('zb_meta_cache'); }catch(_){ }
        this.loadSubjects(); this.loadMeta(true); this.loadMaterials&&this.loadMaterials(); this.loadStats();
      }catch(e){ if(e.message!=='unauth')this.flash('恢复失败：'+e.message,true); }
      this.restoring=false;
    },
heatColor(n){ if(!n)return''; if(n>=60)return'l4'; if(n>=30)return'l3'; if(n>=10)return'l2'; return'l1'; },
async loadStats(){ if(!this.token)return; this.statsLoading=true; try{ this.stats=await this.api('/api/progress'); this.statsDirty=false; }catch(e){ if(e.message!=='unauth')this.flash(e.message,true); } this.statsLoading=false; },
rate(r){ const t=(r.right_sum||0)+(r.wrong_sum||0); return t?Math.round((r.right_sum||0)/t*100):0; },
async startMock(){ if(!this.token)return; this.mock.finished=false; this.mock.answers={}; this.mock.touched={}; this.mock.lastId=null; this.loading=true;
      const dedup=(arr)=>{ const m=new Map(); for(const q of (arr||[])){ if(q&&q.id!=null&&!m.has(q.id))m.set(q.id,q); } return [...m.values()]; };
      try{
        let qs=[];
        const rows=this.bpRows();
        if(this.mock.bp.on && rows.length){
          // —— 组卷蓝图：按「章节 × 题型 × 数量」逐段抽题，再整卷打乱 ——
          const notes=[];
          for(const row of rows){
            const want=row.count|0;
            const p=new URLSearchParams({ order:'random', limit:String(Math.min(200,Math.max(want,want*3))), mode:'all', nocount:'1' });
            if(this.mock.subject!=='all') p.set('subject',this.mock.subject);
            if(row.type) p.set('type',row.type);
            if(row.chapter) p.set('chapter',row.chapter);
            const d=await this.api('/api/questions?'+p.toString());
            let part=d.items||[];
            if(this.mock.objectiveOnly) part=part.filter(q=>AUTO.includes(q.type));
            part=part.slice(0,want);
            if(part.length<want) notes.push((row.chapter||'全部章节')+' · '+(row.type?(TYPE_MAP[row.type]||row.type):'不限题型')+'：只有 '+part.length+'/'+want+' 题');
            qs.push(...part);
          }
          qs=dedup(qs);
          for(let i=qs.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); const t=qs[i]; qs[i]=qs[j]; qs[j]=t; }
          if(notes.length) this.flash('部分配比题量不足：'+notes.join('；'),true);
          try{ localStorage.setItem('zb_mock_bp',JSON.stringify({on:true,rows:this.mock.bp.rows})); }catch(_){ }
        } else {
          const limit=this.mock.objectiveOnly?Math.min(200,(this.mock.count||20)*3):(this.mock.count||20);
          const p=new URLSearchParams({ order:'random', limit:String(limit), mode:'all' });
          if(this.mock.subject!=='all') p.set('subject',this.mock.subject);
          const d=await this.api('/api/questions?'+p.toString());
          qs=d.items||[];
          if(this.mock.objectiveOnly) qs=qs.filter(q=>AUTO.includes(q.type));
          qs=qs.slice(0,this.mock.count||20);
        }
        if(!qs.length){ this.flash('题目不足，请先导入一些题目或调整组卷配比',true); this.loading=false; return; }
        this.mock.questions=qs; this.mock.started=true; this.mock.elapsed=0; this.mock.remaining=(this.mock.minutes||60)*60;
        this.mockSaved=null; this._mockStartTimer();
        this.$nextTick(()=>this.mockSnapSave());
        window.scrollTo({top:0});
      }catch(e){ if(e.message!=='unauth')this.flash(e.message,true); }
      this.loading=false;
    },
bpRows(){ return (this.mock.bp&&Array.isArray(this.mock.bp.rows)?this.mock.bp.rows:[]).filter(r=>r&&(r.count|0)>0).slice(0,8); },
bpAdd(){ if(this.mock.bp.rows.length>=8){ this.flash('最多 8 行配比',true); return; } this.mock.bp.rows.push({type:'',chapter:'',count:5}); },
bpDel(i){ this.mock.bp.rows.splice(i,1); if(!this.mock.bp.rows.length)this.bpAdd(); },
bpTotal(){ return this.bpRows().reduce((a,r)=>a+(r.count|0),0); },
_mockStartTimer(){ clearInterval(this.mock.timer);
      this.$nextTick(()=>this.mockScanTouched());
      this.mock.timer=setInterval(()=>{ this.mock.remaining--; this.mock.elapsed++;
        if(this.mock.elapsed%2===0)this.mockScanTouched();   /* 答题卡「已作答」状态每 2 秒刷新一次 */
        if(this.mock.elapsed%10===0)this.mockSnapSave();  /* 每 10 秒落一次快照，页面被杀也丢不了多少 */
        if(this.mock.remaining<=0)this.submitMock(); },1000); },
mockScanTouched(){ if(!this.mock.started)return; const t={};
      for(const c of (this.$refs.mockCards||[])){ if(!c||!c.q||!c.snapState)continue; const s=c.snapState();
        t[c.q.id]=!!((s.sel&&s.sel.length)||(s.blanks&&s.blanks.trim())||(s.blanksArr&&s.blanksArr.some(x=>String(x).trim()))||(s.text&&s.text.trim())||s.self!=null); }
      this.mock.touched=t; },
mockJump(i){ const el=document.getElementById('mockq'+i); if(el)el.scrollIntoView({behavior:'smooth',block:'start'}); },
// —— 模考断点续考：进行中的卷子（题目 + 每题作答状态 + 剩余时间）快照进 localStorage ——
mockSnapSave(){ if(!this.mock.started)return; try{
      const states={}; for(const c of (this.$refs.mockCards||[])){ if(c&&c.q&&c.snapState)states[c.q.id]=c.snapState(); }
      localStorage.setItem('zb_mock_snap', JSON.stringify({ v:1, savedAt:Date.now(),
        subject:this.mock.subject, count:this.mock.count, minutes:this.mock.minutes, objectiveOnly:!!this.mock.objectiveOnly,
        remaining:this.mock.remaining, elapsed:this.mock.elapsed, questions:this.mock.questions, states }));
    }catch(_){ } },
mockSnapPeek(){ try{ const s=JSON.parse(localStorage.getItem('zb_mock_snap')||'null');
      if(s&&s.v===1&&Array.isArray(s.questions)&&s.questions.length)return s; }catch(_){ } return null; },
mockSnapClear(){ try{ localStorage.removeItem('zb_mock_snap'); }catch(_){ } this.mockSaved=null; },
async resumeMock(){ const s=this.mockSnapPeek(); if(!s){ this.flash('没有可恢复的模考',true); this.mockSaved=null; return; }
      this.mock.subject=s.subject; this.mock.count=s.count; this.mock.minutes=s.minutes; this.mock.objectiveOnly=!!s.objectiveOnly;
      this.mock.questions=s.questions; this.mock.answers={}; this.mock.finished=false; this.mock.started=true;
      this.mock.remaining=Math.max(30, s.remaining|0); this.mock.elapsed=s.elapsed|0; /* 至少留 30 秒缓冲 */
      this.mockSaved=null;
      await this.$nextTick();
      for(const c of (this.$refs.mockCards||[])){ if(c&&c.q&&s.states&&s.states[c.q.id]&&c.restoreState)c.restoreState(s.states[c.q.id]); }
      this._mockStartTimer();
      this.flash('已恢复上次模考，剩余 '+this.fmtTime(this.mock.remaining)+'（中断期间计时暂停）');
      window.scrollTo({top:0});
    },
_mockPagehide(){ this.mockSnapSave(); },
_mockVis(){ try{ if(document.visibilityState==='hidden')this.mockSnapSave(); }catch(_){ } },
async submitMock(){ clearInterval(this.mock.timer); this.mock.finished=true; this.mock.started=false; this.mockSnapClear(); await this.$nextTick();
      const cards=this.$refs.mockCards||[]; const ans={};
      // true=全对 / 0.5=多选少选半分 / false=错 / null=主观未判
      for(const c of cards){ ans[c.q.id]= c.graded?(c.finalCorrect?true:(c.mcPartial?0.5:false)):null; } this.mock.answers=ans;
      let correct=0, half=0; const details=[]; const bulk=[];
      for(const c of cards){ if(c.graded){ if(c.finalCorrect)correct++; else if(c.mcPartial)half++; bulk.push({question_id:c.q.id,is_correct:c.finalCorrect}); }
        details.push({question_id:c.q.id,is_correct:c.graded?(c.finalCorrect?1:(c.mcPartial?0.5:0)):null}); }
      const score=correct+half*0.5;
      // 客观题一次批量记账（少选按需复习计错，进 SRS 回炉）
      if(bulk.length){ try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'answers_bulk',items:bulk})}); }catch(e){ if(e.message!=='unauth')this.flash('作答记录保存失败：'+e.message,true); } }
      try{ const r=await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'mock',subject:this.mock.subject,total:this.mock.questions.length,correct,score,duration_seconds:this.mock.elapsed,details})}); this.mock.lastId=(r&&r.mock_id)||null; }catch(e){ if(e.message!=='unauth')this.flash('模考成绩保存失败：'+e.message,true); }
      this.statsDirty=true;
      window.scrollTo({top:0,behavior:'smooth'});
    },
async onMockAnswer(p){ if(this.mock.started)return; /* 考试进行中不逐题记账（交卷时统一批量）；这里只服务复盘阶段的主观题自评 */
      this.mock.answers[p.id]=p.correct;
      try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'answer',question_id:p.id,is_correct:p.correct,grade:p.grade||undefined,duration_ms:p.ms||undefined})}); }catch(e){ if(e.message!=='unauth')this.flash('自评记录保存失败：'+e.message,true); }
      /* 回写这次模考的逐题明细：之后「错题回顾」才能把这些主观题算进来 */
      if(this.mock.lastId){ try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'mock_grade',mock_id:this.mock.lastId,question_id:p.id,is_correct:p.correct})}); }catch(_){ } } },
quitMock(){ clearInterval(this.mock.timer); this.mock.started=false; this.mock.finished=false; this.mock.questions=[]; this.mock.answers={}; this.mock.touched={}; this.mockSnapClear(); },
// —— 打印错题卷：拉最近的错题渲染进隐藏打印区，触发系统打印（手机上也可存为 PDF）——
async printWrong(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      if(this.printW.busy)return; this.printW.busy=true;
      try{
        const items=[]; const seen=new Set(); let offset=0;
        for(let page=0;page<3;page++){
          const p=new URLSearchParams({ mode:'wrong', order:'weak', limit:'100', offset:String(offset), nocount:'1' });
          if(this.f.subject&&this.f.subject!=='all') p.set('subject',this.f.subject);
          const d=await this.api('/api/questions?'+p.toString());
          const got=d.items||[];
          for(const q of got){ if(!seen.has(q.id)){ seen.add(q.id); items.push(q); } }
          offset+=got.length;
          if(got.length<100||items.length>=300)break;
        }
        if(!items.length){ this.flash('当前没有错题可打印 🎉'); this.printW.busy=false; return; }
        this.printW.items=items.slice(0,300);
        await this.$nextTick();
        window.print();
      }catch(e){ if(e.message!=='unauth')this.flash(e.message,true); }
      this.printW.busy=false;
    },
// —— Anki 导出：TSV（制表符分隔），正面=题干+选项，背面=答案+解析，第三列标签；数学公式转 \( \) ——
async exportAnki(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } if(this.ankiBusy)return; this.ankiBusy=true;
      try{
        const items=[]; let offset=0;
        for(;;){
          const p=new URLSearchParams({ order:'seq', limit:'200', offset:String(offset), nocount:'1', mode:'all' });
          if(this.f.subject&&this.f.subject!=='all') p.set('subject',this.f.subject);
          const d=await this.api('/api/questions?'+p.toString());
          const got=d.items||[]; items.push(...got); offset+=got.length;
          if(got.length<200||items.length>=5000)break;
        }
        if(!items.length){ this.flash('没有可导出的题目',true); this.ankiBusy=false; return; }
        const conv=(x)=>String(x==null?'':x)
          .replace(/\$\$([\s\S]+?)\$\$/g,'\\[$1\\]')
          .replace(/\$([^$\n]+?)\$/g,'\\($1\\)')
          .replace(/\t/g,' ')
          .replace(/\r?\n/g,'<br>');
        const lines=[];
        for(const q of items){
          const opts=(q.options||[]).map(o=>conv(o.key+'. '+o.text)).join('<br>');
          const front=(q.passage?conv(q.passage)+'<br><br>':'')+conv(q.stem)+(opts?'<br><br>'+opts:'');
          const ansTxt=(q.answer||[]).map(a=>String(a).split('||').join(' ⁄ ')).join(AUTO.includes(q.type)?'、':'\n');
          const back=conv('答案：'+ansTxt)+(q.analysis?'<br><br>'+conv('解析：'+q.analysis):'');
          const tags=[q.subject,q.chapter,...(Array.isArray(q.tags)?q.tags:[])].filter(Boolean).map(t=>String(t).replace(/\s+/g,'_')).join(' ');
          lines.push([front,back,tags].join('\t'));
        }
        const blob=new Blob(['#separator:tab\n#html:true\n#tags column:3\n'+lines.join('\n')],{type:'text/plain;charset=utf-8'});
        const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
        a.download='anki-'+(this.f.subject==='all'||!this.f.subject?'all':this.f.subject)+'-'+new Date().toISOString().slice(0,10)+'.txt';
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),3000);
        this.flash('已导出 '+items.length+' 张卡片，Anki →「导入文件」即可');
      }catch(e){ if(e.message!=='unauth')this.flash(e.message,true); }
      this.ankiBusy=false; },
fmtDur(ms){ ms=+ms||0; if(ms<1000)return ms+' 毫秒'; const s=Math.round(ms/1000); if(s<60)return s+' 秒'; return Math.floor(s/60)+' 分 '+String(s%60).padStart(2,'0')+' 秒'; },
fmtTime(s){ s=Math.max(0,s); const m=Math.floor(s/60),x=s%60; return String(m).padStart(2,'0')+':'+String(x).padStart(2,'0'); }
} };
