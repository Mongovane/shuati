// 题库总览：列表 / 批量操作 / 单题编辑 / 去重 / 智能归类
// —— 由 app.js 按功能域拆分而来；与其余 mixin 合并进同一个 Vue 实例，this.* 跨文件可用 ——
// —— 近似查重：simhash(字符 3-gram) 指纹 + 4×16 位分带 LSH 找候选对 ——
//    判定双闸：汉明距离 ≤4 直接判相似；5~10 之间再用字符 bigram Jaccard ≥0.72 复核，
//    防「下列说法正确的是…」这类同套话头、不同题尾被误并。纯前端计算，不吃服务端配额。
const _dsNorm=(x)=>String(x||'').toLowerCase().replace(/[\s，。！？；：、,.!?;:'"()（）\[\]【】<>《》\-—_·…]/g,'');
function _fnv(str,seed){ let h=seed>>>0; for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619)>>>0; } return h>>>0; }
function simhash64(text){ const t=_dsNorm(text); if(!t)return [0,0];
  const v=new Array(64).fill(0);
  for(let i=0;i<Math.max(1,t.length-2);i++){ const g=t.slice(i,i+3);
    const h1=_fnv(g,0x811c9dc5), h2=_fnv(g,0x01000193);
    for(let b=0;b<32;b++){ v[b]+=((h1>>>b)&1)?1:-1; v[32+b]+=((h2>>>b)&1)?1:-1; } }
  let lo=0,hi=0; for(let b=0;b<32;b++){ if(v[b]>0)lo|=(1<<b); if(v[32+b]>0)hi|=(1<<b); }
  return [lo>>>0,hi>>>0]; }
function _pop(x){ x=x-((x>>>1)&0x55555555); x=(x&0x33333333)+((x>>>2)&0x33333333); return (((x+(x>>>4))&0x0f0f0f0f)*0x01010101)>>>24; }
function hamming64(a,b){ return _pop((a[0]^b[0])>>>0)+_pop((a[1]^b[1])>>>0); }
function bigramJac(a,b){ if(!a||!b)return 0; const A=new Set(),B=new Set();
  for(let i=0;i<a.length-1;i++)A.add(a.slice(i,i+2));
  for(let i=0;i<b.length-1;i++)B.add(b.slice(i,i+2));
  if(!A.size||!B.size)return 0; let inter=0; for(const g of A){ if(B.has(g))inter++; }
  return inter/(A.size+B.size-inter); }

