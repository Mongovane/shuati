// 教材沉浸式阅读器（番茄/七猫风格）逻辑（Vue mixin）
const ReaderMixin = {
  data(){ return {
    reader:{ open:false, fontSize:19, lineGap:1.9, theme:'paper', serif:false, barsHidden:false, panel:false, tocOpen:false, segMode:false, segCount:0 },
    rdAi:{ open:false, input:'', asking:false, chat:[], quote:'' },
  }; },
  methods: {
    // —— 选段模式（教材阅读页）——
    readerSegToggle(){ this.reader.segMode=!this.reader.segMode; this.reader.barsHidden=false; if(!this.reader.segMode)this.readerSegClear(); },
    readerSegClear(){ const b=this.$refs.rdBox; if(b)b.querySelectorAll('.seg-sel').forEach(el=>el.classList.remove('seg-sel')); this.reader.segCount=0; },
    readerSegClick(e){ if(!this.reader.segMode)return; if(e.target.closest('button,a,input,textarea'))return;
      const box=this.$refs.rdBox; if(!box)return;
      const blk=e.target.closest('.code-wrap,.katex-display,.prob,li,pre,blockquote,table,h1,h2,h3,h4,h5,h6,p');
      if(!blk||!box.contains(blk))return;
      e.preventDefault(); e.stopPropagation();
      blk.classList.toggle('seg-sel'); this.reader.segCount=box.querySelectorAll('.seg-sel').length; },
    readerSegTexts(){ const box=this.$refs.rdBox; if(!box)return [];
      return Array.from(box.querySelectorAll('.seg-sel')).filter(el=>!el.parentElement.closest('.seg-sel')).map(el=>window.__segText(el)).filter(Boolean); },
    async readerSegCopy(){ const parts=this.readerSegTexts(); if(!parts.length)return; const txt=parts.join('\n\n');
      try{ if(navigator.clipboard&&navigator.clipboard.writeText){ await navigator.clipboard.writeText(txt); }
        else{ const ta=document.createElement('textarea'); ta.value=txt; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); }
        this.flash('已复制 '+parts.length+' 块'); }catch(_){}
      this.readerSegToggle(); },
    // —— 阅读页问 AI（底部抽屉，选段可作引用）——
    bookAskAI(){ // Books 内联章节阅读点「问 AI」：就地弹出 AI 面板（内联页自带一份，不必进沉浸）
      if(!this.currentBook||!this.currentPageMat){ this.flash('请先选择一本书',true); return; }
      this.rdAi.quote=''; this.rdAi.open=true;
      this.$nextTick(()=>{ const el=this.$refs.rdAiInpInline||this.$refs.rdAiInp; if(el)el.focus(); }); },
        readerAskAI(){ const parts=this.readerSegTexts(); if(parts.length)this.rdAi.quote=parts.join(' ').slice(0,3000);
      if(this.reader.segMode)this.readerSegToggle();
      this.rdAi.open=true; this.reader.barsHidden=false;
      this.$nextTick(()=>{ const el=this.$refs.rdAiInp; if(el){ el.focus(); const n=el.value.length; try{ el.setSelectionRange(n,n); }catch(_){} } }); },
    rdAiRetry(i){ const c=this.rdAi.chat[i]; if(!c||!c.err||this.rdAi.asking)return;
      const q=c.q; this.rdAi.chat.splice(i,1); this.rdAi.input=q; return this.rdAiSend(); },
    rdAiStop(){ if(this._rdCtrl){ try{ this._rdCtrl.abort(); }catch(_){} } const last=this.rdAi.chat[this.rdAi.chat.length-1]; if(last && this.rdAi.asking && !last.a) last.a='_（已停止）_'; this.rdAi.asking=false; },
    async rdAiSend(){ const q=(this.rdAi.input||'').trim(); if(!q||this.rdAi.asking)return;
      if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      const mat=this.currentPageMat; if(!mat)return;
      if(this._rdCtrl){ try{ this._rdCtrl.abort(); }catch(_){} }
      const ctrl=new AbortController(); this._rdCtrl=ctrl;
      const entry={ q, a:'' }; this.rdAi.chat.push(entry); this.rdAi.asking=true; this.rdAi.input='';
      const history=[]; for(const c of this.rdAi.chat.slice(0,-1)){ history.push({role:'user',content:c.q}); if(c.a&&!c.err)history.push({role:'assistant',content:c.a}); }
      try{
        const r=await this.aiFetch({ ...this.aiOv(false), mode:'reading',
          question:{ stem:this.rdAi.quote||'（未选段，就整页材料提问）', passage:String(this.cleanPageMd(mat.content_md)||'').slice(0,4000), type:'short_answer', subject:mat.subject },
          analysis:'', history, ask:q }, ctrl.signal,
          (d)=>{ if(d.reset)entry.a=''; if(d.text)entry.a=d.acc; });
        if(r.res && r.res.status===401){ this.token=''; localStorage.removeItem('zb_token'); this.readerClose(); this.go('settings'); throw new Error('访问码无效'); }
        if(!r.ok){ let msg=r.errText||''; if(!msg){ try{ const d=await r.res.json(); msg=(d&&d.error)||('HTTP '+r.res.status); }catch(_){ msg='HTTP '+(r.res?r.res.status:'?'); } } throw new Error(msg); }
        if(!entry.a) entry.a='_（模型没有返回内容）_';
      }catch(e){ if(e.name!=='AbortError'){ let msg=e.message||'未知错误'; if(/429/.test(msg))msg+='（中转站限流，稍等几秒再重试）'; else if(/Failed to fetch|NetworkError|HTTP2|PROTOCOL|stream/i.test(msg))msg='网络异常，请检查网络后重试'; entry.a='_回答失败：'+msg+'_'; entry.err=true; this.flash('提问失败：'+msg,true); } }
      this.rdAi.asking=false; if(this._rdCtrl===ctrl)this._rdCtrl=null; },
    // —— 沉浸式阅读器（番茄/七猫风格）——
    readerLoadCfg(){ try{ const c=JSON.parse(localStorage.getItem('zb_reader')||'null'); if(c&&typeof c==='object'){ this.reader.fontSize=Math.min(30,Math.max(15,parseInt(c.fontSize,10)||19)); this.reader.lineGap=[1.6,1.9,2.3].includes(c.lineGap)?c.lineGap:1.9; this.reader.theme=['paper','sepia','green','night'].includes(c.theme)?c.theme:'paper'; this.reader.serif=!!c.serif; } }catch(_){ } },
    readerSaveCfg(){ try{ localStorage.setItem('zb_reader', JSON.stringify({fontSize:this.reader.fontSize,lineGap:this.reader.lineGap,theme:this.reader.theme,serif:this.reader.serif})); }catch(_){ } },
    readerTocShow(){ this.reader.tocOpen=true; this.$nextTick(()=>{ try{
      const box=document.querySelector('.r-toc .list'); const cur=box&&box.querySelector('.on');
      if(cur)cur.scrollIntoView({block:'center'}); }catch(_){ } }); },
    readerOpen(){ if(!this.currentBook||!this.currentPageMat){ this.flash('请先选择一本书',true); return; } this.readerLoadCfg(); this.reader.barsHidden=false; this.reader.panel=false; this.reader.tocOpen=false; this.reader.open=true; this._readerBarColor(); try{ document.body.style.overflow='hidden'; }catch(_){ } this.$nextTick(()=>this.readerScrollTop()); },
    readerClose(){ this.reader.open=false; this.reader.panel=false; this.reader.tocOpen=false; try{ document.body.style.overflow=''; }catch(_){ } if(typeof this.applyTheme==='function')this.applyTheme(); },
    // 状态栏跟随阅读主题背景色（PWA black-translucent 下透出的就是它）
    _readerBarColor(){ try{ const map={paper:'#f6f5f1',sepia:'#ecdcc0',green:'#cfe4cf',night:'#16161a'}; const c=map[this.reader.theme]||map.paper; const m=document.getElementById('theme-color-dynamic'); if(m)m.setAttribute('content',c); }catch(_){ } },
    readerScrollTop(){ const el=this.$refs.readerScroll; if(el)el.scrollTop=0; },
    readerFont(d){ this.reader.fontSize=Math.min(30,Math.max(15,this.reader.fontSize+d)); this.readerSaveCfg(); },
    readerSetGap(g){ this.reader.lineGap=g; this.readerSaveCfg(); },
    readerSetTheme(t){ this.reader.theme=t; this.readerSaveCfg(); this._readerBarColor(); },
    readerSetSerif(v){ this.reader.serif=!!v; this.readerSaveCfg(); },
    readerToggleBars(){ this.reader.barsHidden=!this.reader.barsHidden; if(this.reader.barsHidden)this.reader.panel=false; },
    readerSavePos(){ try{ const b=this.currentBook; if(b)localStorage.setItem('zb_readpos:'+b.key, String(this.bookIdx)); }catch(_){ } },
    readerPrev(){ if(this.bookIdx<=0)return; this.bookPrev(); this.reader.panel=false; this.readerSavePos(); this.$nextTick(()=>this.readerScrollTop()); },
    readerNext(){ const b=this.currentBook; if(!b||this.bookIdx>=b.pages.length-1)return; this.bookNext(); this.reader.panel=false; this.readerSavePos(); this.$nextTick(()=>this.readerScrollTop()); },
    readerGoto(i){ this.bookGoto(i); this.reader.tocOpen=false; this.readerSavePos(); this.$nextTick(()=>this.readerScrollTop()); },
    readerTap(e){ if(this.reader.segMode)return; if(this.reader.tocOpen){ this.reader.tocOpen=false; return; } if(this.reader.panel){ this.reader.panel=false; return; } try{ const sel=window.getSelection&&window.getSelection().toString(); if(sel&&sel.length)return; }catch(_){ } if(e.target&&e.target.closest&&e.target.closest('a,button,input,textarea,select,.katex,img,pre,code'))return; const w=window.innerWidth||360; const x=(e.clientX!=null)?e.clientX:w/2; if(x<w*0.3)this.readerPrev(); else if(x>w*0.7)this.readerNext(); else this.readerToggleBars(); },
    readerTouchStart(e){ const t=e.touches&&e.touches[0]; this._rsx=t?t.clientX:0; this._rsy=t?t.clientY:0; this._rst=Date.now(); },
    readerTouchEnd(e){ const t=e.changedTouches&&e.changedTouches[0]; if(!t)return; const dx=t.clientX-(this._rsx||0), dy=t.clientY-(this._rsy||0), dt=Date.now()-(this._rst||0); if(dt<600 && Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.6){ if(dx<0)this.readerNext(); else this.readerPrev(); } },
  }
};
