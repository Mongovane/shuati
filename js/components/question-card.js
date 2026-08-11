// 填空判分归一化：全角→半角（１２ａｂ（）→12ab()）、全角空格、去空白、小写
const normAns=(v)=>String(v==null?'':v)
  .replace(/[\uFF01-\uFF5E]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0xFEE0))
  .replace(/\u3000/g,' ')
  .trim().toLowerCase().replace(/\s+/g,'');

const QuestionCard={
  components:{ RichText },
  props:{ q:Object, mode:{type:String,default:'practice'}, canAi:{type:Boolean,default:false}, aiText:{type:String,default:''}, aiReasoning:{type:String,default:''}, aiBusy:{type:Boolean,default:false}, aiChat:{type:Array,default:()=>[]}, aiAsking:{type:Boolean,default:false}, aiModel:{type:String,default:''}, aiKind:{type:String,default:''}, aiCards:{type:Array,default:()=>[]}, aiFlip:{type:Object,default:()=>({})}, hasExplain:{type:Boolean,default:false}, hasConcept:{type:Boolean,default:false}, allFlipped:{type:Boolean,default:false}, initState:{type:Object,default:null}, examReveal:Boolean },
  emits:['answered','favorite','master','note','next','ai-explain','ai-concept','ai-explain-redo','ai-concept-redo','ai-save','ai-ask','ai-note','ai-retry','seg-mode','card-flip','cards-flip-all','save-state','ai-stop','ai-clear-chat'],
  // 这里原来有两个 watch:{}（一个在 computed 前、一个在 mounted 前），
  // 后者把前者整个覆盖掉，aiReasoning / aiText / aiChat / aiBusy 四个监听全部不生效：
  // 推理过程不自动滚到底、正文出来后推理区不自动折叠、追问不跟随滚动、请求开始时推理区不展开。
  // 合并成一个。
  watch:{
    q(){ this.reset(); },
    segMode(v){ this.$emit('seg-mode', v); },
    aiKind(nv, ov){ if(nv&&ov&&nv!==ov){ this.$nextTick(()=>{ try{ const el=this.$refs.aiBox; if(el&&el.scrollIntoView) el.scrollIntoView({ behavior:'smooth', block:'start' }); }catch(_){} }); } },
    aiReasoning(){ this.$nextTick(()=>{ const el=this.$refs.reasonBody; if(el&&this.aiBusy)el.scrollTop=el.scrollHeight; }); },
    aiText(v){ if(this.aiBusy) this._chatScroll(); if(v && this.localReasonOpen && this.aiReasoning && !this._reasonAutoCollapsed){ this.localReasonOpen=false; this._reasonAutoCollapsed=true; } },
    aiChat:{ deep:true, handler(){ if(this.aiAsking) this._chatScroll(); } },
    aiBusy(v){ if(v){ this.localReasonOpen=true; this._reasonAutoCollapsed=false; this.stickBottom=true; } },
    aiAsking(v){ if(v)this.stickBottom=true; },
  },
  data(){ return { sel:[], blanks:'', blanksArr:[], text:'', localRevealed:false, self:null, selfGrade:null, t0:Date.now(), showNote:false, noteEdit:false, noteDraft:'', askInput:'', copied:'', segMode:false, segCount:0, showRaw:false, kcardMode:'grid', kcardIdx:0, localReasonOpen:true, _reasonAutoCollapsed:false, passageOpen:false, chatReasonOpen:{}, stickBottom:true }; },
  computed:{
    // 阅读材料很长时（截图里那篇 side jobs 有 1600+ 字符）整屏都被材料占满，
    // 题干和选项被顶到折叠线以下，必须先滚很久才能看到在问什么。
    // 超过阈值就默认折叠，留一个「展开全文」。阈值按字符数而不是行数——
    // 英文一行能塞很多字，按行数判断在窄屏上会误判。
    passageLong(){
      // 完形填空绝不能折叠：材料里的那个空就是题目本身，折起来就没法做了
      if(this.clozeNo)return false;
      return String((this.q&&this.q.passage)||'').length > 460; },
    // 英文材料用西文字体和更松的行距排；中文材料保持原样，避免中文被西文字体接管
    passageEnglish(){ const p=String((this.q&&this.q.passage)||''); if(!p)return false;
      const cjk=(p.match(/[\u4e00-\u9fa5]/g)||[]).length; return cjk / p.length < 0.15; },
    passageWords(){ const p=String((this.q&&this.q.passage)||'');
      return this.passageEnglish ? ((p.match(/[A-Za-z][A-Za-z'-]*/g)||[]).length + ' words') : (p.length + ' 字'); },
    // 完形填空：当前这道题问的是第几个空（题干形如「（完形填空 第 21 空）」）
    clozeNo(){ const m=String((this.q&&this.q.stem)||'').match(/第\s*([0-9]{1,3})\s*空/); return m?parseInt(m[1],10):0; },
    // 短文里的空由抽题阶段标成「＿＿21＿＿」。这里再套一层 span：
    // 当前这道题的空高亮，其余的灰着，做题时一眼能看出在填哪个。
    passageText(){ const p=String((this.q&&this.q.passage)||''); if(!p||!this.clozeNo)return p;
      return p.replace(/\uFF3F\uFF3F([0-9]{1,3})\uFF3F\uFF3F/g,
        (m,n)=>'<span class="cloze'+(parseInt(n,10)===this.clozeNo?' cur':'')+'">'+n+'</span>'); },
    subjMap(){ return SUBJ_MAP; }, typeMap(){ return TYPE_MAP; },
    revealed(){ return this.mode==='exam'?this.examReveal:this.localRevealed; },
    isObjective(){ return OBJECTIVE.includes(this.q.type); },
    isChoice(){ return this.q.type==='single_choice'||this.q.type==='multiple_choice'; },
    isMulti(){ return this.q.type==='multiple_choice'; },
    answerKeys(){ return (this.q.answer||[]).map(x=>String(x).toUpperCase()); },
    blankCount(){ if(this.q.type!=='fill_blank')return 1; let n=1; for(const a of (this.q.answer||[])){ const k=String(a).split('||').length; if(k>n)n=k; } return n; },
    isMultiBlank(){ return this.q.type==='fill_blank' && this.blankCount>1; },
    ansDisplay(){ /* 填空答案展示：多空各空用 ⁄ 分隔，多个备选写法用「或」连接 */
      if(this.q.type!=='fill_blank') return this.answerKeys.join(', ');
      return (this.q.answer||[]).map(a=>String(a).split('||').join(' ⁄ ')).join('　或　'); },
    mcPartial(){ /* 多选少选（所选都对但不全）→ 半分 */
      if(!this.isMulti||!this.sel.length)return false;
      const A=new Set(this.answerKeys);
      return this.sel.every(k=>A.has(k)) && this.sel.length<A.size; },
    refText(){ return (this.q.answer||[]).join('\n'); },
    autoCorrect(){
      if(this.isChoice){ const a=[...this.answerKeys].sort().join(','); const b=[...this.sel].sort().join(','); return a===b&&b!==''; }
      if(this.q.type==='true_false'){ return this.sel[0]===this.answerKeys[0]; }
      if(this.q.type==='fill_blank'){
        if(this.isMultiBlank){
          const user=this.blanksArr.map(normAns);
          if(user.length!==this.blankCount || user.some(x=>!x))return false;
          return (this.q.answer||[]).some(a=>{ const parts=String(a).split('||').map(normAns); return parts.length===user.length && parts.every((x,i)=>x===user[i]); });
        }
        const m=normAns(this.blanks); if(!m)return false;
        return (this.q.answer||[]).some(a=>normAns(a)===m);
      }
      return false;
    },
    finalCorrect(){ if(AUTO.includes(this.q.type))return this.autoCorrect; if(this.q.type==='fill_blank')return this.self!=null?this.self:this.autoCorrect; return this.self===true; },
    graded(){ if(AUTO.includes(this.q.type))return true; return this.self!=null; },
  },
  mounted(){ this.reset(); if(this.initState){ this.restoreState(this.initState); }
    this._userScroll=this._onUserScroll.bind(this); this._scroll=this._onScroll.bind(this);
    for(const ev of ['wheel','touchmove','keydown'])window.addEventListener(ev,this._userScroll,{passive:true});
    window.addEventListener('scroll',this._scroll,{passive:true});
  },
  beforeUnmount(){ try{ this.$emit('save-state', { id:this.q&&this.q.id, state:this.snapState() }); }catch(_){}
    for(const ev of ['wheel','touchmove','keydown'])window.removeEventListener(ev,this._userScroll);
    window.removeEventListener('scroll',this._scroll);
  },
  methods:{
    taGrow(e){ const el=e&&e.target; if(!el)return; el.style.height='auto'; el.style.height=Math.min(el.scrollHeight+2, Math.round(window.innerHeight*0.5))+'px'; },
    segToggle(){ this.segMode=!this.segMode; if(!this.segMode)this._segClear(); },
    _segBox(){ return this.$refs.aiBox; },
    _segClear(){ const b=this._segBox(); if(b)b.querySelectorAll('.seg-sel').forEach(el=>el.classList.remove('seg-sel')); this.segCount=0; },
    segClick(e){ if(!this.segMode)return; if(e.target.closest('button,input,textarea,a'))return;
      const box=this._segBox(); if(!box)return;
      const blk=e.target.closest('.code-wrap,.katex-display,.prob,li,pre,blockquote,table,h1,h2,h3,h4,h5,h6,p');
      if(!blk||!box.contains(blk))return;
      e.preventDefault(); blk.classList.toggle('seg-sel');
      this.segCount=box.querySelectorAll('.seg-sel').length; },
    _segText(el){
      if(el.classList.contains('code-wrap')){ const cd=el.querySelector('pre code, pre'); return '```\n'+(cd?cd.textContent.replace(/\n$/,''):'')+'\n```'; }
      if(el.classList.contains('katex-display')){ const a=el.querySelector('annotation'); return a?('$$'+a.textContent+'$$'):el.textContent.trim(); }
      const clone=el.cloneNode(true);
      clone.querySelectorAll('.code-copy').forEach(b=>b.remove());
      clone.querySelectorAll('.katex-display').forEach(k=>{ const a=k.querySelector('annotation'); k.replaceWith(clone.ownerDocument.createTextNode(a?(' $$'+a.textContent+'$$ '):k.textContent)); });
      clone.querySelectorAll('.katex').forEach(k=>{ const a=k.querySelector('annotation'); k.replaceWith(clone.ownerDocument.createTextNode(a?('$'+a.textContent+'$'):k.textContent)); });
      return clone.textContent.replace(/[ \t]+/g,' ').trim(); },
    segTexts(){ const box=this._segBox(); if(!box)return [];
      return Array.from(box.querySelectorAll('.seg-sel')).filter(el=>!el.parentElement.closest('.seg-sel')).map(el=>this._segText(el)).filter(Boolean); },
    async segCopy(){ const parts=this.segTexts(); if(!parts.length)return; await this.copyText(parts.join('\n\n'),'seg'); this.segMode=false; this._segClear(); },
    segQuote(){ const parts=this.segTexts(); if(!parts.length)return;
      this.askInput=('关于这段：'+parts.join(' ')+' —— ').slice(0,1800); this.segMode=false; this._segClear();
      this.$nextTick(()=>{ const el=this.$refs.askInp; if(!el)return; el.focus();
        const n=el.value.length; try{ el.setSelectionRange(n,n); }catch(_){}
        el.scrollLeft=el.scrollWidth; }); },
    async copyText(txt,key){ try{
        if(navigator.clipboard&&navigator.clipboard.writeText){ await navigator.clipboard.writeText(txt); }
        else { const ta=document.createElement('textarea'); ta.value=txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
        this.copied=key; setTimeout(()=>{ if(this.copied===key)this.copied=''; },1500);
      }catch(_){} },
    doAsk(){ const t=this.askInput.trim(); if(!t||this.aiAsking)return; this.$emit('ai-ask',t); this.askInput=''; this.$nextTick(()=>this._chatScroll()); },
    // 生成过程中默认贴底跟随，但一旦用户自己往上滑就撒手 —— 不能强按着人看完。
    // 判定只认「明确的用户手势」（滚轮 / 触摸拖动 / 翻页键），不认 scroll 事件，
    // 因为我们自己的 smooth 滚动同样会触发 scroll，用它判断会自己把自己关掉。
    _nearBottom(gap){ const d=document.documentElement;
      return (d.scrollHeight - window.scrollY - window.innerHeight) <= (gap==null?90:gap); },
    _onUserScroll(e){
      const up = e.type==='wheel' ? e.deltaY<0
        : e.type==='keydown' ? ['PageUp','ArrowUp','Home'].includes(e.key)
        : true;                       // touchmove：方向拿不准，一律当成用户接管
      if(up && this.stickBottom)this.stickBottom=false;
    },
    _onScroll(){ if(!this.stickBottom && this._nearBottom())this.stickBottom=true; },
    backToBottom(){ this.stickBottom=true; this._chatScroll(); },
    _chatScroll(force){ if(!force && !this.stickBottom)return;
      this.$nextTick(()=>{ this.$nextTick(()=>{
      // 双 nextTick：第一层等 Vue 更新 DOM，第二层等浏览器布局完成
      try{ window.scrollTo({top:document.documentElement.scrollHeight,behavior:'smooth'}); }catch(_){}
    }); }); },
    // 英语卡片的 formula 放的是句型结构（not only ... but also ...），不是 LaTeX，
    // 拿不到 .kcard-formula .katex 那个高亮胶囊，单独标一下好上样式
    isTextFormula(f){ return !!String(f||'').trim() && !/\$/.test(f); },
    reset(){ this.sel=[]; this.blanks=''; this.blanksArr=Array.from({length:this.blankCount},()=>''); this.text=''; this.localRevealed=false; this.self=null; this.selfGrade=null; this.t0=Date.now(); this.showNote=false; this.noteDraft=this.q.note||''; this.passageOpen=false; this.stickBottom=true; this.chatReasonOpen={}; if(this.segMode){ this.segMode=false; this.segCount=0; } },
    // —— 作答状态快照 / 恢复（模考断点续考用；由父组件通过 $refs 调用）——
    snapState(){ return { sel:this.sel.slice(), blanks:this.blanks, blanksArr:this.blanksArr.slice(), text:this.text, self:this.self, selfGrade:this.selfGrade, revealed:this.localRevealed }; },
    restoreState(s){ if(!s||typeof s!=='object')return;
      this.sel=Array.isArray(s.sel)?s.sel.slice():[];
      this.blanks=typeof s.blanks==='string'?s.blanks:'';
      if(Array.isArray(s.blanksArr)){ const a=Array.from({length:this.blankCount},(_,i)=>String(s.blanksArr[i]||'')); this.blanksArr=a; }
      this.text=typeof s.text==='string'?s.text:'';
      this.self=(s.self===true||s.self===false)?s.self:null;
      this.selfGrade=['again','hard','good','easy'].includes(s.selfGrade)?s.selfGrade:null;
      this.localRevealed=!!s.revealed; },
    pick(k){ if(this.revealed)return; if(this.isMulti){ const i=this.sel.indexOf(k); i>=0?this.sel.splice(i,1):this.sel.push(k); } else this.sel=[k]; },
    pickTF(v){ if(this.revealed)return; this.sel=[v]; },
    optClass(k){ if(!this.revealed)return{sel:this.sel.includes(k)}; const a=this.answerKeys.includes(k),c=this.sel.includes(k); return{disabled:true,correct:a,wrong:c&&!a,sel:c&&a}; },
    tfClass(v){ if(!this.revealed)return{sel:this.sel.includes(v)}; const a=this.answerKeys[0]===v,c=this.sel.includes(v); return{correct:a,wrong:c&&!a}; },
    elapsedMs(){ return Math.max(0, Math.min(600000, Date.now()-this.t0)); },
    submit(){ this.localRevealed=true; const ms=this.elapsedMs();
      if(AUTO.includes(this.q.type)){
        this.$emit('answered',{id:this.q.id,correct:this.autoCorrect,partial:this.mcPartial,ms});
        // 答对/答错动画反馈
        this._flashAns(this.autoCorrect);
      }
      if(this.q.type==='fill_blank'&&this.autoCorrect){ this.self=true; this.selfGrade='good'; this.$emit('answered',{id:this.q.id,correct:true,grade:'good',ms}); } },
    grade4(g){ if(!['again','hard','good','easy'].includes(g))return;
      // 再次点击同一档 → 取消自评，通知父组件清除本题作答记录
      if(this.selfGrade===g){ this.selfGrade=null; this.self=null; this.$emit('answered',{id:this.q.id,cancel:true}); return; }
      this.selfGrade=g; this.self=(g!=='again');
      this.$emit('answered',{id:this.q.id,correct:this.self,grade:g,ms:this.elapsedMs()});
      // 动画反馈：重来=抖动，困难=无动画（中性），良好/简单=弹跳
      if(g==='again') this._flashAns(false);
      else if(g==='good'||g==='easy') this._flashAns(true); },
    grade(ok){ this.grade4(ok?'good':'again'); }, /* 兼容旧调用（快捷键等）：映射到四档 */
    _flashAns(ok){ const el=this.$el; if(!el)return; const cls=ok?'ans-correct':'ans-wrong'; el.classList.remove('ans-correct','ans-wrong'); void el.offsetWidth; el.classList.add(cls); setTimeout(()=>el.classList.remove(cls),400); },
    kcardPrev(){ if(this.kcardIdx>0) this.kcardIdx--; },
    kcardNext(){ if(this.kcardIdx<this.aiCards.length-1) this.kcardIdx++; },
    kcardTap(){ this.$emit('card-flip', this.kcardIdx); },
    toggleFav(){ this.$emit('favorite',{id:this.q.id,value:!this.q.favorited}); },
    markMastered(){ this.$emit('master',{id:this.q.id,value:!this.q.mastered}); },
    saveNote(){ this.$emit('note',{id:this.q.id,note:this.noteDraft}); this.showNote=false; },
    canSubmit(){ if(this.isChoice||this.q.type==='true_false')return this.sel.length>0; if(this.q.type==='fill_blank')return this.isMultiBlank ? this.blanksArr.every(x=>String(x).trim().length>0) : this.blanks.trim().length>0; return true; },
  },
  template:`
  <div class="card">
    <div class="q-head">
      <span class="chip accent">{{ subjMap[q.subject]||q.subject }}</span>
      <span class="chip">{{ typeMap[q.type]||q.type }}</span>
      <span v-if="q.chapter" class="chip">{{ q.chapter }}</span>
      <span class="diff" :title="'难度 '+q.difficulty">{{ '★'.repeat(q.difficulty||3) }}</span>
      <button class="star" :class="{on:q.favorited}" @click="toggleFav" title="收藏"><icon name="star" :size="16" /></button>
    </div>
    <div v-if="q.passage" class="passage" :class="{folded: passageLong && !passageOpen, en: passageEnglish}">
      <div class="passage-head"><span class="passage-tag">材料</span><span v-if="passageLong" class="passage-len">{{ passageWords }}</span></div>
      <div class="passage-body"><rich-text :content="passageText" /></div>
      <button v-if="passageLong" class="passage-more" @click="passageOpen=!passageOpen">
        <icon :name="passageOpen?'chevron-up':'chevron-down'" :size="14" /> {{ passageOpen ? '收起材料' : '展开全文' }}
      </button>
    </div>
    <div class="stem"><rich-text :content="q.stem" /></div>
    <template v-if="isChoice">
      <div v-for="o in q.options" :key="o.key" class="opt" :class="optClass(o.key)" @click="pick(o.key)">
        <span class="key">{{ o.key }}</span>
        <span class="opt-body"><rich-text :content="o.text" /></span>
        <span class="mark" v-if="revealed && answerKeys.includes(o.key)"><icon name="check" :size="16" /></span>
        <span class="mark" v-else-if="revealed && sel.includes(o.key)"><icon name="x" :size="16" /></span>
      </div>
      <p class="muted" v-if="isMulti && !revealed">多选题：请选择所有正确选项</p>
    </template>
    <template v-else-if="q.type==='true_false'">
      <div class="tf-row">
        <div class="tf" :class="tfClass('T')" @click="pickTF('T')">正确</div>
        <div class="tf" :class="tfClass('F')" @click="pickTF('F')">错误</div>
      </div>
    </template>
    <template v-else-if="q.type==='fill_blank'">
      <div v-if="isMultiBlank" class="blanks-multi">
        <input v-for="i in blankCount" :key="i" class="inp" v-model="blanksArr[i-1]" :disabled="revealed" :placeholder="'第 '+i+' 空'" @keyup.enter="!revealed && canSubmit() && submit()" />
      </div>
      <input v-else class="inp" style="width:100%" v-model="blanks" :disabled="revealed" placeholder="输入答案（大小写、全半角、空格不影响判分）" @keyup.enter="!revealed && canSubmit() && submit()" />
    </template>
    <template v-else>
      <textarea :class="{code:q.type==='code'}" v-model="text" :disabled="revealed" :placeholder="q.type==='code' ? '在这里写代码（对照参考答案自查）' : '写下答题要点（对照参考答案自查）'"></textarea>
    </template>
    <template v-if="revealed">
      <div v-if="AUTO.includes(q.type)" class="verdict" :class="autoCorrect?'ok':(mcPartial?'part':'bad')">
        <span>{{ autoCorrect ? '正确' : (mcPartial ? '部分正确 · 少选' : '错误') }}</span>
        <span v-if="mcPartial" class="tag">半分计，已进复习</span>
        <span class="tag">正确答案： {{ answerKeys.join(', ') }}</span>
      </div>
      <div v-if="!AUTO.includes(q.type)" class="ref"><h5>参考答案</h5><rich-text :content="q.type==='fill_blank' ? ansDisplay : refText" /></div>
      <div v-if="!AUTO.includes(q.type)" class="selfgrade">
        <span class="q">掌握程度？</span>
        <button class="btn subtle sg sg-again" :class="{on:selfGrade==='again'}" @click="grade4('again')" title="没答上来，10 分钟后回炉"><icon name="x" :size="15" /> 重来</button>
        <button class="btn subtle sg sg-hard" :class="{on:selfGrade==='hard'}" @click="grade4('hard')" title="勉强想起，间隔小步前进">困难</button>
        <button class="btn subtle sg sg-good" :class="{on:selfGrade==='good'}" @click="grade4('good')" title="正常想起"><icon name="check" :size="15" /> 良好</button>
        <button class="btn subtle sg sg-easy" :class="{on:selfGrade==='easy'}" @click="grade4('easy')" title="秒答，间隔大步拉长">简单</button>
      </div>
            <div v-if="canAi || aiText || aiBusy || aiCards.length" class="ref" :class="{'seg-on':segMode}" ref="aiBox" @click="segClick" style="margin-top:10px">
        <h5><button v-if="canAi" class="ai-kind-sw" @click.stop="$emit(aiKind==='concept' ? 'ai-explain' : 'ai-concept')" :title="aiKind==='concept' ? '切换到解题解析（已生成过则直接切，未生成会调用 AI）' : '切换到知识点卡片（已生成过则直接切，未生成会调用 AI）'"><icon :name="aiKind==='concept'?'book-open':'sparkles'" :size="15" /> {{ aiKind==='concept' ? '知识点卡片' : '解题解析' }} <icon name="arrow-left-right" :size="11" /></button><span v-else><icon :name="aiKind==='concept'?'book-open':'sparkles'" :size="15" /> {{ aiKind==='concept' ? '知识点卡片' : '解题解析' }}</span> <span v-if="aiModel" class="muted" style="font-weight:400;font-size:11px">· {{ aiModel }}</span> <span v-if="aiBusy" class="spin"></span><button v-if="aiText && !aiBusy && aiKind!=='concept'" class="btn subtle" style="float:right;padding:0 8px;font-size:10.5px" @click="showRaw=!showRaw" title="查看/复制 AI 输出的原始 Markdown（渲染异常时把这里的内容发给开发者）">{{ showRaw?"渲染":"原文" }}</button><span v-if="aiBusy" class="muted" style="font-weight:400;font-size:12px">生成中…可继续做题</span></h5>
        <div v-if="aiReasoning" class="reason-box">
          <button class="reason-head" @click.stop="localReasonOpen=!localReasonOpen" :title="localReasonOpen?'收起推理过程':'展开推理过程'">
            <icon name="brain" :size="13" />
            <span>推理过程</span>
            <span class="reason-meta">{{ aiBusy ? '思考中…' : '仅本次可见 · 不保存' }}</span>
            <icon :name="localReasonOpen?'chevron-up':'chevron-down'" :size="14" />
          </button>
          <div v-if="localReasonOpen" class="reason-body" ref="reasonBody">{{ aiReasoning }}</div>
        </div>
        <textarea v-if="showRaw" readonly :value="aiText" style="width:100%;min-height:220px;font:12px/1.5 ui-monospace,monospace" @focus="$event.target.select()"></textarea>
        <template v-else-if="aiKind==='concept' && aiCards.length">
        <div class="kcard-tools">
          <button class="kcard-flipall" @click="$emit('cards-flip-all')"><icon name="chevrons-up-down" :size="13" /> {{ allFlipped ? '全部收起' : '全部翻开' }}</button>
          <button class="kcard-flipall" @click="kcardMode=kcardMode==='grid'?'single':'grid'"><icon :name="kcardMode==='grid'?'layers':'grid-2x2'" :size="13" /> {{ kcardMode==='grid'?'逐张背诵':'网格总览' }}</button>
          <span class="muted" style="font-size:12px;margin-left:auto">已翻 {{ Object.keys(aiFlip).filter(k=>aiFlip[k]).length }}/{{ aiCards.length }}</span>
        </div>
        <div v-if="kcardMode==='grid'" class="kcard-grid">
          <div v-for="(c,i) in aiCards" :key="'kc'+i" class="kcard" :class="{flipped:aiFlip[i]}" :style="{animationDelay:(i*90)+'ms'}" @click="$emit('card-flip',i)">
            <div class="kcard-inner">
              <div class="kcard-face kcard-front">
                <div class="kcard-idx">{{ i+1 }}/{{ aiCards.length }}</div>
                <div class="kcard-term"><rich-text :content="c.term" /></div>
                <div v-if="c.formula" class="kcard-formula" :class="{'is-text':isTextFormula(c.formula)}"><rich-text :content="c.formula" /></div>
                <div class="kcard-hint">点击查看讲解 <icon name="rotate-cw" :size="15" /></div>
              </div>
              <div class="kcard-face kcard-back">
                <div class="kcard-plain"><rich-text :content="c.plain" /></div>
                <div v-if="c.example" class="kcard-eg"><span class="kcard-eg-tag">例</span><rich-text :content="c.example" /></div>
                <div class="kcard-hint">点击返回 <icon name="corner-down-left" :size="15" /></div>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="kcard-single">
          <div class="kcard-lg-wrap">
            <div v-if="!aiFlip[kcardIdx]" class="kcard-lg-face kcard-lg-front" @click="kcardTap">
              <div class="kcard-idx">{{ kcardIdx+1 }}/{{ aiCards.length }}</div>
              <div class="kcard-term" style="font-size:22px"><rich-text :content="aiCards[kcardIdx].term" /></div>
              <div v-if="aiCards[kcardIdx].formula" class="kcard-formula" :class="{'is-text':isTextFormula(aiCards[kcardIdx].formula)}" style="font-size:17px"><rich-text :content="aiCards[kcardIdx].formula" /></div>
              <div class="kcard-hint">点击翻面看讲解</div>
            </div>
            <div v-else class="kcard-lg-face kcard-lg-back" @click="kcardTap">
              <div class="kcard-plain" style="font-size:15px;line-height:1.8"><rich-text :content="aiCards[kcardIdx].plain" /></div>
              <div v-if="aiCards[kcardIdx].example" class="kcard-eg"><span class="kcard-eg-tag">例</span><rich-text :content="aiCards[kcardIdx].example" /></div>
              <div class="kcard-hint">{{ kcardIdx < aiCards.length-1 ? '点击 → 下一张' : '点击翻回正面' }}</div>
            </div>
          </div>
          <div class="kcard-single-nav">
            <button class="btn subtle" :disabled="kcardIdx<=0" @click="kcardPrev"><icon name="arrow-left" :size="15" /></button>
            <span class="kcard-dots"><span v-for="(c,i) in aiCards" :key="'kd'+i" class="kcard-dot-s" :class="{on:i===kcardIdx,done:aiFlip[i]}" @click="kcardIdx=i"></span></span>
            <button class="btn subtle" :disabled="kcardIdx>=aiCards.length-1" @click="kcardNext"><icon name="arrow-right" :size="15" /></button>
          </div>
        </div>
        </template>
        <div v-else-if="aiKind==='concept' && aiBusy" class="kcard-loading">
          <div class="kcard-skel" v-for="n in 3" :key="'sk'+n"></div>
          <div class="muted" style="text-align:center;font-size:12.5px;margin-top:4px;grid-column:1/-1">正在整理知识点卡片…</div>
        </div>
        <rich-text v-else-if="aiText" :content="aiText" />
        <div class="ai-acts">
          <div class="ai-acts-main">
            <button class="ai-btn ai-btn-primary" :class="{on:aiKind!=='concept'&&aiText}" v-if="!aiBusy || aiKind==='concept'" @click="$emit('ai-explain')"><icon :name="aiKind==='concept'?'arrow-left':'sparkles'" :size="15" /><span>解题解析</span></button>
            <button class="ai-btn ai-btn-primary" :class="{on:aiKind==='concept'}" v-if="!aiBusy || aiKind!=='concept'" @click="$emit('ai-concept')" title="不解题，只讲这道题涉及的前置知识点和公式（适合基础忘了、重新复习）"><icon name="book-open" :size="15" /><span>{{ hasConcept ? '知识点卡片' : '生成知识点卡片' }}</span></button>
          </div>
          <div class="ai-acts-sub" v-if="!aiBusy && (aiText || (aiKind==='concept'&&hasConcept))">
            <button class="ai-chip" v-if="aiKind==='concept' && hasConcept" @click="$emit('ai-concept-redo')" title="重新生成知识点卡片"><icon name="rotate-cw" :size="13" />重新生成</button>
            <button class="ai-chip" v-if="aiKind!=='concept' && aiText" @click="$emit('ai-explain-redo')" title="重新生成解题解析"><icon name="rotate-cw" :size="13" />重新生成</button>
            <button class="ai-chip" v-if="aiText && aiKind!=='concept'" @click="$emit('ai-save')" title="把 AI 解析追加保存到本题的「解析」字段（永久）"><icon name="save" :size="13" />存入解析</button>
            <button class="ai-chip" v-if="aiText && aiKind!=='concept'" :class="{on:segMode}" @click="segToggle" title="进入选段模式：点选段落/公式/代码块，再合并复制或引用到追问"><icon :name="segMode?'x':'text-cursor-input'" :size="13" /><span>{{ segMode?'退出选段':'选段' }}</span></button>
          </div>
        </div>
        <template v-if="(aiText || (aiKind==='concept' && aiCards.length)) && !aiBusy">
          <div v-for="(c,i) in aiChat" :key="'aq'+i" class="chat-round">
            <div class="chat-bub chat-q">
              <div class="chat-tag"><icon name="user" :size="13" /> 你</div>
              <rich-text :content="c.q" />
              <div class="chat-q-acts">
                <button v-if="aiAsking && i===aiChat.length-1" class="chat-icon-btn" @click="$emit('ai-stop')" title="停止生成"><icon name="square" :size="14" /></button>
                <button v-if="!aiAsking && c.a" class="chat-icon-btn" @click="$emit('ai-retry',i)" title="重新生成这条回答"><icon name="rotate-cw" :size="14" /></button>
              </div>
            </div>
            <div v-if="c.r" class="chat-reason">
              <button class="chat-reason-h" @click="chatReasonOpen[i]=!chatReasonOpen[i]">
                <icon name="brain" :size="13" /> 推理过程
                <span v-if="aiAsking && i===aiChat.length-1 && !c.a" class="spin"></span>
                <icon :name="chatReasonOpen[i]?'chevron-up':'chevron-down'" :size="12" />
              </button>
              <div v-show="chatReasonOpen[i]" :ref="'chatReason'+i" class="chat-reason-b">{{ c.r }}</div>
            </div>
            <div v-if="c.a" class="chat-bub chat-a"><div class="chat-tag"><icon name="sparkles" :size="13" /> AI</div><rich-text :content="c.a" />
              <div v-if="!aiAsking && !c.err" style="display:flex;gap:6px;justify-content:flex-end;margin-top:8px">
                <button class="btn subtle" style="padding:2px 10px;font-size:11px" :style="segMode?'border-color:var(--accent,#4f46e5);color:var(--accent,#4f46e5)':''" @click="segToggle" title="选段模式"><icon :name="segMode?'x':'text-cursor-input'" :size="12" />{{ segMode?'退出':'选段' }}</button>
                <button class="btn subtle" style="padding:2px 10px;font-size:11px" @click="$emit('ai-note',{q:c.q,a:c.a})" title="把这一轮问答追加到本题笔记"><icon name="notebook-pen" :size="12" />存为笔记</button>
              </div>
            </div>
            <div v-else class="chat-bub chat-a"><span class="spin"></span></div>
          </div>
          <button v-if="(aiBusy||aiAsking) && !stickBottom" class="back-bottom" @click="backToBottom">
            <icon name="chevron-down" :size="14" /> 回到底部
          </button>
          <div style="display:flex;gap:8px;margin-top:10px;align-items:center">
            <input ref="askInp" v-model="askInput" :disabled="aiAsking" :placeholder="aiKind==='concept' ? '对知识点卡片有疑问？追问…' : '对解析有疑问？追问…'" style="flex:1;min-width:0" @keyup.enter="doAsk" />
            <button class="btn subtle" :disabled="aiAsking || !askInput.trim()" @click="doAsk"><span v-if="aiAsking" class="spin"></span>{{ aiAsking?'回答中':'追问' }}</button>
            <button v-if="aiChat.length && !aiAsking" class="chat-icon-btn" @click="$emit('ai-clear-chat')" title="清空追问记录" style="opacity:.6"><icon name="trash-2" :size="15" /></button>
          </div>
        </template>
        <div v-if="segMode" class="seg-bar">
          <span class="muted" style="font-size:12px">{{ segCount? '已选 '+segCount+' 块' : '点选下方虚线块（段落 / 公式 / 代码 / 列表项）' }}</span>
          <span style="flex:1"></span>
          <button class="btn subtle" :disabled="!segCount" @click="segCopy">{{ copied==='seg'?'已复制 ✓':'合并复制' }}</button>
          <button class="btn subtle" :disabled="!segCount" @click="segQuote">引用到追问</button>
        </div>
      </div>
      <button class="note-toggle" @click="showNote=!showNote; if(showNote){ noteEdit=!q.note; noteDraft=q.note||''; }">{{ showNote?'隐藏笔记':(q.note?'查看 / 编辑笔记':'+ 添加笔记') }}</button>
      <div v-if="showNote" style="margin-top:8px">
        <template v-if="!noteEdit && q.note">
          <div class="ref"><rich-text :content="q.note" /></div>
          <button class="btn subtle" style="margin-top:8px" @click="noteEdit=true; noteDraft=q.note||''"> 编辑笔记</button>
        </template>
        <template v-else>
          <textarea v-model="noteDraft" class="note-ta" @input="taGrow($event)" @focus="taGrow($event)" placeholder="记下易错点或记忆口诀…（支持 Markdown 与 $ 公式）"></textarea>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn subtle" @click="saveNote(); noteEdit=false">保存笔记</button>
            <button v-if="q.note" class="btn subtle" @click="noteEdit=false; noteDraft=q.note||''">取消</button>
          </div>
        </template>
      </div>
    </template>
    <div class="q-actions" v-if="mode!=='exam'">
      <button v-if="!revealed" class="btn" :disabled="!canSubmit()" @click="submit">{{ AUTO.includes(q.type) ? '提交' : '看参考答案' }}</button>
      <template v-else>
        <button v-if="mode!=='exam'" class="btn" @click="$emit('next')">下一题 <icon name="arrow-right" :size="15" /></button>
        <button class="btn subtle" :style="q.mastered?'border-color:var(--ok);color:var(--ok)':''" @click="markMastered">{{ q.mastered?'已掌握 ✓':'标记为已掌握' }}</button>
      </template>
    </div>
  </div>`
};

