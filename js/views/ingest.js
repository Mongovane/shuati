// 导入：手动 / 照片 / JSON / PDF / Markdown / 本地与云端 OCR
// —— 由 app.js 按功能域拆分而来；与其余 mixin 合并进同一个 Vue 实例，this.* 跨文件可用 ——
const IngestMixin = { methods: {
parseChapterMd(text){ const t=String(text||''); const ch=t.match(/^#\s+(.+)$/m); const chapterTitle=ch?ch[1].trim():''; const src=t.match(/来源[:：]\s*(.+)/); const source=src?src[1].trim().replace(/[`*]/g,''):''; const parts=t.split(/^##\s*第\s*(\d+)\s*页\s*$/m); const pages=[]; for(let i=1;i<parts.length;i+=2){ const pageNo=parseInt(parts[i],10); const body=(parts[i+1]||'').trim(); if(Number.isFinite(pageNo))pages.push({page:pageNo,body}); } return {chapterTitle,source,pages,whole:t}; },
async onMdFiles(e){ const files=[...(e.target.files||[])]; if(!files.length)return; const out=[]; for(const f of files){ try{ out.push({name:f.name,text:await f.text()}); }catch(_){} } this.ingest.mdFiles=out; if(!this.ingest.bookTitle.trim()&&out[0]){ const m=out[0].text.match(/来源[:：]\s*(.+)/); this.ingest.bookTitle=(m?m[1].trim().replace(/[`*]/g,''):out[0].name.replace(/\.md$/i,'')); const gs=this.guessSubject(this.ingest.bookTitle); if(gs)this.ingest.subject=gs; } this.flash('已读取 '+out.length+' 个 Markdown 文件'); },
async importMarkdown(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } if(!this.ingest.mdFiles.length){ this.flash('请先选择 .md 文件',true); return; } const parsed=this.ingest.mdFiles.map(f=>({name:f.name,...this.parseChapterMd(f.text)})); let book=(this.ingest.bookTitle||'').trim(); if(!book){ const ps=parsed.find(p=>p.source); book=ps?ps.source:this.ingest.mdFiles[0].name.replace(/\.md$/i,''); } const subj=this.guessSubject(book)||this.ingest.subject; const items=[]; let seq=0; for(const p of parsed){ if(p.pages.length){ p.pages.forEach((pg,idx)=>{ let body=this.rewriteMdImages(pg.body); if(idx===0&&p.chapterTitle)body='**'+p.chapterTitle+'**\n\n'+body; items.push({page:pg.page,content:body,chapter:p.chapterTitle}); }); } else { seq++; items.push({page:seq,content:this.rewriteMdImages(p.whole),chapter:p.chapterTitle}); } } items.sort((a,b)=>(a.page||0)-(b.page||0)); this.ingest.local.busy=true; this.ingest.local.done=0; this.ingest.local.total=items.length; this.ingest.local.inserted=0; this.ingest.result=null; try{ let n=0; for(const it of items){ this.ingest.local.prog='正在导入第 '+(n+1)+'/'+items.length+' 页'; await this.saveOneMaterial({id:'mat-'+subj+'-'+this.bookHashId(book+'#p'+it.page),subject:subj,title:book+' · 第 '+it.page+' 页',source:book,page:it.page,content_md:it.content,summary:'',tags:it.chapter?[it.chapter,'Markdown导入']:['Markdown导入']}); n++; this.ingest.local.done=n; this.ingest.local.inserted=n; } this.ingest.result={kind:'material',inserted_questions:0,inserted_materials:n,material_sample:[]}; this.flash('已导入《'+book+'》'+n+' 页到 Books（去 Books 查看）'); this.loadMaterials(); }catch(e){ if(e.message!=='unauth')this.flash('Markdown 导入中断：已存 '+this.ingest.local.inserted+' 页，'+e.message,true); this.loadMaterials(); } this.ingest.local.busy=false; this.ingest.local.prog=''; },
importMsg(d){ const q=d.inserted_questions??d.inserted??0; const m=d.inserted_materials??0; if(q&&m)return '识别为「题目+教材」，已导入 '+q+' 题、整理 '+m+' 段教材'; if(m)return '识别为教材，已整理 '+m+' 段（去「教材阅读」查看）'; return '识别为题库，已导入 '+q+' 题'; },
makeSource(){ if(!this.ingest.bookMode)return this.ingest.source||''; const parts=[this.ingest.bookName||'小红本', this.subjName(this.ingest.subject), this.ingest.chapter||'未分章']; if(this.ingest.pageNo)parts.push('P'+String(this.ingest.pageNo).trim()); if(this.ingest.questionNo)parts.push('第'+String(this.ingest.questionNo).trim()+'题'); return parts.join('-'); },
currentSource(){ return (this.ingest.tab==='manual' && this.ingest.bookMode) ? this.makeSource() : (this.ingest.source||''); },
sourceForPage(p){ const old=this.ingest.pageNo; this.ingest.pageNo=String(p||''); const v=this.currentSource(); this.ingest.pageNo=old; return v; },
async loadCfUsage(){ if(!this.token)return; try{ const res=await fetch('/api/cfocr',{headers:{'authorization':'Bearer '+this.token}}); const ct=res.headers.get('content-type')||''; if(ct.includes('json')){ const d=await res.json(); if(res.ok){ this.cfocr.used=d.used||0; this.cfocr.limit=d.limit||150; if(d.budget)this.cfocr.budget=d.budget; if(d.npp)this.cfocr.npp=d.npp; this.ai.hasCfAI=!!d.has_cf_ai; } } }catch(e){} },
async cfocrOcrCanvas(cv){ const b64=cv.toDataURL('image/png').split(',')[1]; const body={image_b64:b64}; if((this.ingest.local.cfModel||'').trim().startsWith('@cf/'))body.model=this.ingest.local.cfModel.trim(); const res=await fetch('/api/cfocr',{method:'POST',headers:{'authorization':'Bearer '+this.token,'content-type':'application/json'},body:JSON.stringify(body)}); const ct=res.headers.get('content-type')||''; let d=null; if(ct.includes('json')){ try{ d=await res.json(); }catch(_){} } if(res.status===401){ this.token=''; localStorage.removeItem('zb_token'); this.view='settings'; throw new Error('unauth'); } if(res.status===404 || !ct.includes('json')){ const e=new Error('Workers AI 接口不可用：请确认已部署 functions/api/cfocr.js 并绑定 Workers AI（变量名 AI），然后重新部署。'); e.fatal=true; throw e; } if(d){ if(typeof d.used==='number')this.cfocr.used=d.used; if(typeof d.limit==='number')this.cfocr.limit=d.limit; if(d.budget)this.cfocr.budget=d.budget; if(d.npp)this.cfocr.npp=d.npp; } if(res.status===429){ const e=new Error((d&&d.error)||'今日免费额度已用完'); e.quota=true; throw e; } if(!res.ok){ const e=new Error((d&&d.error)||('Workers AI 失败 HTTP '+res.status)); if(/未绑定|绑定/.test(e.message))e.fatal=true; throw e; } return String((d&&d.text)||'').trim(); },
buildManualQuestion(){ const m=this.ingest.manual;
      const type=m.type;
      const opts=(type==='single_choice'||type==='multiple_choice') ? m.options.map(o=>({key:String(o.key||'').trim().toUpperCase(),text:String(o.text||'').trim()})).filter(o=>o.key&&o.text) : [];
      const ansRaw=String(m.answer||'').trim();
      let answer=[];
      if(type==='multiple_choice') answer=ansRaw.split(/[，,\s]+/).map(x=>x.trim().toUpperCase()).filter(Boolean);
      else if(type==='single_choice') answer=ansRaw ? [ansRaw[0].toUpperCase()] : [];
      else if(type==='true_false') answer=[/^t|true|对|正确|是|1$/i.test(ansRaw)?'T':'F'];
      else if(type==='fill_blank') answer=ansRaw.split(/\n+/).map(x=>x.trim()).filter(Boolean);
      else answer=ansRaw ? [ansRaw] : [];
      return { subject:this.ingest.subject, chapter:this.ingest.chapter, type, difficulty:Number(m.difficulty)||3, source:this.currentSource()||'手动录入', passage:m.passage||'', stem:m.stem||'', options:opts, answer, analysis:m.analysis||'', tags:String(m.tags||'').split(/[，,]/).map(x=>x.trim()).filter(Boolean) };
    },
resetManual(){ this.ingest.manual={ type:'single_choice', difficulty:3, stem:'', passage:'', options:[{key:'A',text:''},{key:'B',text:''},{key:'C',text:''},{key:'D',text:''}], answer:'', analysis:'', tags:'' }; this.ingest.photoUrl=''; },
async saveManual(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      const q=this.buildManualQuestion();
      if(!String(q.stem||'').trim()){ this.flash('请输入题干',true); return; }
      if((q.type==='single_choice'||q.type==='multiple_choice') && q.options.length<2){ this.flash('选择题至少需要 2 个选项',true); return; }
      if(!q.answer.length){ this.flash('请输入答案',true); return; }
      this.ingest.busy=true; this.ingest.result=null;
      try{ const d=await this.api('/api/process',{method:'POST',body:JSON.stringify({subject:this.ingest.subject,chapter:this.ingest.chapter,source:this.currentSource(),questions:[q]})}); this.ingest.result=d; this.flash('已免费保存 1 题'); const n=parseInt(this.ingest.questionNo,10); this.resetManual(); if(Number.isFinite(n))this.ingest.questionNo=String(n+1); this.loadMeta(true); this.statsDirty=true; this.bankDirty=true; }
      catch(e){ if(e.message!=='unauth')this.flash(e.message,true); }
      this.ingest.busy=false;
    },
onPhotoFile(e){ const file=e.target.files&&e.target.files[0]; if(!file)return; const rd=new FileReader(); rd.onload=()=>{ this.ingest.photoDataUrl=String(rd.result||''); this.ingest.photoUrl=this.ingest.photoDataUrl; this.ingest.tab='photo'; this.flash('图片已加载，可手动录入或调用 AI OCR'); }; rd.onerror=()=>this.flash('图片读取失败',true); rd.readAsDataURL(file); },
async aiPhotoImport(){ if(!this.ingest.photoDataUrl){ this.flash('请先选择照片',true); return; } if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } this.ingest.busy=true; this.ingest.result=null; try{ const d=await this.api('/api/process',{method:'POST',body:JSON.stringify({...this.aiOv(true),subject:this.ingest.subject,chapter:this.ingest.chapter,source:this.currentSource(),kind:this.ingest.kind,images:[this.ingest.photoDataUrl]})}); this.ingest.result=d; this.flash(this.importMsg(d)); this.loadMeta(true); this.statsDirty=true; this.bankDirty=true; this.loadMaterials(); }catch(e){ if(e.message!=='unauth')this.flash(e.message,true); } this.ingest.busy=false; },
async doIngest(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      const body={ subject:this.ingest.subject, chapter:this.ingest.chapter, source:this.currentSource() };
      if(this.ingest.tab==='json'){ let arr; try{ arr=JSON.parse(this.ingest.json); }catch(e){ this.flash('JSON parse failed: '+e.message,true); return; }
        if(!Array.isArray(arr)||!arr.length){ this.flash('请粘贴非空 JSON 数组',true); return; } body.questions=arr;
      } else { if(!this.ingest.raw.trim()){ this.flash('请先粘贴原始文本',true); return; } body.raw_text=this.ingest.raw; body.kind=this.ingest.kind; }
      this.ingest.busy=true; this.ingest.result=null;
      try{ Object.assign(body, this.aiOv(false)); const d=await this.api('/api/process',{method:'POST',body:JSON.stringify(body)}); this.ingest.result=d; this.flash(this.importMsg(d)); this.loadMeta(true); this.statsDirty=true; this.bankDirty=true; this.loadMaterials();
        if(this.ingest.tab==='ai')this.ingest.raw=''; else this.ingest.json=''; }
      catch(e){ if(e.message!=='unauth')this.flash(e.message,true); }
      this.ingest.busy=false;
    },
async loadSample(){ try{ const r=await fetch('/sample-questions.json'); const j=await r.json(); this.ingest.json=JSON.stringify(j,null,2); this.ingest.tab='json'; this.flash('Sample loaded — click Import'); }
      catch(e){ this.flash('sample-questions.json not found',true); } },
loadScript(src){ return new Promise((res,rej)=>{ this._scripts=this._scripts||{}; if(this._scripts[src])return res(); const s=document.createElement('script'); s.src=src; s.onload=()=>{ this._scripts[src]=1; res(); }; s.onerror=()=>rej(new Error('加载失败：'+src)); document.head.appendChild(s); }); },
async ensurePdfjs(){ if(window.pdfjsLib)return; await this.loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'); window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'; },
async onPdfFile(e){ const file=e.target.files&&e.target.files[0]; if(!file)return; this.ingest.result=null; this.ingest.pdf.prog='正在加载 PDF…'; this.ingest.pdf.pages=0; const nm=(file.name||'').replace(/\.[Pp][Dd][Ff]$/,'').trim(); if(nm)this.ingest.bookTitle=nm; const gs=this.guessSubject(nm); if(gs)this.ingest.subject=gs;
      try{ await this.ensurePdfjs(); const buf=await file.arrayBuffer(); const doc=await window.pdfjsLib.getDocument({data:buf}).promise; this._pdfDoc=doc; this.ingest.pdf.pages=doc.numPages; this.ingest.pdf.start=1; this.ingest.pdf.end=Math.min(3,doc.numPages); this.ingest.pdf.prog=''; this.flash('已加载 PDF，共 '+doc.numPages+' 页'); }
      catch(err){ this.ingest.pdf.prog=''; this.flash('PDF 加载失败：'+err.message,true); } },
chunkText(text,size=6000,overlap=200){ text=String(text).replace(/\n{3,}/g,'\n\n').trim(); const out=[]; let i=0,n=text.length; while(i<n){ let end=Math.min(i+size,n); if(end<n){ const br=text.lastIndexOf('\n',end); if(br>i && br>end-overlap*4) end=br; } const p=text.slice(i,end).trim(); if(p)out.push(p); i=end; } return out; },
mdFromText(text){ return String(text||'').replace(/\r/g,'').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim(); },
chunkForMaterial(text){ return this.chunkText(text,4000,0); },
materialBaseTitle(){ return (this.ingest.bookTitle||'').trim() || (this.ingest.chapter||'').trim() || '教材'; },
async ensureTesseract(){ await this.loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'); if(!window.Tesseract) throw new Error('本地 OCR 引擎加载失败（网络受限时可改用文字 PDF 或自托管）'); return await window.Tesseract.createWorker(['chi_sim','eng']); },
async ensureScribe(){ if(this._scribe) return this._scribe; const urls=['https://esm.sh/scribe.js-ocr','https://cdn.jsdelivr.net/npm/scribe.js-ocr/+esm']; let mod=null,err=null; for(const u of urls){ try{ mod=await import(u); break; }catch(e){ err=e; } } if(!mod) throw new Error('Scribe.js 加载失败（CDN/网络）：'+((err&&err.message)||'未知')); this._scribe=mod.default||mod; return this._scribe; },
async scribeOcrCanvas(cv){ const scribe=await this.ensureScribe(); const blob=await new Promise(res=>cv.toBlob(res,'image/png')); if(!blob) throw new Error('页面转图片失败'); const out=await scribe.extractText([blob],['chi_sim','eng']); return String(Array.isArray(out)?out.join('\n'):(out||'')).trim(); },
async saveOneMaterial(m){ return this.api('/api/materials',{method:'POST',body:JSON.stringify(m)}); },
async saveMaterialsLocal(text,baseTitle){ const clean=this.mdFromText(text); if(!clean){ this.flash('没有可保存的文本',true); return 0; } const parts=this.chunkForMaterial(clean); let n=0; this.ingest.local.total=parts.length; for(let i=0;i<parts.length;i++){ this.ingest.local.prog='正在保存第 '+(i+1)+'/'+parts.length+' 段教材'; const title=parts.length>1 ? (baseTitle+' ('+(i+1)+'/'+parts.length+')') : baseTitle; const d=await this.saveOneMaterial({id:'mat-'+this.ingest.subject+'-'+this.bookHashId(baseTitle+'#'+i),subject:this.ingest.subject,title,source:baseTitle,content_md:parts[i],summary:'',tags:this.ingest.chapter?[this.ingest.chapter,'本地导入']:['本地导入']}); n+=d.inserted||1; this.ingest.local.done=i+1; this.ingest.local.inserted=n; } return n; },
async saveTextAsMaterial(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } const text=(this.ingest.raw||'').trim(); if(!text){ this.flash('请先粘贴或提取文本',true); return; } this.ingest.local.busy=true; this.ingest.local.done=0; this.ingest.local.inserted=0; this.ingest.result=null; try{ const n=await this.saveMaterialsLocal(text,this.materialBaseTitle()); this.ingest.result={kind:'material',inserted_questions:0,inserted_materials:n,material_sample:[]}; this.flash('已保存 '+n+' 段教材到 Books（未调用 AI）'); this.loadMaterials(); }catch(e){ if(e.message!=='unauth')this.flash('保存失败：'+e.message,true); } this.ingest.local.busy=false; this.ingest.local.prog=''; },
pdfAllToMaterialLocal(){ if(!this._pdfDoc){ this.flash('请先选择 PDF',true); return; } this.ingest.pdf.start=1; this.ingest.pdf.end=this._pdfDoc.numPages; this.pdfToMaterialLocal(); },
async pdfToMaterialLocal(){
      if(!this._pdfDoc){ this.flash('请先选择 PDF',true); return; }
      if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      const doc=this._pdfDoc;
      const st=Math.max(1,parseInt(this.ingest.pdf.start||1,10)||1);
      const ed=Math.min(doc.numPages,parseInt(this.ingest.pdf.end||st,10)||st);
      if(ed<st){ this.flash('结束页不能小于开始页',true); return; }
      // 预检：首页能否提取到文字；扫描版且未开 OCR 会一无所获，提前提示
      try{ const pg0=await doc.getPage(st); const tc0=await pg0.getTextContent(); const t0=tc0.items.map(it=>it.str).join('').replace(/\s/g,''); if(t0.length<10 && !this.ingest.local.ocr){ if(confirm('第 '+st+' 页提取不到文字，这本很可能是扫描版 PDF。\n开启「本地 OCR」用浏览器识别图片文字后继续？\n\n确定 = 开启本地 OCR 并继续（较慢，质量一般）\n取消 = 不继续（可改用文字版 PDF，或用「AI OCR…只当教材」）')) this.ingest.local.ocr=true; else return; } }catch(_){}
      const n=ed-st+1;
      if(n>30 && !confirm('将处理 '+n+' 页（第 '+st+'–'+ed+' 页）。\n会自动分批进行；扫描页本地 OCR 较慢，请保持本标签页在前台、勿让电脑休眠。\n确定开始？')) return;
      const BATCH=25;
      this.ingest.local.busy=true; this.ingest.local.stop=false; this.ingest.local.done=0; this.ingest.local.total=n; this.ingest.local.inserted=0; this.ingest.local.lastPage=0; this.ingest.local.endPage=ed; this.ingest.local.log=[]; this.ingest.result=null;
      let tess=null, saved=0, scanned=0;
      try{
        for(let p=st;p<=ed;p++){
          if(this.ingest.local.stop){ const nxt=Math.min(ed,(this.ingest.local.lastPage||(st-1))+1); this.ingest.pdf.start=nxt; this.flash('已停止，已保存 '+saved+' 段。开始页已设为 '+nxt+'，可再点继续'); break; }
          // 分批：每处理 BATCH 页就重建 OCR 引擎释放内存并短暂喘息，降低长任务下标签页卡死概率
          if(p>st && (p-st)%BATCH===0){
            if(tess&&tess.terminate){ try{ await tess.terminate(); }catch(_){} tess=null; }
            this.ingest.local.prog='已完成 '+(p-st)+'/'+n+' 页，正在释放内存…';
            await this.sleep(800);
          }
          this.ingest.local.prog='正在处理第 '+p+'/'+ed+' 页';
          const page=await doc.getPage(p);
          const tc=await page.getTextContent();
          let text=tc.items.map(it=>it.str).join(' ').replace(/\s+\n/g,'\n').trim();
          let usedOcr=false;
          if(text.replace(/\s/g,'').length<10 && this.ingest.local.ocr){
            const scale=Math.max(2.4, Number(this.ingest.pdf.scale)||1.7); const vp=page.getViewport({scale});
            const cv=document.createElement('canvas'); cv.width=Math.floor(vp.width); cv.height=Math.floor(vp.height);
            await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
            const eng=this.ingest.local.engine==='scribe'?'Scribe.js':(this.ingest.local.engine==='cfai'?'Workers AI':'tesseract');
            this.ingest.local.prog='本地 OCR 第 '+p+'/'+ed+' 页（'+eng+'，首次较慢）';
            if(this.ingest.local.engine==='scribe'){
              try{ text=await this.scribeOcrCanvas(cv); }
              catch(e){ this.flash('Scribe.js 不可用，已回退 tesseract：'+e.message,true); this.ingest.local.engine='tesseract'; if(!tess)tess=await this.ensureTesseract(); const r=await tess.recognize(cv); text=String(r?.data?.text||'').trim(); }
            } else if(this.ingest.local.engine==='cfai'){
              const effLimit=Math.min(Number(this.ingest.local.cfPageLimit)||50, this.cfocr.limit||70);
              if(this.cfocr.used>=effLimit){ const nxt=Math.min(ed,p); this.ingest.pdf.start=nxt; this.ingest.local.stop=true; this.flash('已达今日设定上限（'+effLimit+' 页，约 '+(effLimit*this.cfocr.npp)+' 神经元）。停在第 '+p+' 页，明天或调高上限再继续。',true); cv.width=cv.height=0; break; }
              this.ingest.local.prog='Workers AI 第 '+p+'/'+ed+' 页（今日 '+this.cfocr.used+'/'+effLimit+'）';
              try{ text=await this.cfocrOcrCanvas(cv); }
              catch(e){ cv.width=cv.height=0; if(e.message==='unauth')throw e; if(e.quota||e.fatal){ const nxt=Math.min(ed,p); this.ingest.pdf.start=nxt; this.ingest.local.stop=true; this.logPage(p,'err',e.message); this.flash(e.message+(e.quota?('（已停在第 '+p+' 页，明天或换引擎从这继续）'):''),true); break; } this.logPage(p,'err','Workers AI 出错：'+e.message); this.ingest.local.done=(p-st+1); this.ingest.local.lastPage=p; continue; }
            } else if(this.ingest.local.engine==='relay'){
              this.ingest.local.prog='中转站视觉 OCR 第 '+p+'/'+ed+' 页…';
              try{ text=await this.relayOcrCanvas(cv); }
              catch(e){ cv.width=cv.height=0; if(e.message==='unauth')throw e; if(e.fatal){ const nxt=Math.min(ed,p); this.ingest.pdf.start=nxt; this.ingest.local.stop=true; this.logPage(p,'err',e.message); this.flash(e.message,true); break; } this.logPage(p,'err','中转站出错：'+e.message); this.ingest.local.done=(p-st+1); this.ingest.local.lastPage=p; continue; }
            } else {
              if(!tess)tess=await this.ensureTesseract(); const r=await tess.recognize(cv); text=String(r?.data?.text||'').trim();
            }
            usedOcr=true; scanned++;
            cv.width=cv.height=0;
          }
          this.ingest.local.done=(p-st+1); this.ingest.local.lastPage=p;
          if(!text){ this.logPage(p,'skip', usedOcr?'OCR 没识别出文字（模型可能不支持图片/空白页）':'无文字层（扫描页？可勾选 OCR）'); continue; }
          const title=this.materialBaseTitle()+' · 第 '+p+' 页';
          const md=this.mdFromText(text)+(usedOcr?('\n\n> 本页由'+(this.ingest.local.engine==='relay'?'中转站视觉模型':this.ingest.local.engine==='cfai'?'Workers AI':'本地 OCR')+'识别，可能有误差。'):'');
          const d=await this.saveOneMaterial({id:'mat-'+this.ingest.subject+'-'+this.bookHashId(this.materialBaseTitle()+'#p'+p),subject:this.ingest.subject,title,source:this.materialBaseTitle(),page:p,content_md:md,summary:'',tags:this.ingest.chapter?[this.ingest.chapter,'本地导入']:['本地导入']});
          saved+=d.inserted||1; this.ingest.local.inserted=saved; this.logPage(p,'ok','已存 '+md.length+' 字'+(usedOcr?'（'+(this.ingest.local.engine==='relay'?'中转站':this.ingest.local.engine==='cfai'?'Workers AI':this.ingest.local.engine)+'）':'（文字层）'));
        }
        if(!this.ingest.local.stop){ this.ingest.result={kind:'material',inserted_questions:0,inserted_materials:saved,material_sample:[]}; if(saved===0){ this.flash(this.ingest.local.ocr?'未保存任何内容：本地 OCR 没识别出文字，可能是空白页或图像太糊，可调高清晰度后重试。':'未保存任何内容：这些页提取不到文字（多为扫描版）。请勾选「扫描页用本地 OCR」后重试，或用「AI OCR…只当教材」。',true); } else { this.flash('已保存 '+saved+' 段教材到 Books（未调用 AI）'+(scanned?('，其中 '+scanned+' 页用本地 OCR'):'')); } }
        this.loadMaterials();
      }catch(e){ if(e.message!=='unauth'){ const nxt=Math.min(ed,(this.ingest.local.lastPage||(st-1))+1); this.ingest.pdf.start=nxt; this.flash('本地转化中断：已保存 '+saved+' 段，开始页已设为 '+nxt+'。'+e.message,true); } this.loadMaterials(); }
      if(tess&&tess.terminate){ try{ await tess.terminate(); }catch(_){} }
      this.ingest.local.busy=false; this.ingest.local.prog='';
    },
async photoToMaterialLocal(){ if(!this.ingest.photoDataUrl){ this.flash('请先选择照片',true); return; } if(!this.token){ this.flash('请先在设置中填写访问码',true); return; } this.ingest.local.busy=true; this.ingest.local.done=0; this.ingest.local.inserted=0; this.ingest.result=null; let tess=null; try{ let text=''; if(this.ingest.local.engine==='relay'){ try{ this.ingest.local.prog='中转站视觉 OCR 识别中…'; const img=new Image(); img.src=this.ingest.photoDataUrl; await img.decode(); const cv=document.createElement('canvas'); cv.width=img.naturalWidth; cv.height=img.naturalHeight; cv.getContext('2d').drawImage(img,0,0); text=await this.relayOcrCanvas(cv); }catch(e){ if(e.message!=='unauth')this.flash(e.message,true); if(e.fatal){ this.ingest.local.busy=false; this.ingest.local.prog=''; return; } } } else if(this.ingest.local.engine==='cfai'){ try{ this.ingest.local.prog='Workers AI 识别中（今日 '+this.cfocr.used+'/'+this.cfocr.limit+'）…'; const img=new Image(); img.src=this.ingest.photoDataUrl; await img.decode(); const cv=document.createElement('canvas'); cv.width=img.naturalWidth; cv.height=img.naturalHeight; cv.getContext('2d').drawImage(img,0,0); text=await this.cfocrOcrCanvas(cv); }catch(e){ if(e.message!=='unauth')this.flash(e.message,true); if(e.quota||e.fatal){ this.ingest.local.busy=false; this.ingest.local.prog=''; return; } } } else if(this.ingest.local.engine==='scribe'){ try{ this.ingest.local.prog='Scribe.js 识别中（首次较慢）…'; const img=new Image(); img.src=this.ingest.photoDataUrl; await img.decode(); const cv=document.createElement('canvas'); cv.width=img.naturalWidth; cv.height=img.naturalHeight; cv.getContext('2d').drawImage(img,0,0); text=await this.scribeOcrCanvas(cv); }catch(e){ this.flash('Scribe.js 不可用，已回退 tesseract：'+e.message,true); this.ingest.local.engine='tesseract'; } } if(!text){ this.ingest.local.prog='tesseract 识别中（首次较慢）…'; tess=await this.ensureTesseract(); const r=await tess.recognize(this.ingest.photoDataUrl); text=String(r?.data?.text||'').trim(); } if(!text){ this.flash('未识别出文字',true); } else { const n=await this.saveMaterialsLocal(text,this.materialBaseTitle()); this.ingest.result={kind:'material',inserted_questions:0,inserted_materials:n,material_sample:[]}; this.flash('本地 OCR 完成，已保存 '+n+' 段教材（未调用 AI）'); this.loadMaterials(); } }catch(e){ if(e.message!=='unauth')this.flash('本地 OCR 失败：'+e.message,true); } if(tess&&tess.terminate){ try{ await tess.terminate(); }catch(_){} } this.ingest.local.busy=false; this.ingest.local.prog=''; },
_fullToHalf(s){ return String(s||'').replace(/[Ａ-Ｚａ-ｚ０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-65248)); },
mdToQuestions(md, ctx){ ctx=ctx||{}; const text=String(md||'').replace(/\r/g,''); const lines=text.split('\n');
      let chapter=ctx.chapter||''; const items=[]; let cur=null;
      const xiti=/(习题|练习|复习题|总习题|自测题|思考题|例题)\s*[0-9０-９]/; const zhang=/第\s*[0-9０-９一二三四五六七八九十百]+\s*[章节]/;
      const headRe=/^#{1,6}\s+(.+?)\s*#*$/; const boldRe=/^\s*\*\*(.+?)\*\*\s*$/; const numRe=/^\s*\*{0,2}\s*([0-9０-９]{1,3})\s*[.．、)）]\s*(.+)$/;
      const flush=()=>{ if(cur&&cur.lines.join('').trim())items.push(cur); cur=null; };
      for(const raw of lines){ let head=null; const h=raw.match(headRe); if(h)head=h[1]; else { const b=raw.match(boldRe); if(b)head=b[1]; }
        if(head){ const t=head.replace(/\*\*/g,'').trim(); if(xiti.test(t)||zhang.test(t)){ chapter=t; flush(); continue; } if(h){ flush(); continue; } }
        const nm=raw.match(numRe); if(nm){ flush(); cur={ num:nm[1], chapter, lines:[nm[2]] }; continue; }
        if(cur)cur.lines.push(raw); }
      flush();
      const out=[]; for(const it of items){ const q=this._buildQuestionFromItem(it, ctx); if(q)out.push(q); } return out; },
_buildQuestionFromItem(it, ctx){ const body=it.lines.join('\n').trim(); if(!body)return null;
      // 找"解/证/解答/证明/分析/答案"边界：可在行首，也可在句末标点后（MinerU 常把题目和解答放在同一段）
      const solRe=/(^|[\n。．.；;！!？?）)\]】」])\s*[>*【「\[]?\s*(解答|证明|分析|解|证|答案|答)\s*[】」\]]?\s*[：:．.、]?\s*(?=[\s$（(\\A-Za-z\u4e00-\u9fa5\d])/;
      const m=body.match(solRe); let stemPart, solPart='';
      if(m && m.index!=null){ const cut=m.index+(m[1]?m[1].length:0); const head=body.slice(0,cut).trim(); if(head){ stemPart=head; solPart=body.slice(cut).trim(); } else { stemPart=body; } }
      else { stemPart=body; }
      const optRe=/^\s*[（(]?\s*([A-DＡ-Ｄ])\s*[）).．、]\s*(.+)$/; const sl=stemPart.split('\n'); const opts=[]; const keep=[];
      for(const ln of sl){ const om=ln.match(optRe); if(om){ opts.push({ key:this._fullToHalf(om[1]), text:om[2].trim() }); } else keep.push(ln); }
      let type='short_answer', options=[], answer=[], analysis='';
      if(opts.length>=2){ type='single_choice'; options=opts; stemPart=keep.join('\n').trim();
        const am=solPart.match(/(?:答案|正确答案|答|选|应选)\s*[是为：:]?\s*([A-DＡ-Ｄ](?:\s*[,，、和]\s*[A-DＡ-Ｄ])*)/);
        if(am){ const keys=this._fullToHalf(am[1]).split(/[,，、和\s]+/).filter(Boolean); answer=keys; if(keys.length>1)type='multiple_choice'; }
        analysis=solPart; }
      else { type='short_answer'; if(solPart){ answer=[solPart]; analysis=solPart; } }
      const stem=(stemPart||'').trim(); if(!stem)return null;
      return { subject:ctx.subject||'', chapter:it.chapter||ctx.chapter||'', type, difficulty:3, source:ctx.source||'', passage:'', stem, options, answer, analysis, tags:it.chapter?[it.chapter]:[], page:(ctx.page!=null?ctx.page:null) }; },
async _postQuestions(arr, subject, source){ let inserted=0; const CH=40; for(let i=0;i<arr.length;i+=CH){ const d=await this.api('/api/process',{method:'POST',body:JSON.stringify({ subject, source, questions:arr.slice(i,i+CH) })}); inserted+=(d.inserted_questions??d.inserted??0); } if(inserted>0)this.bankDirty=true; return inserted; },
_openPreview(arr, title, subject, source){ const seen=new Set(); const uniq=[]; let dup=0; for(const q of arr){ const k=String(q.stem||'').replace(/\s+/g,' ').trim(); if(!k)continue; if(seen.has(k)){ dup++; continue; } seen.add(k); uniq.push(q); } this.extractPreview={ open:true, items:uniq.map(q=>Object.assign({_use:true},q)), title, subject, source, dup }; },
extractMissingCount(){ return this.extractPreview.items.filter(q=>q._use && !(q.answer&&q.answer.length)).length; },
extractUseCount(){ return this.extractPreview.items.filter(q=>q._use).length; },
extractToggleMissing(){ const hasOn=this.extractPreview.items.some(q=>q._use&&!(q.answer&&q.answer.length)); this.extractPreview.items.forEach(q=>{ if(!(q.answer&&q.answer.length))q._use=!hasOn; }); },
extractClose(){ this.extractPreview.open=false; this.extractPreview.items=[]; },
ansLines(q){ return ((q&&q.answer)||[]).join('\n'); },
async localExtractPage(){ const m=this.currentPageMat; if(!m){ this.flash('请先选择一页',true); return; } if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      const src=this.currentBook?this.currentBook.title:(m.source||''); const arr=this.mdToQuestions(m.content_md,{subject:m.subject,source:src,page:m.page});
      if(!arr.length){ this.flash('这一页没解析出题目（可能不是习题页，或编号格式特殊，可改用 AI 抽取）',true); return; }
      this._openPreview(arr, (m.title||'本页')+'（预览）', m.subject, src); },
async localExtractBook(){ const b=this.currentBook; if(!b||!b.pages.length){ this.flash('请先选择一本书',true); return; } if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      let all=[]; for(const m of b.pages){ all=all.concat(this.mdToQuestions(m.content_md,{subject:m.subject||b.subject,source:b.title,page:m.page})); }
      if(!all.length){ this.flash('整本书没解析出题目（可能这本不是习题集）',true); return; }
      this._openPreview(all, '《'+b.title+'》整本（预览）', b.subject, b.title); },
async extractDoImport(){ const p=this.extractPreview; const arr=p.items.filter(q=>q._use).map(q=>{ const c=Object.assign({},q); delete c._use; return c; }); if(!arr.length){ this.flash('没有勾选要导入的题',true); return; }
      this.bookExtract.busy=true; this.bookExtract.done=0; this.bookExtract.total=arr.length;
      try{ let inserted=0; const CH=40; for(let i=0;i<arr.length;i+=CH){ this.bookExtract.prog='正在导入 '+Math.min(i+CH,arr.length)+' / '+arr.length; const d=await this.api('/api/process',{method:'POST',body:JSON.stringify({ subject:p.subject, source:p.source, questions:arr.slice(i,i+CH) })}); inserted+=(d.inserted_questions??d.inserted??0); this.bookExtract.done=Math.min(i+CH,arr.length); }
        this.flash('已导入 '+inserted+' 道题到题库（未用 AI）'); this.loadMeta(true); this.statsDirty=true; this.bankDirty=true; this.extractClose(); }
      catch(e){ if(e.message!=='unauth')this.flash('导入失败：'+e.message,true); } this.bookExtract.busy=false; this.bookExtract.prog=''; },
saveOcrCfg(){ try{ localStorage.setItem('zb_ocrcfg', JSON.stringify(this.ocrCfg)); }catch(_){} },
logPage(p,t,msg){ const arr=this.ingest.local.log; arr.push({p,t,msg}); if(arr.length>500)arr.splice(0,arr.length-500); },
async importMarkdownAsBook(md, book, subj, tag, off){ off=off||0; const parts=this.chunkMarkdownByStructure(md); if(!parts.length){ return 0; } let n=0; for(let i=0;i<parts.length;i++){ this.ingest.mineru.prog='导入第 '+(off+i+1)+' 段…'; const h=this.firstHeadingOf(parts[i]); const gp=off+i+1; const title=book+' · '+(h||('第 '+gp+' 段')); const d=await this.saveOneMaterial({id:'mat-'+subj+'-'+this.bookHashId(book+'#p'+gp),subject:subj,title,source:book,page:gp,content_md:parts[i],summary:'',tags:tag?[tag]:[]}); n+=d.inserted||1; } return n; },
stripFurniturePages(pages){ if(!pages||pages.length<4)return (pages||[]).map(p=>({page:p.page, md:p.md.split('\n').filter(l=>!/^\s*\d{1,4}\s*$/.test(l.trim())).join('\n').replace(/\n{3,}/g,'\n\n').trim()})).filter(p=>p.md); const freq={}; const N=pages.length; pages.forEach(p=>{ const seen=new Set(); p.md.split('\n').forEach(l=>{ const t=l.trim(); if(t&&t.length<=24&&!/^#{1,6}\s/.test(t)&&!/^(figure|<)/i.test(t)){ if(!seen.has(t)){ seen.add(t); freq[t]=(freq[t]||0)+1; } } }); }); const thr=Math.max(3, Math.ceil(N*0.3)); const furniture=new Set(Object.keys(freq).filter(k=>freq[k]>=thr)); return pages.map(p=>{ const lines=p.md.split('\n').filter(l=>{ const t=l.trim(); if(!t)return true; if(/^\s*\d{1,4}\s*$/.test(t))return false; if(furniture.has(t))return false; return true; }); return {page:p.page, md:lines.join('\n').replace(/\n{3,}/g,'\n\n').trim()}; }).filter(p=>p.md); },
async importPagesAsBook(pages, book, subj, tag, off){ off=off||0; pages=this.stripFurniturePages(pages); let n=0; for(let i=0;i<pages.length;i++){ const p=pages[i]; const gp=off+(p.page||i+1); this.ingest.mineru.prog='导入第 '+gp+' 页…'; const h=this.firstHeadingOf(p.md); const title=book+' · '+(h||('第 '+gp+' 页')); const d=await this.saveOneMaterial({id:'mat-'+subj+'-'+this.bookHashId(book+'#p'+gp),subject:subj,title,source:book,page:gp,content_md:p.md,summary:'',tags:tag?[tag]:[]}); n+=d.inserted||1; } return n; },
async relayOcrCanvas(cv){ const dataUrl=cv.toDataURL('image/jpeg',0.9); const body={image_b64:dataUrl}; if((this.ocrCfg.model||'').trim())body.model=this.ocrCfg.model.trim();
    if((this.ocrCfg.base||'').trim()){ body.base_url=this.ocrCfg.base.trim(); if((this.ocrCfg.key||'').trim())body.api_key=this.ocrCfg.key.trim(); }
    else if(this.explainCfg&&this.explainCfg.base&&this.explainCfg.key){ body.base_url=this.explainCfg.base; body.api_key=this.explainCfg.key; }
    else if((this.ocrCfg.key||'').trim()){ body.api_key=this.ocrCfg.key.trim(); } const res=await fetch('/api/visionocr',{method:'POST',headers:{'authorization':'Bearer '+this.token,'content-type':'application/json'},body:JSON.stringify(body)}); const ct=res.headers.get('content-type')||''; let d=null; if(ct.includes('json')){ try{ d=await res.json(); }catch(_){} } if(res.status===401){ this.token=''; localStorage.removeItem('zb_token'); this.view='settings'; throw new Error('unauth'); } if(res.status===404 || !ct.includes('json')){ const e=new Error('中转站 OCR 接口不可用：请确认已部署 functions/api/visionocr.js 并重新部署。'); e.fatal=true; throw e; } if(!res.ok){ const e=new Error((d&&d.error)||('中转站失败 HTTP '+res.status)); if(/未配置/.test(e.message))e.fatal=true; throw e; } const text=String((d&&d.text)||'').trim(); if(!text){ throw new Error('模型返回空内容'+((d&&d.finish)?'（finish: '+d.finish+'）':'')+'：该模型可能不支持图片输入或被内容过滤，换个真正支持看图的模型再试'); } return text; },
async pdfExtractText(){ if(!this._pdfDoc){ this.flash('请先选择 PDF',true); return; } if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      const doc=this._pdfDoc; this.ingest.pdf.busy=true; this.ingest.pdf.done=0; this.ingest.result=null;
      try{ let text='';
        for(let p=1;p<=doc.numPages;p++){ this.ingest.pdf.prog='正在提取文本，第 '+p+'/'+doc.numPages+' 页'; const page=await doc.getPage(p); const tc=await page.getTextContent(); text+=tc.items.map(it=>it.str).join(' ')+'\n'; }
        const chunks=this.chunkText(text);
        if(!chunks.length){ this.flash('未找到文本——可能是扫描版 PDF。请改用拍照辅助或手动录入',true); this.ingest.pdf.busy=false; this.ingest.pdf.prog=''; return; }
        this.ingest.pdf.extracted=text.trim(); this.ingest.raw=text.trim(); this.ingest.pdf.prog=''; this.flash('已在本地提取文本——请复制有用内容到手动录入或 JSON'); this.ingest.pdf.busy=false; return;
        let total=0;
        for(let i=0;i<chunks.length;i++){ this.ingest.pdf.prog='正在结构化第 '+(i+1)+'/'+chunks.length+' 段（已导入 '+total+'）';
          try{ const d=await this.api('/api/process',{method:'POST',body:JSON.stringify({...this.aiOv(false),subject:this.ingest.subject,chapter:this.ingest.chapter,source:this.currentSource(),raw_text:chunks[i]})}); total+=d.inserted||0; this.ingest.pdf.done=total; }
          catch(e){ if(e.message==='unauth'){ this.ingest.pdf.busy=false; return; } } }
        this.ingest.result={inserted:total,sample:[]}; this.ingest.pdf.prog=''; this.flash('PDF 文本处理完成，已导入 '+total+' 题'); this.loadMeta(true); this.statsDirty=true; this.bankDirty=true;
      }catch(e){ this.flash('Failed: '+e.message,true); }
      this.ingest.pdf.busy=false; },
async pdfByImages(){ if(!this._pdfDoc){ this.flash('请先选择 PDF',true); return; } if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      const doc=this._pdfDoc; const st=Math.max(1, parseInt(this.ingest.pdf.start||1,10)||1); const ed=Math.min(doc.numPages, parseInt(this.ingest.pdf.end||st,10)||st);
      if(ed<st){ this.flash('结束页不能小于开始页',true); return; }
      if(ed-st+1>20 && !confirm('一次将识别 '+(ed-st+1)+' 页，可能消耗较多 AI 额度。确定继续？')) return;
      this.ingest.pdf.busy=true; this.ingest.pdf.done=0; this.ingest.pdf.total=ed-st+1; this.ingest.pdf.inserted=0; this.ingest.result=null;
      try{ await this.loadConfig(); let total=0; let mats=0; const samples=[];
        for(let p=st;p<=ed;p++){ this.ingest.pdf.prog='模型：'+this.ocrModelName+' · 第 '+(p-st+1)+'/'+(ed-st+1)+' 页 · 已导入 '+total+' 题';
          const page=await doc.getPage(p); const scale=Number(this.ingest.pdf.scale)||1.7; const vp=page.getViewport({scale}); const cv=document.createElement('canvas'); cv.width=Math.floor(vp.width); cv.height=Math.floor(vp.height); await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise; const dataUrl=cv.toDataURL('image/jpeg',Number(this.ingest.pdf.quality)||0.72);
          const d=await this.api('/api/process',{method:'POST',body:JSON.stringify({...this.aiOv(true),subject:this.ingest.subject,chapter:this.ingest.chapter,source:this.sourceForPage(p),kind:this.ingest.kind,images:[dataUrl]})}); total+=(d.inserted_questions??d.inserted)||0; mats+=d.inserted_materials||0; this.ingest.pdf.inserted=total; this.ingest.pdf.done=(p-st+1); if(d.sample) samples.push(...d.sample);
        }
        this.ingest.result={inserted:total,inserted_questions:total,inserted_materials:mats,sample:samples.slice(0,8)}; this.ingest.pdf.prog=''; this.flash('AI OCR 处理完成，已导入 '+total+' 题'+(mats?('、'+mats+' 段教材'):'')); this.loadMeta(true); this.statsDirty=true; this.bankDirty=true; this.loadMaterials();
      }catch(e){ if(e.message!=='unauth')this.flash('OCR 导入失败：'+e.message,true); }
      this.ingest.pdf.busy=false; }
} };