const BankMixin = { methods: {
async loadBank(reset){ if(!this.token)return; if(reset){ this.bank.offset=0; this.bank.items=[]; this.bank.sel=[]; } this.bank.loading=true; try{ const p=new URLSearchParams(); if(this.bank.subject&&this.bank.subject!=='all')p.set('subject',this.bank.subject); if(this.bank.type)p.set('type',this.bank.type); if(this.bank.kw&&this.bank.kw.trim())p.set('q',this.bank.kw.trim()); if(this.bank.tag&&this.bank.tag.trim())p.set('tag',this.bank.tag.trim()); if(this.bank.status)p.set('status',this.bank.status); p.set('order','seq'); p.set('mode',this.bank.mode||'all'); p.set('limit',this.bank.limit); p.set('offset',this.bank.offset); const d=await this.api('/api/questions?'+p.toString()); this.bank.items = reset ? (d.items||[]) : this.bank.items.concat(d.items||[]); this.bank.total=d.total||this.bank.items.length; }catch(e){ if(e.message!=='unauth')this.flash(e.message,true); } this.bank.loading=false; },
bankMore(){ this.bank.offset+=this.bank.limit; this.loadBank(false); },
bankToggle(id){ const i=this.bank.sel.indexOf(id); i>=0?this.bank.sel.splice(i,1):this.bank.sel.push(id); },
bankAllOnPage(){ const ids=this.bank.items.map(q=>q.id); const allSel=ids.every(id=>this.bank.sel.includes(id)); this.bank.sel = allSel ? this.bank.sel.filter(id=>!ids.includes(id)) : Array.from(new Set(this.bank.sel.concat(ids))); },
async bankSetSubject(q,subj){ if(!q||!subj||subj===q.subject)return; try{ await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids:[q.id],subject:subj})}); q.subject=subj; this.flash('已改为「'+this.subjName(subj)+'」'); this.loadMeta(true); }catch(e){ if(e.message!=='unauth')this.flash('改科目失败：'+e.message,true); } },
async bankDelete(q){ if(!q)return; if(!confirm('确定删除这道题？此操作不可恢复。'))return; try{ await this.api('/api/questions',{method:'DELETE',body:JSON.stringify({ids:[q.id]})}); const i=this.bank.items.findIndex(x=>x.id===q.id); if(i>=0)this.bank.items.splice(i,1); const si=this.bank.sel.indexOf(q.id); if(si>=0)this.bank.sel.splice(si,1); this.bank.total=Math.max(0,this.bank.total-1); this.flash('已删除'); this.loadMeta(true); this.statsDirty=true; }catch(e){ if(e.message!=='unauth')this.flash('删除失败：'+e.message,true); } },
async bankBatchDelete(){ const ids=[...this.bank.sel]; if(!ids.length){ this.flash('请先勾选题目',true); return; } if(!confirm('确定删除选中的 '+ids.length+' 道题？此操作不可恢复。'))return; try{ const d=await this.api('/api/questions',{method:'DELETE',body:JSON.stringify({ids})}); this.bank.items=this.bank.items.filter(q=>!ids.includes(q.id)); this.bank.total=Math.max(0,this.bank.total-(d.deleted||ids.length)); this.bank.sel=[]; this.flash('已删除 '+(d.deleted||ids.length)+' 题'); this.loadMeta(true); this.statsDirty=true; }catch(e){ if(e.message!=='unauth')this.flash('批量删除失败：'+e.message,true); } },
async bankBatchChapter(){ const ids=[...this.bank.sel]; if(!ids.length){ this.flash('请先勾选题目',true); return; } const ch=prompt('把选中 '+ids.length+' 题的章节改为（留空清除章节）：'); if(ch===null)return; const chapter=ch.trim(); try{ const d=await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids,chapter})}); this.bank.items.forEach(q=>{ if(ids.includes(q.id))q.chapter=chapter; }); this.flash('已把 '+(d.updated||ids.length)+' 题章节改为「'+(chapter||'（无）')+'」'); this.bank.sel=[]; this.loadMeta(true); }catch(e){ if(e.message!=='unauth')this.flash('批量改章节失败：'+e.message,true); } },
async bankBatchTag(){ const ids=[...this.bank.sel]; if(!ids.length){ this.flash('请先勾选题目',true); return; } const t=prompt('给选中 '+ids.length+' 题添加标签（逗号分隔；会与原标签合并去重）：'); if(t===null)return; const add=t.split(/[,，、]/).map(s=>s.trim()).filter(Boolean); if(!add.length){ this.flash('未输入标签',true); return; } try{ for(const q of this.bank.items){ if(!ids.includes(q.id))continue; const cur=Array.isArray(q.tags)?q.tags:[]; const merged=[...new Set([...cur,...add])]; await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids:[q.id],tags:merged})}); q.tags=merged; } this.flash('已为 '+ids.length+' 题添加标签'); this.bank.sel=[]; this.loadMeta(true); }catch(e){ if(e.message!=='unauth')this.flash('批量加标签失败：'+e.message,true); } },
// 导出选中题为 JSON（拉全字段，便于分享/备份某章节/某批题；未选则导出当前已加载列表）
async bankExportSel(){ const ids=this.bank.sel.length?[...this.bank.sel]:this.bank.items.map(q=>q.id); if(!ids.length){ this.flash('没有可导出的题',true); return; }
      try{ const out=[]; for(let i=0;i<ids.length;i+=200){ const chunk=ids.slice(i,i+200); const d=await this.api('/api/questions?ids='+encodeURIComponent(chunk.join(','))+'&limit=200&order=seq'); for(const q of (d.items||[])){ out.push({ subject:q.subject, chapter:q.chapter||undefined, type:q.type, difficulty:q.difficulty, stem:q.stem, passage:q.passage||undefined, options:q.options||[], answer:q.answer||[], analysis:q.analysis||undefined, tags:q.tags||[], source:q.source||undefined }); } }
        const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='shuati-questions-'+new Date().toISOString().slice(0,10)+'.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),3000);
        this.flash('已导出 '+out.length+' 题为 JSON（可在导入页 JSON 导回）');
      }catch(e){ if(e.message!=='unauth')this.flash('导出失败：'+e.message,true); } },
