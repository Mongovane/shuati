// 题库总览：列表 / 批量操作 / 单题编辑 / 去重 / 智能归类
// —— 由 app.js 按功能域拆分而来；与其余 mixin 合并进同一个 Vue 实例，this.* 跨文件可用 ——
// —— 近似查重：simhash(字符 3-gram) 指纹 + 4×16 位分带 LSH 找候选对 ——
//    判定双闸：汉明距离 ≤4 直接判相似；5~10 之间再用字符 bigram Jaccard ≥0.72 复核，
//    防「下列说法正确的是…」这类同套话头、不同题尾被误并。纯前端计算，不吃服务端配额。
// 剥掉插图标记：与后端 process.js 的 stemShape 保持同一套规则（tests/shape-dedupe 里有一致性断言）。
// 不剥的话，30KB 的 base64 题干和「［图］」占位题干 simhash 完全不同，
// 同一道题的两个插图版本永远查不出重复 —— 线上就是这么留下 16 行的。
const _stripFigs=(x)=>String(x||'')
  .replace(/!\[[^\]]*\]\([^)]*\)/g,'\u00a7')
  .replace(/<img[^>]*>/gi,'\u00a7')
  .replace(/<figure[^>]*>|<\/figure>/gi,'')
  .replace(/[［[]\s*图\s*[］\]]/g,'\u00a7')
  .replace(/\s+/g,' ').trim();
