// 设置：科目管理 / 访问码 / AI 配置读取 / 离线同步
// —— 由 app.js 按功能域拆分而来；与其余 mixin 合并进同一个 Vue 实例，this.* 跨文件可用 ——
const SettingsMixin = { methods: {
classifySubject(t){ const s=String(t||''); const has=c=>this.subjects.some(x=>x.v===c);
      if(has('computer')&&/#include|void\s+main|int\s+main|printf\s*\(|scanf\s*\(|cout\s*<<|cin\s*>>|System\.out|public\s+(class|static|void)|def\s+\w+\s*\(|console\.log|malloc|struct\s+\w+|for\s*\([^;]*;|while\s*\(/.test(s))return'computer';
      if(has('math')&&/\\int|\\lim|\\sum|\\frac|\\sqrt|\\partial|\\overrightarrow|\\mathrm\{d\}/.test(s))return'math';
      const letters=(s.match(/[A-Za-z]/g)||[]).length, cjk=(s.match(/[\u4e00-\u9fa5]/g)||[]).length, len=s.replace(/\s/g,'').length;
      if(has('english')&&len>=12 && letters>=len*0.55 && cjk<=len*0.15 && /\b(the|of|to|and|is|are|was|were|which|that|what|who|how|why|an?|in|on|for|with)\b/i.test(s))return'english';
      for(const sub of this.subjects){ const kws=String(sub.keywords||'').split(/[，,;；\s]+/).map(k=>k.trim()).filter(k=>k.length>=2); for(const k of kws){ if(s.includes(k))return sub.v; } }
      return ''; },
// withOrphans=true 只在设置页首次进入时用一次：孤儿扫描要全表 GROUP BY，
// 而这个方法在保存科目/调顺序/补关键词之后都会被调，无条件扫会把每次操作都拖慢。
async loadSubjects(withOrphans){ if(!this.token)return; try{ const d=await this.api('/api/subjects'+(withOrphans?'?orphans=1':'')); if(d&&Array.isArray(d.items)&&d.items.length){ this.subjects=d.items.map(x=>({v:x.v,t:x.t,sort:x.sort||0,keywords:x.keywords||''})); Object.keys(SUBJ_MAP).forEach(k=>delete SUBJ_MAP[k]); this.subjects.forEach(s=>{ SUBJ_MAP[s.v]=s.t; }); }
  // 孤儿科目：题目/教材引用了某个 subject 但科目表里没有这一行。
  // 不显示出来的话，用户只会看到教材列表的分组标题变成原始代码（「politics 1 本」），
  // 完全不知道发生了什么、更不知道重建科目时代码必须一模一样。
  if(Array.isArray(d&&d.orphans))this.subjOrphans=d.orphans;   // 不带 orphans=1 的调用不覆盖已有结果
  this.subjDefaults=Array.isArray(d&&d.defaults)?d.defaults:[];
  }catch(e){} },
// 一键重建某个内置科目（灰色 chip）。代码取内置定义，名称和关键词也一并恢复，
// 所以之前挂在这个代码下的题目/教材会自动归位 —— 这正是误删之后最需要的一步。
// 内置科目 chip 的三态：ok=正常 / nokw=存在但没关键词 / gone=科目被删了
subjChipState(d){
  const cur=(this.subjects||[]).find(x=>x.v===d.code);
  if(!cur)return 'gone';
  return String(cur.keywords||'').trim() ? 'ok' : 'nokw';
},
subjChipTip(d){
  const st=this.subjChipState(d);
  if(st==='ok')return d.name+'（'+d.code+'）正常';
  if(st==='nokw')return '「'+d.name+'」没有关键词，点一下补回默认值';
  return '科目「'+d.name+'」不存在，点一下按代码 '+d.code+' 重建';
},
// chip 点击 → 打开居中弹窗说明要做什么，由弹窗里的按钮确认。
// 不用浏览器原生 confirm：它弹在屏幕顶部、样式不可控，而且没法展示关键词列表。
subjChipClick(d){
  if(!d || !d.code || this.subjChipBusy)return;
  const st=this.subjChipState(d);
  if(st==='ok')return;
  const cur=(this.subjects||[]).find(x=>x.v===d.code);
  const o=(this.subjOrphans||[]).find(x=>x.code===d.code);
  const what=o?[o.questions?(o.questions+' 道题'):'', o.materials?(o.materials+' 页教材'):''].filter(Boolean).join('、'):'';
  const kws=String(d.keywords||'').split(',').map(x=>x.trim()).filter(Boolean);
  this.subjChipDlg={
    code:d.code, name:d.name, state:st, def:d,
    title: st==='nokw' ? ('补回「'+d.name+'」的默认关键词') : ('重建科目「'+d.name+'」'),
    desc: st==='nokw'
      ? '这个科目现在没有关键词，导入时无法自动归类。下面是内置的默认关键词，确认后写入。'
      : (what ? ('目前有 '+what+' 挂在代码 '+d.code+' 下（科目被删过）。按原代码重建后，这些内容会自动归位。')
              : ('将按代码 '+d.code+' 重建这个科目，并恢复它的默认关键词。')),
    code_hint:d.code, kws, moved:what,
  };
},
subjChipDlgClose(){ if(!this.subjChipBusy)this.subjChipDlg=null; },
async subjChipDlgOk(){
  const dlg=this.subjChipDlg; if(!dlg || this.subjChipBusy)return;
  await this.subjRestoreDefault(dlg.def);
  if(!this.subjChipBusy)this.subjChipDlg=null;
},
// 实际干活。确认已经在弹窗里做过了，这里不再 confirm。
async subjRestoreDefault(d){
  if(!d || !d.code)return;
  // 防连点：一次要等 PATCH/POST + 重新拉科目列表，慢的时候用户会以为没反应而反复按，
  // 结果同一个科目被重复写好几次（上一版就是这样）。
  if(this.subjChipBusy)return;
  const cur=(this.subjects||[]).find(x=>x.v===d.code);
  if(cur){
    if(String(cur.keywords||'').trim()){ this.flash('科目「'+cur.t+'」已存在且有关键词',true); return; }
    this.subjChipBusy=d.code;
    try{
      await this.api('/api/subjects',{method:'PATCH',body:JSON.stringify({
        code:cur.v, name:cur.t, sort:Number(cur.sort)||0, keywords:d.keywords||'' })});
      this.flash('已补回「'+cur.t+'」的默认关键词');
      await this.loadSubjects();
    }catch(e){ if(e.message!=='unauth')this.flash('补回失败：'+e.message,true); }
    finally{ this.subjChipBusy=''; }
    return;
  }
  const o=(this.subjOrphans||[]).find(x=>x.code===d.code);
  const what=o?[o.questions?(o.questions+' 道题'):'', o.materials?(o.materials+' 页教材'):''].filter(Boolean).join('、'):'';
  this.subjChipBusy=d.code;
  try{
    await this.api('/api/subjects',{method:'POST',body:JSON.stringify({
      code:d.code, name:d.name, sort:d.sort||((this.subjects.length+1)*10), keywords:d.keywords||'' })});
    this.flash('已重建科目「'+d.name+'」'+(what?('，'+what+' 已归位'):''));
    await this.loadSubjects(true); this.loadMeta&&this.loadMeta(true);
    if(what){ this.bankDirty=true; this.queueDirty=true; this.statsDirty=true; }
  }catch(e){ if(e.message!=='unauth')this.flash('重建失败：'+e.message,true); }
  finally{ this.subjChipBusy=''; }
},
// 一键重建缺失的科目：代码必须和内容里引用的完全一致，内容才会自动归位
async subjRestoreOrphan(o){
  const name=String(o.suggestName||o.code);
  const what=[o.questions?(o.questions+' 道题'):'', o.materials?(o.materials+' 页教材'):''].filter(Boolean).join('、');
  if(!confirm('重建科目「'+name+'」（代码 '+o.code+'）？\n\n'
    +'这些内容目前挂在一个不存在的科目上：'+what+'。\n'
    +'重建后它们会自动归位。'))return;
  try{
    await this.api('/api/subjects',{method:'POST',body:JSON.stringify({
      code:o.code, name, sort:(this.subjects.length+1)*10, keywords:o.suggestKeywords||'' })});
    this.flash('已重建科目「'+name+'」，'+what+' 已归位');
    await this.loadSubjects(); this.loadMeta&&this.loadMeta(true);
    this.bankDirty=true; this.queueDirty=true; this.statsDirty=true;
  }catch(e){ if(e.message!=='unauth')this.flash('重建失败：'+e.message,true); }
},
async subjAdd(){ const m=this.subjMgr; const code=String(m.code||'').trim().toLowerCase().replace(/[^a-z0-9_]/g,''); const name=String(m.name||'').trim(); if(!code){ this.flash('科目代码只能用小写字母/数字/下划线',true); return; } if(!name){ this.flash('请填写科目名称',true); return; } m.busy=true; try{ await this.api('/api/subjects',{method:'POST',body:JSON.stringify({code,name,sort:Number(m.sort)||(this.subjects.length+1),keywords:m.keywords||''})}); this.flash('已新增科目「'+name+'」'); this.subjMgr={ code:'', name:'', sort:'', keywords:'', busy:false }; await this.loadSubjects(); }catch(e){ if(e.message!=='unauth')this.flash('新增失败：'+e.message,true); } m.busy=false; },
async subjSave(s){ try{ await this.api('/api/subjects',{method:'PATCH',body:JSON.stringify({code:s.v,name:s.t,sort:Number(s.sort)||0,keywords:s.keywords||''})}); this.flash('已保存「'+s.t+'」'); await this.loadSubjects(); }catch(e){ if(e.message!=='unauth')this.flash('保存失败：'+e.message,true); } },
// 科目排序：上移/下移一格后批量写回 sort（触摸端比拖拽可靠）
async subjMove(i,dir){ const j=i+dir; if(j<0||j>=this.subjects.length)return; const arr=[...this.subjects]; const t=arr[i]; arr[i]=arr[j]; arr[j]=t; this.subjects=arr; await this.subjReorder(); },
async subjReorder(){ try{ for(let i=0;i<this.subjects.length;i++){ const s=this.subjects[i]; const ns=(i+1)*10; if(s.sort!==ns){ s.sort=ns; await this.api('/api/subjects',{method:'PATCH',body:JSON.stringify({code:s.v,name:s.t,sort:ns,keywords:s.keywords||''})}); } } this.flash('科目顺序已更新'); await this.loadSubjects(); }catch(e){ if(e.message!=='unauth')this.flash('排序保存失败：'+e.message,true); } },
async subjDelete(s){
  // 删除科目是不可逆的。原来的流程是「先删了再说」：只有后端返回 409（科目下有题目）
  // 才弹确认，科目为空就直接删掉、零提示 —— 手滑点到「删除」就没了。
  // 而且后端的「为空」只数题目不数教材，所以「0 题 + 278 页教材」的科目会被判成空，
  // 静默删掉之后那些教材页还挂着一个已不存在的 subject，变成孤儿。
  const doDelete=async (opts)=>await this.api('/api/subjects',{method:'DELETE',
    body:JSON.stringify(Object.assign({code:s.v}, opts||{}))});

  // 先用 dry_run 探数量 —— 绝不能靠「发一次真删」来探测，那样空科目在用户
  // 还没确认的时候就已经没了。
  let q=0, m=0;
  try{
    const probe=await doDelete({dry_run:1});
    q=(probe&&probe.questions)||0; m=(probe&&probe.materials)||0;
  }catch(e){
    if(e && e.message!=='unauth')this.flash('无法读取科目内容：'+e.message,true);
    return;
  }

  // 空科目也要确认。科目配置（代码、名称、关键词、排序）删了就没了，
  // 而这个按钮就挨着「保存」，手滑代价不该是静默丢失。
  if(!q && !m){
    if(!confirm('删除空科目「'+s.t+'」？\n\n它下面没有题目和教材，但科目本身的关键词、排序等配置会一并删除。'))return;
    try{
      await doDelete({force:true});
      this.flash('已删除空科目「'+s.t+'」');
      await this.loadSubjects(); this.loadMeta&&this.loadMeta(true);
    }catch(e){ if(e.message!=='unauth')this.flash('删除失败：'+e.message,true); }
    return;
  }

  const what=[q?(q+' 道题目'):'', m?(m+' 页教材'):''].filter(Boolean).join(' 和 ');
  // 优先引导「转移」而不是「删除」——后端一直支持 moveTo，前端以前没用上
  const others=(this.subjects||[]).filter(x=>x.v!==s.v);
  if(others.length && confirm('科目「'+s.t+'」下还有 '+what+'。\n\n'
      +'点「确定」：先把它们转移到别的科目，再删掉这个科目（内容保留）。\n'
      +'点「取消」：进入删除流程。')){
    const list=others.map((x,i)=>(i+1)+'. '+x.t+'（'+x.v+'）').join('\n');
    const pick=prompt('转移到哪个科目？输入序号：\n\n'+list);
    if(pick==null)return;
    const idx=parseInt(String(pick).trim(),10)-1;
    const target=others[idx];
    if(!target){ this.flash('序号无效，已取消',true); return; }
    try{
      const r=await doDelete({moveTo:target.v});
      this.flash('已把 '+what+' 转移到「'+target.t+'」，并删除科目「'+s.t+'」');
      await this.loadSubjects(); this.loadMeta&&this.loadMeta(true);
      this.bankDirty=true; this.queueDirty=true; this.statsDirty=true;
      void r;
    }catch(e){ if(e.message!=='unauth')this.flash('转移失败：'+e.message,true); }
    return;
  }

  // 二次确认：要求手动输入科目名，防止手滑（这一步会连内容一起永久删除）
  const typed=prompt('这会永久删除科目「'+s.t+'」及其下的 '+what+'，不可恢复。\n\n'
    +'确认请输入科目名：'+s.t);
  if(typed==null)return;
  if(String(typed).trim()!==String(s.t).trim()){ this.flash('输入不匹配，已取消删除',true); return; }
  try{
    const r=await doDelete({force:true});
    const done=[(r&&r.removedQuestions)?((r.removedQuestions)+' 道题'):'',
                (r&&r.removedMaterials)?((r.removedMaterials)+' 页教材'):''].filter(Boolean).join('、');
    this.flash('已删除科目「'+s.t+'」'+(done?('及其下 '+done):''));
    await this.loadSubjects(); this.loadMeta&&this.loadMeta(true);
    this.bankDirty=true; this.queueDirty=true; this.statsDirty=true;
  }catch(e){ if(e.message!=='unauth')this.flash('删除失败：'+e.message,true); }
},
guessSubject(name,content){ const s=String(name||''); if(/高\s*等?\s*数学|高数|微积分|线性代数|概率|数学分析|离散数学/.test(s))return'math'; if(/英语|阅读理解|完形|词汇|语法|写作|四级|六级|English/i.test(s))return'english'; if(/毛泽东|思想政治|马克思|马原|毛概|史纲|思修|中国特色|理论体系|政治/.test(s))return'politics'; if(/数据结构|程序设计|C\s*语言|C\+\+|计算机|算法|操作系统|数据库|Java|Python|软件|编程/i.test(s))return'computer'; return this.classifySubject(s+'  '+String(content||'').slice(0,1200)); },
saveExplainCfg(){ try{ localStorage.setItem('zb_explaincfg', JSON.stringify(this.explainCfg)); }catch(_){} },
toggleAutoSaveAi(){ this.autoSaveAi=!this.autoSaveAi; try{ localStorage.setItem('zb_autosave_ai', this.autoSaveAi?'1':'0'); }catch(_){} this.flash(this.autoSaveAi?'已开启：AI 解析/知识点卡片将自动存入题目':'已关闭自动保存'); },
// 折叠卡「点外部收起全部」：挂 document 级（整页任意位置都覆盖，含内容区两侧留白、卡片下方空白）
// 仅在设置页生效；点在折叠卡头/体内部时不干预（交给卡自身的点头折叠）
settBlankClick(e){
  if(this.view!=='settings') return;
  const t=e.target;
  if(this.modelBoxOpen && t && t.closest && !t.closest('.model-suggest') && !(t.tagName==='INPUT' && t.closest('.field'))) this.modelBoxOpen=false;
  if(t && t.closest && t.closest('.fold-head, .fold-body')) return;
  for(const k in this.settFold){ if(!this.settFold[k]) this.settFold[k]=true; }
},
// 从中转站 /v1/models 拉取可用模型（经后端代理，Key 不直连上游）
async fetchModels(){ if(this.modelPick.busy)return;
  if(this.explainCfg.base && !this.explainCfg.key){ this.flash('填了 Base URL 就必须填对应的 API Key',true); return; }
  if(!this.explainCfg.base && !this.explainCfg.key){ this.flash('请先填 Base URL 与 API Key（或直接手输模型名）',true); return; }
  this.modelPick.busy=true; this.modelPick.list=[];
  try{
    const d=await this.api('/api/aimodels',{method:'POST',body:JSON.stringify({base_url:this.explainCfg.base,api_key:this.explainCfg.key})});
    this.modelPick.list=d.models||[];
    this.flash('拉到 '+this.modelPick.list.length+' 个模型，点选即可填入');
  }catch(e){ if(e.message!=='unauth')this.flash('拉取失败：'+e.message,true); }
  this.modelPick.busy=false;
},
async testAiConnection(){ if(this.aiTestBusy)return;
  const cfg=this.explainCfg;
  if(!cfg.base && !cfg.key){ this.flash('请先填 Base URL 与 API Key',true); return; }
  if(cfg.base && !cfg.key){ this.flash('填了 Base URL 就必须填对应的 API Key',true); return; }
  if(!cfg.model){ this.flash('请先填写要测试的模型名',true); return; }
  this.aiTestBusy=true;
  const t0=Date.now();
  try{
    const r=await this.aiFetch({ base_url:cfg.base, api_key:cfg.key, model:cfg.model, question:{ stem:'请回复"连接成功"四个字。', type:'short_answer' }, stream:false }, null, null);
    const ms=Date.now()-t0;
    if(r.ok){ this.flash('✅ 连接成功！模型 '+cfg.model+' 响应正常（'+ms+'ms）'); }
    else { this.flash('❌ 连接失败：'+(r.errText||'HTTP '+((r.res&&r.res.status)||'?')),true); }
  }catch(e){ this.flash('❌ 连接失败：'+(e.message||'未知错误'),true); }
  this.aiTestBusy=false;
},
pickModel(m){ this.explainCfg.model=m; this.saveExplainCfg(); this.flash('已选用模型：'+m); },
saveExplainStable(){ try{ localStorage.setItem('zb_explain_stable', this.explainStable?'1':'0'); }catch(_){} },
async loadConfig(){ if(!this.token)return; try{ const c=await this.api('/api/config'); this.ai.model=c.ai_model||''; this.ai.visionModel=c.ai_vision_model||''; this.ai.hasAI=!!c.has_ai; this.ai.hasCfAI=!!c.has_cf_ai; this.ai.hasMineru=!!c.has_mineru; }catch(e){} },
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
        // 离线要能读正文，所以不能用 meta=1；带正文的一页限 500 行，必须翻页拉全
        // （旧版直接 ?limit=2000，服务端夹到 500，离线包静默只装了前 500 段）
        let materials=[], moff=0;
        try{ for(let i=0;i<200;i++){ const d=await this.api('/api/materials?limit=500&offset='+moff); const items=d.items||[]; materials=materials.concat(items); this.offlineSyncMsg='已下载教材 '+materials.length+' 段…'; if(items.length<500)break; moff+=items.length; } }catch(_){ }
        await this._offBulkPut('questions', questions);
        await this._offBulkPut('materials', materials);
        await this._offBulkPut('syncedAt', Date.now());
        this.offlineSynced={ q:questions.length, m:materials.length, at:Date.now() };
        this.flash('离线包已就绪：题目 '+questions.length+' 道、教材 '+materials.length+' 页，断网也能刷');
      }catch(e){ if(e.message!=='unauth')this.flash('下载失败：'+e.message,true); }
      this.offlineSyncing=false; this.offlineSyncMsg='';
    },
async _loadOfflineSynced(){ try{ const at=await this._offBulk('syncedAt'); if(at){ const qs=await this._offBulk('questions'); const ms=await this._offBulk('materials'); this.offlineSynced={ q:(qs||[]).length, m:(ms||[]).length, at }; } }catch(_){ } }
} };
