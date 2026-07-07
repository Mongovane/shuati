const QuestionCard={
  components:{ RichText },
  props:{ q:Object, mode:{type:String,default:'practice'}, canAi:{type:Boolean,default:false}, aiText:{type:String,default:''}, aiBusy:{type:Boolean,default:false}, aiChat:{type:Array,default:()=>[]}, aiAsking:{type:Boolean,default:false}, aiModel:{type:String,default:''}, examReveal:Boolean },
  emits:['answered','favorite','master','note','next','ai-explain','ai-save','ai-ask','ai-note'],
  data(){ return { sel:[], blanks:'', text:'', localRevealed:false, self:null, showNote:false, noteEdit:false, noteDraft:'', askInput:'' }; },
  computed:{
    subjMap(){ return SUBJ_MAP; }, typeMap(){ return TYPE_MAP; },
    revealed(){ return this.mode==='exam'?this.examReveal:this.localRevealed; },
    isObjective(){ return OBJECTIVE.includes(this.q.type); },
    isChoice(){ return this.q.type==='single_choice'||this.q.type==='multiple_choice'; },
    isMulti(){ return this.q.type==='multiple_choice'; },
    answerKeys(){ return (this.q.answer||[]).map(x=>String(x).toUpperCase()); },
    refText(){ return (this.q.answer||[]).join('\n'); },
    autoCorrect(){
      if(this.isChoice){ const a=[...this.answerKeys].sort().join(','); const b=[...this.sel].sort().join(','); return a===b&&b!==''; }
      if(this.q.type==='true_false'){ return this.sel[0]===this.answerKeys[0]; }
      if(this.q.type==='fill_blank'){ const n=s=>String(s).trim().toLowerCase().replace(/\s+/g,''); const m=n(this.blanks); if(!m)return false; return (this.q.answer||[]).some(a=>n(a)===m); }
      return false;
    },
    finalCorrect(){ if(AUTO.includes(this.q.type))return this.autoCorrect; if(this.q.type==='fill_blank')return this.self!=null?this.self:this.autoCorrect; return this.self===true; },
    graded(){ if(AUTO.includes(this.q.type))return true; return this.self!=null; },
  },
  watch:{ q(){ this.reset(); } },
  mounted(){ this.reset(); },
  methods:{
    doAsk(){ const t=this.askInput.trim(); if(!t||this.aiAsking)return; this.$emit('ai-ask',t); this.askInput=''; },
    reset(){ this.sel=[]; this.blanks=''; this.text=''; this.localRevealed=false; this.self=null; this.showNote=false; this.noteDraft=this.q.note||''; },
    pick(k){ if(this.revealed)return; if(this.isMulti){ const i=this.sel.indexOf(k); i>=0?this.sel.splice(i,1):this.sel.push(k); } else this.sel=[k]; },
    pickTF(v){ if(this.revealed)return; this.sel=[v]; },
    optClass(k){ if(!this.revealed)return{sel:this.sel.includes(k)}; const a=this.answerKeys.includes(k),c=this.sel.includes(k); return{disabled:true,correct:a,wrong:c&&!a,sel:c&&a}; },
    tfClass(v){ if(!this.revealed)return{sel:this.sel.includes(v)}; const a=this.answerKeys[0]===v,c=this.sel.includes(v); return{correct:a,wrong:c&&!a}; },
    submit(){ this.localRevealed=true; if(AUTO.includes(this.q.type)) this.$emit('answered',{id:this.q.id,correct:this.autoCorrect}); if(this.q.type==='fill_blank'&&this.autoCorrect){ this.self=true; this.$emit('answered',{id:this.q.id,correct:true}); } },
    grade(ok){ this.self=ok; this.$emit('answered',{id:this.q.id,correct:ok}); },
    toggleFav(){ this.$emit('favorite',{id:this.q.id,value:!this.q.favorited}); },
    markMastered(){ this.$emit('master',{id:this.q.id,value:!this.q.mastered}); },
    saveNote(){ this.$emit('note',{id:this.q.id,note:this.noteDraft}); this.showNote=false; },
    canSubmit(){ if(this.isChoice||this.q.type==='true_false')return this.sel.length>0; if(this.q.type==='fill_blank')return this.blanks.trim().length>0; return true; },
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
      <input class="inp" style="width:100%" v-model="blanks" :disabled="revealed" placeholder="输入答案（多个空用空格分隔）" @keyup.enter="!revealed && canSubmit() && submit()" />
    </template>
    <template v-else>
      <textarea :class="{code:q.type==='code'}" v-model="text" :disabled="revealed" :placeholder="q.type==='code' ? '在这里写代码（对照参考答案自查）' : '写下答题要点（对照参考答案自查）'"></textarea>
    </template>
    <template v-if="revealed">
      <div v-if="AUTO.includes(q.type)" class="verdict" :class="autoCorrect?'ok':'bad'">
        <span>{{ autoCorrect ? '正确' : '错误' }}</span>
        <span class="tag">正确答案： {{ answerKeys.join(', ') }}</span>
      </div>
      <div v-if="!AUTO.includes(q.type)" class="ref"><h5>参考答案</h5><rich-text :content="refText" /></div>
      <div v-if="!AUTO.includes(q.type)" class="selfgrade">
        <span class="q">{{ q.type==='fill_blank' ? '答对了吗？' : '你做对了吗？' }}</span>
        <button class="btn subtle" :style="self===true?'border-color:var(--ok);color:var(--ok)':''" @click="grade(true)">✓ 正确</button>
        <button class="btn subtle" :style="self===false?'border-color:var(--bad);color:var(--bad)':''" @click="grade(false)">✗ 错误</button>
      </div>
            <div v-if="canAi || aiText || aiBusy" class="ref" style="margin-top:10px">
        <h5>AI 解析 <span v-if="aiModel" class="muted" style="font-weight:400;font-size:11px">· {{ aiModel }}</span> <span v-if="aiBusy" class="spin"></span><span v-if="aiBusy" class="muted" style="font-weight:400;font-size:12px">生成中…可继续做题</span></h5>
        <rich-text v-if="aiText" :content="aiText" />
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <button class="btn subtle" v-if="!aiBusy" @click="$emit('ai-explain')">{{ aiText ? '↻ 重新生成' : '✨ AI 解析本题' }}</button>
          <button class="btn subtle" v-if="aiText && !aiBusy" @click="$emit('ai-save')" title="把 AI 解析追加保存到本题的「解析」字段（永久）">💾 保存进解析</button>
        </div>
        <template v-if="aiText && !aiBusy">
          <div v-for="(c,i) in aiChat" :key="'aq'+i" style="margin-top:10px;border-top:1px dashed var(--line,rgba(0,0,0,.12));padding-top:8px">
            <div class="muted" style="font-size:13px;display:flex;justify-content:space-between;gap:8px;align-items:baseline"><span>🙋 {{ c.q }}</span>
              <button v-if="c.a && !aiAsking" class="btn subtle" style="padding:1px 8px;font-size:11px;flex:none" @click="$emit('ai-note',{q:c.q,a:c.a})" title="把这一轮问答追加到本题笔记">📝 存为笔记</button></div>
            <rich-text v-if="c.a" :content="c.a" />
            <span v-else class="spin"></span>
          </div>
          <div style="display:flex;gap:8px;margin-top:10px">
            <input v-model="askInput" :disabled="aiAsking" placeholder="对解析还有疑问？继续追问（Enter 发送）…" style="flex:1;min-width:0" @keyup.enter="doAsk" />
            <button class="btn subtle" :disabled="aiAsking || !askInput.trim()" @click="doAsk"><span v-if="aiAsking" class="spin"></span>{{ aiAsking?'回答中':'追问' }}</button>
          </div>
        </template>
      </div>
      <button class="note-toggle" @click="showNote=!showNote; if(showNote){ noteEdit=!q.note; noteDraft=q.note||''; }">{{ showNote?'隐藏笔记':(q.note?'查看 / 编辑笔记':'+ 添加笔记') }}</button>
      <div v-if="showNote" style="margin-top:8px">
        <template v-if="!noteEdit && q.note">
          <div class="ref"><rich-text :content="q.note" /></div>
          <button class="btn subtle" style="margin-top:8px" @click="noteEdit=true; noteDraft=q.note||''">✏️ 编辑笔记</button>
        </template>
        <template v-else>
          <textarea v-model="noteDraft" style="min-height:80px" placeholder="记下易错点或记忆口诀…（支持 Markdown 与 $ 公式）"></textarea>
          <div style="display:flex;gap:8px;margin-top:8px">
            <button class="btn subtle" @click="saveNote(); noteEdit=false">保存笔记</button>
            <button v-if="q.note" class="btn subtle" @click="noteEdit=false; noteDraft=q.note||''">取消</button>
          </div>
        </template>
      </div>
    </template>
    <div class="q-actions" v-if="mode!=='exam'">
      <button v-if="!revealed" class="btn" :disabled="!canSubmit()" @click="submit">提交 / 显示答案</button>
      <template v-else>
        <button class="btn" @click="$emit('next')">下一题 →</button>
        <button class="btn subtle" :style="q.mastered?'border-color:var(--ok);color:var(--ok)':''" @click="markMastered">{{ q.mastered?'已掌握 ✓':'标记为已掌握' }}</button>
      </template>
    </div>
  </div>`
};