const _dsNorm=(x)=>_stripFigs(x).toLowerCase().replace(/[\s，。！？；：、,.!?;:'"()（）\[\]【】<>《》\-—_·…]/g,'');
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
// 「全选全部匹配」：跨页选中当前筛选条件下的全部题。
// 只拉 id（idsonly=1），因为题干里可能有内嵌 base64 插图，整批拉回来是几 MB。
async bankSelectAllMatching(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      this.bank.loading=true;
      try{
        const p=new URLSearchParams(); p.set('idsonly','1'); p.set('mode',this.bank.mode||'all');
        if(this.bank.subject&&this.bank.subject!=='all')p.set('subject',this.bank.subject);
        if(this.bank.type)p.set('type',this.bank.type);
        if(this.bank.kw)p.set('q',this.bank.kw);
        if(this.bank.tag)p.set('tag',this.bank.tag);
        if(this.bank.status)p.set('status',this.bank.status);
        if(this.bank.chapter)p.set('chapter',this.bank.chapter);
        const d=await this.api('/api/questions?'+p.toString());
        this.bank.sel=(d.ids||[]).slice();
        this.flash('已选中全部匹配的 '+this.bank.sel.length+' 题'+(d.truncated?'（已达上限，仍有未选入）':''), !!d.truncated);
      }catch(e){ if(e.message!=='unauth')this.flash('全选失败：'+e.message,true); }
      this.bank.loading=false; },
bankClearSel(){ this.bank.sel=[]; },
async bankBatchDelete(){ const ids=[...this.bank.sel]; if(!ids.length){ this.flash('请先勾选题目',true); return; } if(!confirm('确定删除选中的 '+ids.length+' 道题？此操作不可恢复。'))return; try{
        // 分批 80：DELETE 用 id IN (?,?,…)，每个 id 占一个绑定变量，一次几百个会撞 D1 上限
        let deleted=0; const CH=80;
        for(let i=0;i<ids.length;i+=CH){ const part=ids.slice(i,i+CH);
          if(ids.length>CH)this.bank.batchProg='正在删除 '+Math.min(i+CH,ids.length)+' / '+ids.length;
          const d=await this.api('/api/questions',{method:'DELETE',body:JSON.stringify({ids:part})});
          deleted+=(d.deleted!=null?d.deleted:part.length); }
        this.bank.batchProg='';
        const gone=new Set(ids);
        this.bank.items=this.bank.items.filter(q=>!gone.has(q.id)); this.bank.total=Math.max(0,this.bank.total-deleted); this.bank.sel=[]; this.flash('已删除 '+deleted+' 题'); this.loadMeta(true); this.statsDirty=true; }catch(e){ if(e.message!=='unauth')this.flash('批量删除失败：'+e.message,true); } },
async bankBatchChapter(){ const ids=[...this.bank.sel]; if(!ids.length){ this.flash('请先勾选题目',true); return; } const ch=prompt('把选中 '+ids.length+' 题的章节改为（留空清除章节）：'); if(ch===null)return; const chapter=ch.trim(); try{ const d=await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids,chapter})}); this.flash('已把 '+(d.updated||ids.length)+' 题章节改为「'+(chapter||'（无）')+'」'); const hit=new Set(ids); (this.bank.items||[]).forEach(q=>{ if(hit.has(q.id))q.chapter=chapter; }); this.bank.sel=[]; this.loadMeta(true); await this.loadBank(true); }catch(e){ if(e.message!=='unauth')this.flash('批量改章节失败：'+e.message,true); } },
// AI 补答案：给「抽出来但没答案」的题批量生成参考答案。
// 落库时一律标 status='draft'，走仓库里已有的「待审」流程人工过一遍再发布 ——
// AI 补的数学推导必须当草稿看，直接当正确答案用会把错的东西背进去。
async bankAiFillAnswers(){
      if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      if(this.offline){ this.flash('离线状态下无法调用 AI',true); return; }
      const sel=[...(this.bank.sel||[])];
      let pool;
      if(sel.length){
        // 跨页勾选：sel 里的 id 不一定都在本页 items 里。原来 pool 直接从 bank.items 过滤，
        // 不在本页的勾选会被静默丢掉——连 skipped 都不计，提示还说「已补 N 题」。
        // 批量加标签那条链路早就修过同样的问题（见 questions.js PATCH 的注释），这里漏了。
        const have=new Map((this.bank.items||[]).map(q=>[q.id,q]));
        const miss=sel.filter(id=>!have.has(id));
        const fetched=[];
        if(miss.length){
          try{
            for(let i=0;i<miss.length;i+=200){
              const chunk=miss.slice(i,i+200);
              const d=await this.api('/api/questions?ids='+encodeURIComponent(chunk.join(','))+'&limit=200&order=seq');
              for(const q of (d.items||[]))fetched.push(q);
            }
          }catch(e){ if(e.message==='unauth')throw e;
            this.flash('拉取跨页勾选的题目失败，已中止：'+e.message,true); return; }
        }
        pool=[...sel.map(id=>have.get(id)).filter(Boolean), ...fetched];
      } else {
        pool=(this.bank.items||[]).slice();
      }
      pool=pool.filter(q=>!(Array.isArray(q.answer)&&q.answer.length));
      if(!pool.length){ this.flash(sel.length?'勾选的题都已经有答案了':'本页没有缺答案的题',true); return; }
      const CH=6;   // 一次 6 题：再多提示词会长到影响答案质量，单次失败的代价也太大
      if(!confirm('给 '+pool.length+' 道缺答案的题用 AI 补参考答案？\n\n· 会消耗 AI 额度（每 '+CH+' 题一次请求，共约 '+Math.ceil(pool.length/CH)+' 次）\n· 补出来的一律标成「待审」草稿，需要你在题库里筛出来逐条过一遍再发布\n· 依赖插图的题 AI 会跳过，不会硬编\n· 生成中可以点「停止」中断\n\n继续？'))return;
      const ctrl=new AbortController(); this._aiFillCtrl=ctrl;
      // log 里逐题记结果，供过程面板实时显示。后端每条本来就带 skip 原因和 warn，
      // 以前前端全丢了，只剩一个「6 / 50」的计数 —— 跑完也不知道哪些题被跳过、为什么。
      this.bankAiFill={ busy:true, prog:'', total:pool.length, filled:0, skipped:0, failed:0, canceled:false,
        log:[], panel:true };
      // 日志里显示的题干要先洗掉插图 HTML / markdown 图片 / 公式定界符，
      // 否则会看到「…如图 4.18 所示。 <figure class="fig"><」这种被截断的标签。
      const cleanStem=(t)=>String(t||'')
        .replace(/<figure[\s\S]*?<\/figure>/gi,'［图］')
        .replace(/<figure[^>]*>/gi,'［图］')
        .replace(/!\[[^\]]*\]\([^)]*\)/g,'［图］')
        .replace(/<img[^>]*>/gi,'［图］')
        .replace(/<img\b[\s\S]*$/i, "［图］")   // 跨页截断：<img 开了头但没收尾
        .replace(/<[^>]+>/g,' ')
        .replace(/\$\$?/g,'')
        .replace(/\s+/g,' ').trim().slice(0,60);
      const stemOf=new Map(pool.map(q=>[q.id, cleanStem(q.stem)]));
      // 只记 log，不单独维护 done —— done 由 filled+skipped+failed 推导。
      // 各自计数容易和 log 条数对不上：服务端若在多个分块里重复报同一个 missing，
      // 单独自增就会出现「16 / 14」这种超出总数的进度（模拟时实测到了）。
      const note=(id,state,text)=>{ this.bankAiFill.log.unshift({ id, state, text,
        stem: stemOf.get(id) || String(id).slice(0,8) }); };
      try{
        for(let i=0;i<pool.length;i+=CH){
          if(ctrl.signal.aborted){ this.bankAiFill.canceled=true; break; }
          const part=pool.slice(i,i+CH);
          this.bankAiFill.prog='正在生成 '+Math.min(i+CH,pool.length)+' / '+pool.length+'…';
          let d=null, lastErr=null;
          // 429 是中转站限流，退避后重试就能救回来（实测 49 题里 6 题栽在这上面）。
          // 只对限流 / 网关 / 超时重试；参数错、鉴权错重试多少次都一样。
          for(let attempt=0; attempt<3; attempt++){
            if(ctrl.signal.aborted)break;
            try{
              d=await this.api('/api/answerfill',{method:'POST',signal:ctrl.signal,body:JSON.stringify(Object.assign({
                questions: part.map(q=>({ id:q.id, type:q.type, stem:q.stem, options:q.options, passage:q.passage, subject:q.subject })),
              }, this.aiOv()))});
              lastErr=null; break;
            }catch(e){ if(e.message==='unauth')throw e;
              lastErr=e;
              if(e.name==='AbortError'||ctrl.signal.aborted)break;
              const retryable=/429|限流|rate.?limit|50[234]|timeout|超时|网关/i.test(String(e.message||''));
              if(!retryable || attempt===2)break;
              const wait=[1500,4000][attempt];
              this.bankAiFill.prog='被限流，'+(wait/1000)+' 秒后重试（第 '+(attempt+2)+' 次）…';
              await new Promise(r=>setTimeout(r,wait));
            }
          }
          if(lastErr){
            if(lastErr.name==='AbortError'||ctrl.signal.aborted){ this.bankAiFill.canceled=true; break; }
            for(const q of part)note(q.id,'fail','请求失败：'+(lastErr.message||'未知错误'));
            this.bankAiFill.failed+=part.length; continue; }
          // 攒成一个 items 批量 PATCH。原来是每题一个请求，6 题一组也就 6 次往返，
          // 200 题下来 200 次；中途失败还会留下「补了一半」的状态。
          // 服务端新增的 items 路径按 id 分别赋值，一次请求一个 D1 事务。
          const patch=[];
          for(const it of (d.items||[])){
            if(!it || !Array.isArray(it.answer) || !it.answer.length){
              note(it&&it.id,'skip', (it&&it.skip) || '未给出答案');
              this.bankAiFill.skipped++; continue; }
            // analysis 只在非空时才带。PATCH 的判定是 `!== undefined && !== null`，
            // 空字符串照样会写库——原来无条件发 `analysis: it.analysis||''`，
            // 会把题目原有的解析（比如从真题答案区抽出来的【精析】）直接抹掉。
            const row={ id:it.id, answer:it.answer, status:'draft' };
            if(String(it.analysis||'').trim())row.analysis=it.analysis;
            row._warn=it.warn||''; patch.push(row);
          }
          if(patch.length){
            try{
              const r=await this.api('/api/questions',{method:'PATCH',signal:ctrl.signal,body:JSON.stringify({items:patch})});
              const missIds=new Set(((r&&r.missing)||[]).map(String));
              const byId=new Map((this.bank.items||[]).map(x=>[x.id,x]));
              for(const row of patch){
                if(missIds.has(String(row.id))){ note(row.id,'fail','题目已不存在'); this.bankAiFill.failed++; continue; }
                const q=byId.get(row.id);
                if(q){ q.answer=row.answer; if(row.analysis)q.analysis=row.analysis; q.status='draft'; }
                note(row.id, row._warn?'warn':'ok', row.answer.join('、')+(row._warn?('　⚠ '+row._warn):''));
                this.bankAiFill.filled++;
              }
            }catch(e){ if(e.message==='unauth')throw e;
              if(e.name==='AbortError'||ctrl.signal.aborted){ this.bankAiFill.canceled=true; break; }
              for(const row of patch)note(row.id,'fail','写库失败：'+(e.message||'未知错误'));
              this.bankAiFill.failed+=patch.length; }
          }
          for(const mid of ((d&&d.missing)||[]))note(mid,'skip','AI 没有返回这道题');
          this.bankAiFill.skipped+=((d&&d.missing)||[]).length;
        }
        const f=this.bankAiFill;
        const done=f.filled+f.skipped+f.failed;
        this.flash((f.canceled?'已停止（处理了 '+done+' / '+f.total+' 题）：':'')
          +'已补 '+f.filled+' 题'
          +(f.skipped?('；跳过 '+f.skipped+' 题（依赖插图或题干不全）'):'')
          +(f.failed?('；失败 '+f.failed+' 题'):'')
          +'。补出来的都在「待审」里，请过一遍再发布', f.failed>0);
        this.bankDirty=true; this.statsDirty=true; this.queueDirty=true;
      }catch(e){ if(e.message!=='unauth')this.flash('AI 补答案失败：'+e.message,true); }
      if(this._aiFillCtrl===ctrl)this._aiFillCtrl=null;
      this.bankAiFill.busy=false; this.bankAiFill.prog=''; },
