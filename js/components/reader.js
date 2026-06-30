// 教材沉浸式阅读器（番茄/七猫风格）逻辑（Vue mixin）
const ReaderMixin = {
  data(){ return {
    reader:{ open:false, fontSize:19, lineGap:1.9, theme:'paper', serif:false, barsHidden:false, panel:false, tocOpen:false },
  }; },
  methods: {
    // —— 沉浸式阅读器（番茄/七猫风格）——
    readerLoadCfg(){ try{ const c=JSON.parse(localStorage.getItem('zb_reader')||'null'); if(c&&typeof c==='object'){ this.reader.fontSize=Math.min(30,Math.max(15,parseInt(c.fontSize,10)||19)); this.reader.lineGap=[1.6,1.9,2.3].includes(c.lineGap)?c.lineGap:1.9; this.reader.theme=['paper','sepia','green','night'].includes(c.theme)?c.theme:'paper'; this.reader.serif=!!c.serif; } }catch(_){ } },
    readerSaveCfg(){ try{ localStorage.setItem('zb_reader', JSON.stringify({fontSize:this.reader.fontSize,lineGap:this.reader.lineGap,theme:this.reader.theme,serif:this.reader.serif})); }catch(_){ } },
    readerOpen(){ if(!this.currentBook||!this.currentPageMat){ this.flash('请先选择一本书',true); return; } this.readerLoadCfg(); this.reader.barsHidden=false; this.reader.panel=false; this.reader.tocOpen=false; this.reader.open=true; try{ document.body.style.overflow='hidden'; }catch(_){ } this.$nextTick(()=>this.readerScrollTop()); },
    readerClose(){ this.reader.open=false; this.reader.panel=false; this.reader.tocOpen=false; try{ document.body.style.overflow=''; }catch(_){ } },
    readerScrollTop(){ const el=this.$refs.readerScroll; if(el)el.scrollTop=0; },
    readerFont(d){ this.reader.fontSize=Math.min(30,Math.max(15,this.reader.fontSize+d)); this.readerSaveCfg(); },
    readerSetGap(g){ this.reader.lineGap=g; this.readerSaveCfg(); },
    readerSetTheme(t){ this.reader.theme=t; this.readerSaveCfg(); },
    readerSetSerif(v){ this.reader.serif=!!v; this.readerSaveCfg(); },
    readerToggleBars(){ this.reader.barsHidden=!this.reader.barsHidden; if(this.reader.barsHidden)this.reader.panel=false; },
    readerSavePos(){ try{ const b=this.currentBook; if(b)localStorage.setItem('zb_readpos:'+b.key, String(this.bookIdx)); }catch(_){ } },
    readerPrev(){ if(this.bookIdx<=0)return; this.bookPrev(); this.reader.panel=false; this.readerSavePos(); this.$nextTick(()=>this.readerScrollTop()); },
    readerNext(){ const b=this.currentBook; if(!b||this.bookIdx>=b.pages.length-1)return; this.bookNext(); this.reader.panel=false; this.readerSavePos(); this.$nextTick(()=>this.readerScrollTop()); },
    readerGoto(i){ this.bookGoto(i); this.reader.tocOpen=false; this.readerSavePos(); this.$nextTick(()=>this.readerScrollTop()); },
    readerTap(e){ if(this.reader.tocOpen){ this.reader.tocOpen=false; return; } if(this.reader.panel){ this.reader.panel=false; return; } try{ const sel=window.getSelection&&window.getSelection().toString(); if(sel&&sel.length)return; }catch(_){ } if(e.target&&e.target.closest&&e.target.closest('a,button,input,textarea,select,.katex,img,pre,code'))return; const w=window.innerWidth||360; const x=(e.clientX!=null)?e.clientX:w/2; if(x<w*0.3)this.readerPrev(); else if(x>w*0.7)this.readerNext(); else this.readerToggleBars(); },
    readerTouchStart(e){ const t=e.touches&&e.touches[0]; this._rsx=t?t.clientX:0; this._rsy=t?t.clientY:0; this._rst=Date.now(); },
    readerTouchEnd(e){ const t=e.changedTouches&&e.changedTouches[0]; if(!t)return; const dx=t.clientX-(this._rsx||0), dy=t.clientY-(this._rsy||0), dt=Date.now()-(this._rst||0); if(dt<600 && Math.abs(dx)>60 && Math.abs(dx)>Math.abs(dy)*1.6){ if(dx<0)this.readerNext(); else this.readerPrev(); } },
  }
};