async bankBatchSubject(){ const ids=[...this.bank.sel]; const subj=this.bank.batchSubject; if(!ids.length){ this.flash('请先勾选题目',true); return; } if(!subj){ this.flash('请选择目标科目',true); return; } try{ const d=await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids,subject:subj})}); this.bank.items.forEach(q=>{ if(ids.includes(q.id))q.subject=subj; }); this.flash('已将 '+(d.updated||ids.length)+' 题改为「'+this.subjName(subj)+'」'); this.bank.sel=[]; this.bank.batchSubject=''; this.loadMeta(true); }catch(e){ if(e.message!=='unauth')this.flash('批量改科目失败：'+e.message,true); } },
async bankDedup(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } if(!confirm('扫描整个题库，删除题干完全相同的重复题（每组只保留一道）。\n建议先备份。继续？'))return; this.bank.loading=true; try{
        let all=[]; let off=0; const lim=200; while(true){ const p=new URLSearchParams(); p.set('mode','all'); p.set('order','seq'); p.set('limit',lim); p.set('offset',off); const d=await this.api('/api/questions?'+p.toString()); const items=d.items||[]; all=all.concat(items); if(items.length<lim)break; off+=lim; if(off>40000)break; }
        const seen=new Set(); const dupIds=[]; for(const q of all){ const k=(q.subject||'')+'|'+String(q.stem||'').replace(/\s+/g,' ').trim(); if(seen.has(k))dupIds.push(q.id); else seen.add(k); }
        if(!dupIds.length){ this.flash('没有发现重复题（共 '+all.length+' 题）'); this.bank.loading=false; return; }
        if(!confirm('共扫描 '+all.length+' 题，发现 '+dupIds.length+' 道重复，将删除（每组保留第一道）。确认？')){ this.bank.loading=false; return; }
        let del=0; const CH=100; for(let i=0;i<dupIds.length;i+=CH){ const d=await this.api('/api/questions',{method:'DELETE',body:JSON.stringify({ids:dupIds.slice(i,i+CH)})}); del+=(d.deleted||dupIds.slice(i,i+CH).length); }
        this.flash('已清理 '+del+' 道重复题'); this.loadMeta(true); this.statsDirty=true; await this.loadBank(true);
      }catch(e){ if(e.message!=='unauth')this.flash('清理失败：'+e.message,true); } this.bank.loading=false; },
async bankApprove(q){ try{ await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids:[q.id],status:'ok'})});
      q.status='ok';
      if(this.bank.status==='draft'){ const i=this.bank.items.findIndex(x=>x.id===q.id); if(i>=0)this.bank.items.splice(i,1); this.bank.total=Math.max(0,this.bank.total-1); }
      this.flash('已通过，进入刷题范围'); this.loadMeta(true); }catch(e){ if(e.message!=='unauth')this.flash('操作失败：'+e.message,true); } },
async bankBatchApprove(){ const ids=[...this.bank.sel]; if(!ids.length){ this.flash('请先勾选题目',true); return; }
      try{ const d=await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids,status:'ok'})});
        this.flash('已通过 '+(d.updated||ids.length)+' 题，进入刷题范围'); this.bank.sel=[]; this.loadMeta(true); await this.loadBank(true);
      }catch(e){ if(e.message!=='unauth')this.flash('操作失败：'+e.message,true); } },