bankAiFillStop(){ if(this._aiFillCtrl){ try{ this._aiFillCtrl.abort(); }catch(_){} this.bankAiFill.prog='正在停止…'; } },
bankAiFillClose(){ this.bankAiFill.panel=false; },
async bankBatchTag(){ const ids=[...this.bank.sel]; if(!ids.length){ this.flash('请先勾选题目',true); return; } const t=prompt('给选中 '+ids.length+' 题添加标签（逗号分隔；会与原标签合并去重）：'); if(t===null)return; const add=t.split(/[,，、]/).map(s=>s.trim()).filter(Boolean); if(!add.length){ this.flash('未输入标签',true); return; } try{
        // 合并交给服务端（addTags）：一个请求搞定任意条数，
        // 也不再依赖「这一页 items 里有没有这道题」——跨页勾选以前会被静默跳过。
        const d=await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids,addTags:add})});
        const byId=new Map(); for(const q of this.bank.items)byId.set(q.id,q);
        for(const id of ids){ const q=byId.get(id); if(q)q.tags=[...new Set([...(Array.isArray(q.tags)?q.tags:[]),...add])]; }
        // 用 matched（服务端找到并处理的题数）而不是 updated（实际写入行数）：
        // 已经有这个标签的题不会产生写入，但「标签现在在它身上」这件事仍然成立。
        const n=(d&&d.matched!=null)?d.matched:ids.length;
        const miss=(d&&d.missing)||0;
        this.flash('已为 '+n+' 题添加标签'+(miss?('；'+miss+' 题在题库里找不到'):''), miss>0);
        this.bank.sel=[]; this.loadMeta(true);
      }catch(e){ if(e.message!=='unauth')this.flash('批量加标签失败：'+e.message,true); } },
