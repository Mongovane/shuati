// 收藏夹清单（Saved 页）—— 一屏总览收藏题、多选、批量取消收藏 / 导出
// 复用后端 GET /api/questions?mode=favorite；与刷题会话（practice.js 的 favorite 模式）并存，由 fav.listMode 切换
const SavedMixin = {
  methods: {
    // 载入收藏清单（沿用当前筛选：科目/章节/题型/标签）
    async loadFav(reset){
      if(!this.token)return;
      if(reset){ this.fav.items=[]; this.fav.offset=0; this.fav.sel=[]; }
      this.fav.loading=true;
      try{
        const p=new URLSearchParams();
        p.set('mode','favorite'); p.set('order', this.f.order||'seq');
        p.set('limit', String(this.fav.limit)); p.set('offset', String(this.fav.offset));
        if(this.f.subject && this.f.subject!=='all') p.set('subject', this.f.subject);
        if(this.f.chapter) p.set('chapter', this.f.chapter);
        if(this.f.type) p.set('type', this.f.type);
        if(this.f.tag && this.f.tag.trim()) p.set('tag', this.f.tag.trim());
        const d=await this.api('/api/questions?'+p.toString());
        const items=Array.isArray(d.items)?d.items:[];
        this.fav.items = this.fav.offset ? this.fav.items.concat(items) : items;
        if(d.total!=null && d.total>=0) this.fav.total=d.total;
        this.fav.loadedOnce=true;
      }catch(e){ if(e.message!=='unauth')this.flash('加载收藏失败：'+e.message,true); }
      this.fav.loading=false;
    },
    favLoadMore(){ this.fav.offset += this.fav.limit; this.loadFav(false); },
    favToggleSel(id){ const i=this.fav.sel.indexOf(id); if(i>=0)this.fav.sel.splice(i,1); else this.fav.sel.push(id); },
    favAllOnPage(e){ if(e.target.checked)this.fav.sel=this.fav.items.map(q=>q.id); else this.fav.sel=[]; },
    // 批量取消收藏（逐题调 favorite=0；本地移除）
    async favUnstarSel(){
      const ids=[...this.fav.sel]; if(!ids.length){ this.flash('请先勾选题目',true); return; }
      if(!confirm('取消收藏选中的 '+ids.length+' 题？（题目仍保留在题库，只是移出收藏）'))return;
      try{
        for(const id of ids){ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'favorite',question_id:id,value:0})}); }
        this.fav.items=this.fav.items.filter(q=>!ids.includes(q.id));
        this.fav.total=Math.max(0,this.fav.total-ids.length);
        this.fav.sel=[];
        this.flash('已取消收藏 '+ids.length+' 题');
        this.statsDirty=true;
      }catch(e){ if(e.message!=='unauth')this.flash('操作失败：'+e.message,true); }
    },
    // 单题取消收藏
    async favUnstarOne(q){
      try{ await this.api('/api/progress',{method:'POST',body:JSON.stringify({action:'favorite',question_id:q.id,value:0})});
        this.fav.items=this.fav.items.filter(x=>x.id!==q.id); this.fav.total=Math.max(0,this.fav.total-1);
        this.fav.sel=this.fav.sel.filter(id=>id!==q.id); this.flash('已取消收藏'); this.statsDirty=true;
      }catch(e){ if(e.message!=='unauth')this.flash('操作失败：'+e.message,true); }
    },
    // 导出选中（未选则导出当前已加载），复用 bankExportSel 的下载方式
    async favExportSel(){
      const ids=this.fav.sel.length?[...this.fav.sel]:this.fav.items.map(q=>q.id);
      if(!ids.length){ this.flash('没有可导出的题',true); return; }
      try{
        const out=[];
        for(let i=0;i<ids.length;i+=200){ const chunk=ids.slice(i,i+200);
          const d=await this.api('/api/questions?ids='+encodeURIComponent(chunk.join(','))+'&limit=200&order=seq');
          for(const q of (d.items||[])){ out.push({ subject:q.subject, chapter:q.chapter||undefined, type:q.type, difficulty:q.difficulty, stem:q.stem, passage:q.passage||undefined, options:q.options||[], answer:q.answer||[], analysis:q.analysis||undefined, tags:q.tags||[], source:q.source||undefined }); } }
        const blob=new Blob([JSON.stringify(out,null,2)],{type:'application/json'}); const a=document.createElement('a');
        a.href=URL.createObjectURL(blob); a.download='shuati-favorites-'+new Date().toISOString().slice(0,10)+'.json';
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),3000);
        this.flash('已导出 '+out.length+' 题为 JSON');
      }catch(e){ if(e.message!=='unauth')this.flash('导出失败：'+e.message,true); }
    },
    // 从清单点某题进入刷题（复用 practice 的 favorite 会话）
    favPractice(){ this.fav.listMode=false; this.f._mode='favorite'; this.startSession(); },
  },
};