async bankDupScan(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      if(this.dup.busy)return; this.dup.busy=true; this.dup.open=true; this.dup.groups=[]; this.dup.del={}; this.dup.scanned=0;
      try{
        const all=[];
        for(const st of ['','draft']){ let offset=0;
          for(;;){ const p=new URLSearchParams({order:'seq',mode:'all',limit:'200',offset:String(offset),nocount:'1'}); if(st)p.set('status',st);
            const d=await this.api('/api/questions?'+p.toString()); const got=d.items||[];
            all.push(...got); offset+=got.length; this.dup.scanned=all.length;
            if(got.length<200||all.length>=8000)break; } }
        const norms=all.map(q=>_dsNorm(q.stem||''));
        const sig=all.map(q=>simhash64((q.stem||'')+' '+((q.options||[]).map(o=>o&&o.text).join(' '))));
        const cand=new Map();
        sig.forEach((sg,i)=>{ const keys=['a'+(sg[0]&0xffff),'b'+(sg[0]>>>16),'c'+(sg[1]&0xffff),'d'+(sg[1]>>>16)];
          for(const k of keys){ let a=cand.get(k); if(!a){ a=[]; cand.set(k,a); } a.push(i); } });
        const fa=all.map((_,i)=>i); const find=(x)=>{ while(fa[x]!==x){ fa[x]=fa[fa[x]]; x=fa[x]; } return x; };
        for(const arr of cand.values()){ if(arr.length<2||arr.length>60)continue;
          for(let i=0;i<arr.length;i++)for(let j=i+1;j<arr.length;j++){ const a=arr[i],b=arr[j];
            if(find(a)===find(b))continue;
            if(all[a].subject!==all[b].subject)continue;
            const la=norms[a].length, lb=norms[b].length;
            if(!la||!lb||Math.min(la,lb)/Math.max(la,lb)<0.7)continue;
            const d=hamming64(sig[a],sig[b]);
            if(d>10)continue;
            if(d>4 && bigramJac(norms[a],norms[b])<0.72)continue;
            fa[find(a)]=find(b); } }
        const gm=new Map(); all.forEach((q,i)=>{ const r=find(i); let g=gm.get(r); if(!g){ g=[]; gm.set(r,g); } g.push(q); });
        const groups=[...gm.values()].filter(g=>g.length>1).sort((a,b)=>b.length-a.length).slice(0,100);
        const del={}; for(const g of groups){ g.sort((a,b)=>(a.created_at||0)-(b.created_at||0)); for(let i=1;i<g.length;i++)del[g[i].id]=true; }
        this.dup.groups=groups; this.dup.del=del;
        if(!groups.length){ this.dup.open=false; this.flash('没有发现相似重复题（共扫描 '+all.length+' 题）✨'); }
      }catch(e){ if(e.message!=='unauth')this.flash('查重失败：'+e.message,true); }
      this.dup.busy=false; },
dupToggle(id){ if(this.dup.del[id])delete this.dup.del[id]; else this.dup.del[id]=true; },
dupDelCount(){ return Object.keys(this.dup.del).length; },
async dupDelete(){ const ids=Object.keys(this.dup.del); if(!ids.length){ this.flash('未勾选要删除的题',true); return; }
      if(!confirm('删除勾选的 '+ids.length+' 道相似重复题？不可恢复，建议先备份。'))return;
      try{ const d=await this.api('/api/questions',{method:'DELETE',body:JSON.stringify({ids})});
        this.flash('已删除 '+(d.deleted||ids.length)+' 题'); this.dup.open=false;
        this.loadMeta(true); this.statsDirty=true; await this.loadBank(true);
      }catch(e){ if(e.message!=='unauth')this.flash('删除失败：'+e.message,true); } },
bankPickImg(){ const el=this.$refs.qimgFile; if(el){ el.value=''; el.click(); } },
async bankImgFile(ev){ const f=ev&&ev.target&&ev.target.files&&ev.target.files[0]; if(ev&&ev.target)ev.target.value=''; if(!f)return;
      if(!/^image\//.test(f.type)){ this.flash('请选择图片文件',true); return; }
      try{
        let url='';
        if(this.qimgInline || f.size<=100*1024){
          url=await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(new Error('读取失败')); r.readAsDataURL(f); });
        } else {
          if(f.size>2*1024*1024){ this.flash('图片超过 2MB，请先压缩（或勾选内嵌并压小）',true); return; }
          const fd=new FormData(); fd.append('file',f);
          const res=await fetch('/api/qimg',{method:'POST',headers:{authorization:'Bearer '+this.token},body:fd});
          const d=await res.json().catch(()=>({}));
          if(!res.ok)throw new Error(d.error||('HTTP '+res.status));
          url=d.url;
        }
        this.bankEdit.stem=(this.bankEdit.stem||'')+'\n\n![]('+url+')';
        this.flash('已把图片插到题干末尾（下方预览可见）');
      }catch(e){ this.flash('插图失败：'+e.message,true); } },
