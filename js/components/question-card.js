// 填空判分归一化：全角→半角（１２ａｂ（）→12ab()）、全角空格、去空白、小写
const normAns=(v)=>String(v==null?'':v)
  .replace(/[\uFF01-\uFF5E]/g,ch=>String.fromCharCode(ch.charCodeAt(0)-0xFEE0))
  .replace(/\u3000/g,' ')
  .trim().toLowerCase().replace(/\s+/g,'');

const QuestionCard={
  components:{ RichText },
  props:{ q:Object, mode:{type:String,default:'practice'}, canAi:{type:Boolean,default:false}, aiText:{type:String,default:''}, aiBusy:{type:Boolean,default:false}, aiChat:{type:Array,default:()=>[]}, aiAsking:{type:Boolean,default:false}, aiModel:{type:String,default:''}, aiKind:{type:String,default:''}, aiCards:{type:Array,default:()=>[]}, aiFlip:{type:Object,default:()=>({})}, examReveal:Boolean },
  emits:['answered','favorite','master','note','next','ai-explain','ai-concept','ai-save','ai-ask','ai-note','ai-retry','seg-mode','card-flip'],
  data(){ return { sel:[], blanks:'', blanksArr:[], text:'', localRevealed:false, self:null, selfGrade:null, t0:Date.now(), showNote:false, noteEdit:false, noteDraft:'', askInput:'', copied:'', segMode:false, segCount:0, showRaw:false }; },
  computed:{
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
  watch:{ q(){ this.reset(); }, segMode(v){ this.$emit('seg-mode', v); } },
  mounted(){ this.reset(); },
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
    doAsk(){ const t=this.askInput.trim(); if(!t||this.aiAsking)return; this.$emit('ai-ask',t); this.askInput=''; },
    reset(){ this.sel=[]; this.blanks=''; this.blanksArr=Array.from({length:this.blankCount},()=>''); this.text=''; this.localRevealed=false; this.self=null; this.selfGrade=null; this.t0=Date.now(); this.showNote=false; this.noteDraft=this.q.note||''; if(this.segMode){ this.segMode=false; this.segCount=0; } },
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
      if(AUTO.includes(this.q.type)) this.$emit('answered',{id:this.q.id,correct:this.autoCorrect,partial:this.mcPartial,ms});
      if(this.q.type==='fill_blank'&&this.autoCorrect){ this.self=true; this.selfGrade='good'; this.$emit('answered',{id:this.q.id,correct:true,grade:'good',ms}); } },
    grade4(g){ if(!['again','hard','good','easy'].includes(g))return; this.selfGrade=g; this.self=(g!=='again'); this.$emit('answered',{id:this.q.id,correct:this.self,grade:g,ms:this.elapsedMs()}); },
    grade(ok){ this.grade4(ok?'good':'again'); }, /* 兼容旧调用（快捷键等）：映射到四档 */
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
      <button class="star" :class="{on:q.favorited}" @click="toggleFav" title="收藏">★</button>
    </div>
    <div v-if="q.passage" class="passage"><rich-text :content="q.passage" /></div>
    <div class="stem"><rich-text :content="q.stem" /></div>
    <template v-if="isChoice">
      <div v-for="o in q.options" :key="o.key" class="opt" :class="optClass(o.key)" @click="pick(o.key)">
        <span class="key">{{ o.key }}</span>
        <span class="opt-body"><rich-text :content="o.text" /></span>
        <span class="mark" v-if="revealed && answerKeys.includes(o.key)">✓</span>
        <span class="mark" v-else-if="revealed && sel.includes(o.key)">✗</span>
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
        <button class="btn subtle sg sg-again" :class="{on:selfGrade==='again'}" @click="grade4('again')" title="没答上来，10 分钟后回炉">✗ 重来</button>
        <button class="btn subtle sg sg-hard" :class="{on:selfGrade==='hard'}" @click="grade4('hard')" title="勉强想起，间隔小步前进">困难</button>
        <button class="btn subtle sg sg-good" :class="{on:selfGrade==='good'}" @click="grade4('good')" title="正常想起">✓ 良好</button>
        <button class="btn subtle sg sg-easy" :class="{on:selfGrade==='easy'}" @click="grade4('easy')" title="秒答，间隔大步拉长">简单</button>
      </div>
            <div v-if="canAi || aiText || aiBusy" class="ref" :class="{'seg-on':segMode}" ref="aiBox" @click="segClick" style="margin-top:10px">
        <h5>{{ aiKind==='concept' ? '📚 知识点讲解' : 'AI 解析' }} <span v-if="aiModel" class="muted" style="font-weight:400;font-size:11px">· {{ aiModel }}</span> <span v-if="aiBusy" class="spin"></span><button v-if="aiText && !aiBusy" class="btn subtle" style="float:right;padding:0 8px;font-size:10.5px" @click="showRaw=!showRaw" title="查看/复制 AI 输出的原始 Markdown（渲染异常时把这里的内容发给开发者）">{{ showRaw?"渲染":"原文" }}</button><span v-if="aiBusy" class="muted" style="font-weight:400;font-size:12px">生成中…可继续做题</span></h5>
        <textarea v-if="showRaw" readonly :value="aiText" style="width:100%;min-height:220px;font:12px/1.5 ui-monospace,monospace" @focus="$event.target.select()"></textarea>
        <div v-else-if="aiKind==='concept' && aiCards.length" class="kcard-grid">
          <div v-for="(c,i) in aiCards" :key="'kc'+i" class="kcard" :class="{flipped:aiFlip[i]}" :style="{animationDelay:(i*90)+'ms'}" @click="$emit('card-flip',i)">
            <div class="kcard-inner">
              <div class="kcard-face kcard-front">
                <div class="kcard-idx">{{ i+1 }}/{{ aiCards.length }}</div>
                <div class="kcard-term"><rich-text :content="c.term" /></div>
                <div v-if="c.formula" class="kcard-formula"><rich-text :content="c.formula" /></div>
                <div class="kcard-hint">点击查看讲解 ↻</div>
              </div>
              <div class="kcard-face kcard-back">
                <div class="kcard-plain"><rich-text :content="c.plain" /></div>
                <div v-if="c.example" class="kcard-eg"><span class="kcard-eg-tag">例</span><rich-text :content="c.example" /></div>
                <div class="kcard-hint">点击返回 ↩</div>
              </div>
            </div>
          </div>
        </div>
        <rich-text v-else-if="aiText" :content="aiText" />
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <button class="btn subtle" v-if="!aiBusy" @click="$emit('ai-explain')">{{ (aiText && aiKind!=='concept') ? '↻ 重新解析' : '✨ AI 解析本题' }}</button>
          <button class="btn subtle" v-if="!aiBusy" @click="$emit('ai-concept')" title="不解题，只讲这道题涉及的前置知识点和公式（适合基础忘了、重新复习）">{{ (aiText && aiKind==='concept') ? '↻ 重讲知识点' : '📚 讲讲知识点' }}</button>
          <button class="btn subtle" v-if="aiText && !aiBusy && aiKind!=='concept'" @click="$emit('ai-save')" title="把 AI 解析追加保存到本题的「解析」字段（永久）">💾 保存进解析</button>
          <button class="btn subtle" v-if="aiText && !aiBusy && aiKind!=='concept'" :style="segMode?'border-color:var(--accent,#4f46e5);color:var(--accent,#4f46e5)':''" @click="segToggle" title="进入选段模式：像勾选复选框一样点选段落/公式/代码块，再合并复制或引用到追问">{{ segMode?'✕ 退出选段':'📝 选段' }}</button>
        </div>
        <template v-if="aiText && !aiBusy">
          <div v-for="(c,i) in aiChat" :key="'aq'+i" class="chat-round">
            <div class="chat-bub chat-q"><div class="chat-tag">🙋 你</div><rich-text :content="c.q" /></div>
            <div v-if="c.a" class="chat-bub chat-a"><div class="chat-tag">✨ AI</div><rich-text :content="c.a" />
              <div v-if="!aiAsking" style="display:flex;gap:6px;justify-content:flex-end;margin-top:8px">
                <template v-if="!c.err">
                  <button class="btn subtle" style="padding:2px 10px;font-size:11px" :style="segMode?'border-color:var(--accent,#4f46e5);color:var(--accent,#4f46e5)':''" @click="segToggle" title="选段模式：点选段落/公式，底部操作条合并复制或引用追问">{{ segMode?'✕ 退出':'📝 选段' }}</button>
                  <button class="btn subtle" style="padding:2px 10px;font-size:11px" @click="$emit('ai-note',{q:c.q,a:c.a})" title="把这一轮问答追加到本题笔记">📝 存为笔记</button>
                </template>
                <button v-else class="btn subtle" style="padding:2px 10px;font-size:11px;border-color:var(--accent,#4f46e5);color:var(--accent,#4f46e5)" @click="$emit('ai-retry',i)">⟳ 重试</button>
              </div>
            </div>
            <div v-else class="chat-bub chat-a"><span class="spin"></span></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <input ref="askInp" v-model="askInput" :disabled="aiAsking" placeholder="对解析还有疑问？继续追问（可直接复制上方公式粘贴，会自动还原为 $ 公式源码；Enter 发送）…" style="flex:1;min-width:0" @keyup.enter="doAsk" />
            <button class="btn subtle" :disabled="aiAsking || !askInput.trim()" @click="doAsk"><span v-if="aiAsking" class="spin"></span>{{ aiAsking?'回答中':'追问' }}</button>
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
          <button class="btn subtle" style="margin-top:8px" @click="noteEdit=true; noteDraft=q.note||''">✏️ 编辑笔记</button>
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
        <button class="btn" @click="$emit('next')">下一题 →</button>
        <button class="btn subtle" :style="q.mastered?'border-color:var(--ok);color:var(--ok)':''" @click="markMastered">{{ q.mastered?'已掌握 ✓':'标记为已掌握' }}</button>
      </template>
    </div>
  </div>`
};

