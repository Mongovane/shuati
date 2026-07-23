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
async loadSubjects(){ if(!this.token)return; try{ const d=await this.api('/api/subjects'); if(d&&Array.isArray(d.items)&&d.items.length){ this.subjects=d.items.map(x=>({v:x.v,t:x.t,sort:x.sort||0,keywords:x.keywords||''})); Object.keys(SUBJ_MAP).forEach(k=>delete SUBJ_MAP[k]); this.subjects.forEach(s=>{ SUBJ_MAP[s.v]=s.t; }); } }catch(e){} },
async subjAdd(){ const m=this.subjMgr; const code=String(m.code||'').trim().toLowerCase().replace(/[^a-z0-9_]/g,''); const name=String(m.name||'').trim(); if(!code){ this.flash('科目代码只能用小写字母/数字/下划线',true); return; } if(!name){ this.flash('请填写科目名称',true); return; } m.busy=true; try{ await this.api('/api/subjects',{method:'POST',body:JSON.stringify({code,name,sort:Number(m.sort)||(this.subjects.length+1),keywords:m.keywords||''})}); this.flash('已新增科目「'+name+'」'); this.subjMgr={ code:'', name:'', sort:'', keywords:'', busy:false }; await this.loadSubjects(); }catch(e){ if(e.message!=='unauth')this.flash('新增失败：'+e.message,true); } m.busy=false; },
async subjSave(s){ try{ await this.api('/api/subjects',{method:'PATCH',body:JSON.stringify({code:s.v,name:s.t,sort:Number(s.sort)||0,keywords:s.keywords||''})}); this.flash('已保存「'+s.t+'」'); await this.loadSubjects(); }catch(e){ if(e.message!=='unauth')this.flash('保存失败：'+e.message,true); } },
// 科目排序：上移/下移一格后批量写回 sort（触摸端比拖拽可靠）
async subjMove(i,dir){ const j=i+dir; if(j<0||j>=this.subjects.length)return; const arr=[...this.subjects]; const t=arr[i]; arr[i]=arr[j]; arr[j]=t; this.subjects=arr; await this.subjReorder(); },
async subjReorder(){ try{ for(let i=0;i<this.subjects.length;i++){ const s=this.subjects[i]; const ns=(i+1)*10; if(s.sort!==ns){ s.sort=ns; await this.api('/api/subjects',{method:'PATCH',body:JSON.stringify({code:s.v,name:s.t,sort:ns,keywords:s.keywords||''})}); } } this.flash('科目顺序已更新'); await this.loadSubjects(); }catch(e){ if(e.message!=='unauth')this.flash('排序保存失败：'+e.message,true); } },
async subjDelete(s){
  // 先尝试删除（后端会检查是否为空）；非空则返回 409 + 题目数
  const doDelete=async (force)=>{
    return await this.api('/api/subjects',{method:'DELETE',body:JSON.stringify({code:s.v,force:!!force})});
  };
  try{
    await doDelete(false);
    this.flash('\u5df2\u5220\u9664\u79d1\u76ee\u300c'+s.t+'\u300d');
    await this.loadSubjects(); this.loadMeta&&this.loadMeta(true);
  }catch(e){
    // 后端拒绝：该科目下还有题目
    if(e && e.status===409 && e.data && e.data.error==='subject_not_empty'){
      const n=e.data.count||0;
      if(confirm('\u79d1\u76ee\u300c'+s.t+'\u300d\u4e0b\u8fd8\u6709 '+n+' \u9053\u9898\u76ee\u3002\n\n\u5fc5\u987b\u5148\u5904\u7406\u8fd9\u4e9b\u9898\u76ee\u624d\u80fd\u5220\u9664\u79d1\u76ee\u3002\n\n\u70b9\u300c\u786e\u5b9a\u300d\uff1a\u8fde\u540c\u8fd9 '+n+' \u9053\u9898\u76ee\u4e00\u8d77\u5220\u9664\uff08\u4e0d\u53ef\u6062\u590d\uff09\uff1b\u70b9\u300c\u53d6\u6d88\u300d\uff1a\u4fdd\u7559\u3002')){
        try{
          const r=await doDelete(true);
          this.flash('\u5df2\u5220\u9664\u79d1\u76ee\u300c'+s.t+'\u300d\u53ca\u5176\u4e0b '+((r&&r.removedQuestions)||n)+' \u9053\u9898');
          await this.loadSubjects(); this.loadMeta&&this.loadMeta(true); this.bankDirty=true; this.statsDirty=true;
        }catch(e2){ if(e2.message!=='unauth')this.flash('\u5220\u9664\u5931\u8d25\uff1a'+e2.message,true); }
      }
      return;
    }
    if(e.message!=='unauth')this.flash('\u5220\u9664\u5931\u8d25\uff1a'+e.message,true);
  }
},
guessSubject(name,content){ const s=String(name||''); if(/高\s*等?\s*数学|高数|微积分|线性代数|概率|数学分析|离散数学/.test(s))return'math'; if(/英语|阅读理解|完形|词汇|语法|写作|四级|六级|English/i.test(s))return'english'; if(/毛泽东|思想政治|马克思|马原|毛概|史纲|思修|中国特色|理论体系|政治/.test(s))return'politics'; if(/数据结构|程序设计|C\s*语言|C\+\+|计算机|算法|操作系统|数据库|Java|Python|软件|编程/i.test(s))return'computer'; return this.classifySubject(s+'  '+String(content||'').slice(0,1200)); },
saveExplainCfg(){ try{ localStorage.setItem('zb_explaincfg', JSON.stringify(this.explainCfg)); }catch(_){} },
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
        let materials=[]; try{ const d=await this.api('/api/materials?limit=2000'); materials=d.items||[]; }catch(_){ }
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