async bankAutoClassify(){ const changes={}; let n=0; for(const q of this.bank.items){ const opt=Array.isArray(q.options)?q.options.map(o=>o&&o.text).join(' '):''; const g=this.classifySubject([q.stem,q.chapter,opt].join('  ')); if(g&&g!==q.subject){ (changes[g]=changes[g]||[]).push(q); n++; } } if(!n){ this.flash('本页没有可自动纠正的题（特征不明确的不动）'); return; } if(!confirm('将按题干内容自动纠正本页 '+n+' 道题的科目（仅强特征命中的）。继续？'))return; try{ for(const subj of Object.keys(changes)){ const arr=changes[subj]; const ids=arr.map(q=>q.id); await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids,subject:subj})}); arr.forEach(q=>q.subject=subj); } this.flash('已自动归类 '+n+' 题'); this.loadMeta(true); }catch(e){ if(e.message!=='unauth')this.flash('智能归类失败：'+e.message,true); } },
bankOpenEdit(q){ this.bankEdit={ open:true, q, stem:q.stem||'', analysis:q.analysis||'', subject:q.subject||'', type:q.type||'', chapter:q.chapter||'', difficulty:Number(q.difficulty)||3, tags:(Array.isArray(q.tags)?q.tags.join(', '):(q.tags||'')), options:(Array.isArray(q.options)?q.options.map(o=>({key:o.key||'',text:o.text||''})):[]), answerText:(Array.isArray(q.answer)?q.answer.join(this.isChoiceType(q.type)?', ':'\n'):(q.answer||'')), busy:false }; },
isChoiceType(t){ return t==='single_choice'||t==='multiple_choice'||t==='true_false'; },
bankEditAddOpt(){ const keys=['A','B','C','D','E','F','G','H']; const used=new Set(this.bankEdit.options.map(o=>o.key)); const k=keys.find(x=>!used.has(x))||String(this.bankEdit.options.length+1); this.bankEdit.options.push({key:k,text:''}); },
bankEditDelOpt(i){ this.bankEdit.options.splice(i,1); },
bankCloseEdit(){ this.bankEdit.open=false; this.bankEdit.q=null; },
async bankSaveEdit(){ const e=this.bankEdit; if(!e.q)return; if(!String(e.stem).trim()){ this.flash('题干不能为空',true); return; } e.busy=true;
      const isChoice=this.isChoiceType(e.type);
      const options=isChoice ? e.options.filter(o=>String(o.key).trim()).map(o=>({key:String(o.key).trim(),text:String(o.text||'').trim()})) : [];
      let answer; if(isChoice){ answer=String(e.answerText||'').split(/[,，、\s]+/).map(s=>s.trim()).filter(Boolean); if(e.type==='true_false')answer=answer.map(s=>/^(t|true|对|是|正确|√)$/i.test(s)?'T':(/^(f|false|错|否|错误|×)$/i.test(s)?'F':s.toUpperCase())); else answer=answer.map(s=>s.toUpperCase()); } else { const txt=String(e.answerText||'').trim(); answer=txt?[txt]:[]; }
      try{ const tags=String(e.tags||'').split(/[,，、]/).map(s=>s.trim()).filter(Boolean); const chapter=String(e.chapter||'').trim(); const difficulty=Number(e.difficulty)||3; await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids:[e.q.id],stem:e.stem,analysis:e.analysis,subject:e.subject,type:e.type,chapter,difficulty,tags,options,answer})}); e.q.stem=e.stem; e.q.analysis=e.analysis; e.q.subject=e.subject; e.q.type=e.type; e.q.chapter=chapter; e.q.difficulty=difficulty; e.q.tags=tags; e.q.options=options; e.q.answer=answer; this.flash('已保存'); this.loadMeta(true); this.bankCloseEdit(); }catch(err){ if(err.message!=='unauth')this.flash('保存失败：'+err.message,true); } e.busy=false; }
} };
