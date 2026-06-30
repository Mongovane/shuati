const QuestionCard={
  components:{ RichText },
  props:{ q:Object, mode:{type:String,default:'practice'}, examReveal:Boolean },
  emits:['answered','favorite','master','note','next'],
  data(){ return { sel:[], blanks:'', text:'', localRevealed:false, self:null, showNote:false, noteDraft:'' }; },
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
      <div v-if="q.analysis" class="ref" style="margin-top:10px"><h5>解析</h5><rich-text :content="q.analysis" /></div>
      <button class="note-toggle" @click="showNote=!showNote">{{ showNote?'隐藏笔记':(q.note?'查看 / 编辑笔记':'+ 添加笔记') }}</button>
      <div v-if="showNote" style="margin-top:8px">
        <textarea v-model="noteDraft" style="min-height:80px" placeholder="记下易错点或记忆口诀…"></textarea>
        <button class="btn subtle" style="margin-top:8px" @click="saveNote">保存笔记</button>
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