// 导出选中题为 JSON（拉全字段，便于分享/备份某章节/某批题；未选则导出当前已加载列表）
async bankExportSel(){ const ids=this.bank.sel.length?[...this.bank.sel]:this.bank.items.map(q=>q.id); if(!ids.length){ this.flash('没有可导出的题',true); return; }
      try{ const out=[]; for(let i=0;i<ids.length;i+=200){ const chunk=ids.slice(i,i+200); const d=await this.api('/api/questions?ids='+encodeURIComponent(chunk.join(','))+'&limit=200&order=seq'); for(const q of (d.items||[])){ out.push({ subject:q.subject, chapter:q.chapter||undefined, type:q.type, difficulty:q.difficulty, stem:q.stem, passage:q.passage||undefined, options:q.options||[], answer:q.answer||[], analysis:q.analysis||undefined, tags:q.tags||[], source:q.source||undefined }); } }
        const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='shuati-questions-'+new Date().toISOString().slice(0,10)+'.json'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),3000);
        this.flash('已导出 '+out.length+' 题为 JSON（可在导入页 JSON 导回）');
      }catch(e){ if(e.message!=='unauth')this.flash('导出失败：'+e.message,true); } },
async bankBatchSubject(){ const ids=[...this.bank.sel]; const subj=this.bank.batchSubject; if(!ids.length){ this.flash('请先勾选题目',true); return; } if(!subj){ this.flash('请选择目标科目',true); return; } try{ const d=await this.api('/api/questions',{method:'PATCH',body:JSON.stringify({ids,subject:subj})}); this.flash('已将 '+(d.updated||ids.length)+' 题改为「'+this.subjName(subj)+'」'); this.bank.sel=[]; this.bank.batchSubject=''; this.loadMeta(true); this.statsDirty=true; await this.loadBank(true); }catch(e){ if(e.message!=='unauth')this.flash('批量改科目失败：'+e.message,true); } },
async bankDedup(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } if(!confirm('扫描整个题库，删除题干完全相同的重复题（每组只保留一道）。\n建议先备份。继续？'))return; this.bank.loading=true; try{
        let all=[]; let off=0; const lim=200; while(true){ const p=new URLSearchParams(); p.set('mode','all'); p.set('order','seq'); p.set('limit',lim); p.set('offset',off); const d=await this.api('/api/questions?'+p.toString()); const items=d.items||[]; all=all.concat(items); if(items.length<lim)break; off+=lim; if(off>40000)break; }
        const seen=new Set(); const dupIds=[]; for(const q of all){ const k=(q.subject||'')+'|'+(q.chapter||'')+'|'+_stripFigs(q.stem); if(seen.has(k))dupIds.push(q.id); else seen.add(k); }
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
        const sig=all.map(q=>simhash64(_stripFigs(q.stem||'')+' '+_stripFigs((q.options||[]).map(o=>o&&o.text).join(' '))));
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
        if(!groups.length){ this.dup.open=false; this.flash('没有发现相似重复题（共扫描 '+all.length+' 题）'); }
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
