// 导入：手动 / 照片 / JSON / PDF / Markdown / 本地与云端 OCR
// —— 由 app.js 按功能域拆分而来；与其余 mixin 合并进同一个 Vue 实例，this.* 跨文件可用 ——
const IngestMixin = { methods: {
// —— Excel / CSV 批量导入：SheetJS 按需加载，表头自动映射，前端解析后走可信 JSON 通道入库 ——
ensureXlsx(){ return new Promise((res,rej)=>{ if(window.XLSX)return res();
      const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload=()=>window.XLSX?res():rej(new Error('XLSX 库加载异常'));
      s.onerror=()=>rej(new Error('表格解析库加载失败（需要联网）'));
      document.head.appendChild(s); }); },
async onXlsxFile(ev){ const f=ev&&ev.target&&ev.target.files&&ev.target.files[0]; if(ev&&ev.target)ev.target.value=''; if(!f)return;
      this.ingest.xl={ busy:true, name:f.name, rows:[], issues:[], done:false };
      try{
        await this.ensureXlsx();
        const buf=await f.arrayBuffer();
        const wb=XLSX.read(buf,{type:'array'});
        const ws=wb.Sheets[wb.SheetNames[0]];
        const rows=XLSX.utils.sheet_to_json(ws,{header:1,raw:false,defval:''});
        if(!rows.length)throw new Error('表格是空的');
        const head=rows[0].map(x=>String(x||'').trim());
        const col=(re)=>head.findIndex(h=>re.test(h));
        const ci={ stem:col(/题干|题目|stem/i), type:col(/题型|类型|type/i), subject:col(/科目|subject/i), chapter:col(/章节|chapter/i),
          answer:col(/答案|answer/i), analysis:col(/解析|analysis/i), difficulty:col(/难度|difficulty/i), tags:col(/标签|tags/i), passage:col(/材料|阅读|passage/i) };
        const optCols=[]; head.forEach((h,i)=>{ const m=h.match(/^选项\s*([A-H])$/i)||h.match(/^([A-H])$/)||h.match(/^option\s*([A-H])$/i); if(m)optCols.push({key:m[1].toUpperCase(),i}); });
        if(ci.stem<0)throw new Error('找不到「题干」列。表头需含：题干；可选：题型 / 答案 / 选项A…选项H / 科目 / 章节 / 解析 / 难度 / 标签 / 材料');
        const T={'单选':'single_choice','单选题':'single_choice','多选':'multiple_choice','多选题':'multiple_choice','判断':'true_false','判断题':'true_false','填空':'fill_blank','填空题':'fill_blank','简答':'short_answer','简答题':'short_answer','问答':'short_answer','问答题':'short_answer','编程':'code','编程题':'code'};
        const out=[]; const issues=[];
        for(let r=1;r<rows.length;r++){ const row=rows[r]||[]; const stem=String(row[ci.stem]||'').trim(); if(!stem)continue;
          const options=optCols.map(c=>({key:c.key,text:String(row[c.i]||'').trim()})).filter(o=>o.text);
          const rawAns=String(ci.answer>=0?(row[ci.answer]||''):'').trim();
          let type= ci.type>=0 ? (T[String(row[ci.type]||'').trim()]||String(row[ci.type]||'').trim()) : '';
          if(!type){ if(options.length)type= rawAns.replace(/[^A-Ha-h]/g,'').length>1?'multiple_choice':'single_choice';
            else if(/^(对|错|正确|错误|T|F|√|×)$/i.test(rawAns))type='true_false';
            else type= rawAns?'fill_blank':'short_answer'; }
          if(!TYPES.some(t=>t.v===type)){ issues.push('第'+(r+1)+'行：题型「'+type+'」无法识别，按简答处理'); type='short_answer'; }
          let answer=[];
          if(type==='single_choice'||type==='multiple_choice'){ answer=rawAns.toUpperCase().replace(/[^A-H]/g,'').split('').filter(Boolean); if(!answer.length)issues.push('第'+(r+1)+'行：选择题没有答案'); }
          else if(type==='true_false'){ answer=[/^(对|正确|T|√)$/i.test(rawAns)?'T':'F']; }
          else if(type==='fill_blank'){ answer=rawAns?rawAns.split(/；|;/).map(x=>x.trim()).filter(Boolean):[]; if(!answer.length)issues.push('第'+(r+1)+'行：填空题没有答案'); }
          else { answer=rawAns?[rawAns]:[]; }
          out.push({ subject: ci.subject>=0&&String(row[ci.subject]||'').trim() ? this.mapSubject(String(row[ci.subject]).trim()) : this.ingest.subject,
            chapter: ci.chapter>=0?String(row[ci.chapter]||'').trim():(this.ingest.chapter||''),
            type, stem, options, answer,
            analysis: ci.analysis>=0?String(row[ci.analysis]||'').trim():'',
            passage: ci.passage>=0?String(row[ci.passage]||'').trim():'',
            difficulty: ci.difficulty>=0?(parseInt(row[ci.difficulty],10)||3):3,
            tags: ci.tags>=0?String(row[ci.tags]||'').split(/[,，;；\s]+/).filter(Boolean):[] });
        }
        if(!out.length)throw new Error('没有解析到任何题目（题干列是空的？）');
        this.ingest.xl.rows=out; this.ingest.xl.issues=issues.slice(0,8); this.ingest.xl.busy=false;
      }catch(e){ this.ingest.xl.busy=false; this.ingest.xl.rows=[]; this.flash('表格解析失败：'+e.message,true); } },
mapSubject(name){ const low=String(name).toLowerCase();
      for(const it of (this.subjects||[])){ if(it.v===low||String(it.t||'').includes(name))return it.v; }
      const M={'政':'politics','英':'english','数':'math','计算机':'computer','高数':'math','高等数学':'math'};
      for(const k of Object.keys(M)){ if(String(name).includes(k))return M[k]; }
      return this.ingest.subject; },
async importXlsx(){ const rows=(this.ingest.xl&&this.ingest.xl.rows)||[]; if(!rows.length)return;
      if(rows.length>2000){ this.flash('单次最多导入 2000 题，请把表拆小一点',true); return; }
      this.ingest.busy=true;
      try{ const r=await this.api('/api/process',{method:'POST',body:JSON.stringify({subject:this.ingest.subject,questions:rows})});
        this.flash('已导入 '+(r.inserted_questions||r.inserted||rows.length)+' 题');
        this.ingest.xl.done=true; this.ingest.xl.rows=[]; this.ingest.xl.issues=[];
        this.bankDirty=true; this.statsDirty=true; this.loadMeta(true);
      }catch(e){ if(e.message!=='unauth')this.flash('导入失败：'+e.message,true); }
      this.ingest.busy=false; },
// 「原地更新」= 按题干形状指纹认领到了已有行（插图形态变了也算同一道题），
// 所以重导不会再产生重复行。dup_total 是库里本来就存在的历史重复，只提示不擅自删。
_dupNote(d){ const u=d&&d.updated_in_place||0; const dp=d&&d.dup_total||0;
      return (u?('，其中 '+u+' 题是更新已有行'):'')+(dp?('；另有 '+dp+' 道题在库里存在重复行（历史遗留），可去题库核对后删除'):''); },
importMsg(d){ const q=d.inserted_questions??d.inserted??0; const m=d.inserted_materials??0; const dr=d.inserted_drafts||0; const dn=(dr?('，其中 '+dr+' 题进了「题库 → 待审核」，过目后一键通过'):'')+this._dupNote(d); if(q&&m)return '识别为「题目+教材」，已导入 '+q+' 题、整理 '+m+' 段教材'+dn; if(m)return '识别为教材，已整理 '+m+' 段（去「教材阅读」查看）'; return '识别为题库，已导入 '+q+' 题'+dn; },
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
      if(type==='multiple_choice') answer=[...new Set(ansRaw.split(/[，,\s]+/).map(x=>x.trim().toUpperCase()).filter(Boolean))];
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
      if(q.type==='multiple_choice' && q.answer.length<2){ this.flash('多选题至少要 2 个答案（如 A,C）',true); return; }
      if((q.type==='single_choice'||q.type==='multiple_choice')){ const keys=q.options.map(o=>o.key); const bad=q.answer.filter(a=>!keys.includes(a)); if(bad.length){ this.flash('答案 '+bad.join('/')+' 不在选项里，请检查',true); return; } }
      this.ingest.busy=true; this.ingest.result=null;
      try{ const d=await this.api('/api/process',{method:'POST',body:JSON.stringify({subject:this.ingest.subject,chapter:this.ingest.chapter,source:this.currentSource(),questions:[q]})}); this.ingest.result=d; this.flash('已免费保存 1 题'); const n=parseInt(this.ingest.questionNo,10); this.resetManual(); if(Number.isFinite(n))this.ingest.questionNo=String(n+1); this.loadMeta(true); this.statsDirty=true; this.bankDirty=true; }
      catch(e){ if(e.message!=='unauth')this.flash(e.message,true); }
      this.ingest.busy=false;
    },
// 手动录入：选项增删（默认 A–D，可加到 H，也可删到 2 个）
addManualOption(){ const o=this.ingest.manual.options; if(o.length>=8){ this.flash('最多 8 个选项',true); return; } const key=String.fromCharCode(65+o.length); o.push({key,text:''}); },
delManualOption(i){ const o=this.ingest.manual.options; if(o.length<=2){ this.flash('至少保留 2 个选项',true); return; } o.splice(i,1); o.forEach((x,idx)=>{ x.key=String.fromCharCode(65+idx); }); },
onPhotoFile(e){ const file=e.target.files&&e.target.files[0]; if(!file)return; const rd=new FileReader(); rd.onload=()=>{ this.ingest.photoDataUrl=String(rd.result||''); this.ingest.photoUrl=this.ingest.photoDataUrl; this.flash('图片已加载，点「AI 识图填入」自动识别题目'); }; rd.onerror=()=>this.flash('图片读取失败',true); rd.readAsDataURL(file); },
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
      try{ const pg0=await doc.getPage(st); const tc0=await pg0.getTextContent(); const t0=tc0.items.map(it=>it.str).join('').replace(/\s/g,''); if(t0.length<10 && !this.ingest.local.ocr){ if(confirm('第 '+st+' 页提取不到文字，这本很可能是扫描版 PDF。\n开启「OCR 识别」后继续？\n\n确定 = 开启 OCR 并继续\n取消 = 不继续（可改用文字版 PDF，或用「AI OCR…只当教材」）')) this.ingest.local.ocr=true; else return; } }catch(_){}
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
            const eng=this.ingest.local.engine==='cfai'?'Workers AI':'中转站视觉模型';
            this.ingest.local.prog='本地 OCR 第 '+p+'/'+ed+' 页（'+eng+'，首次较慢）';
            if(this.ingest.local.engine==='cfai'){
              const effLimit=Math.min(Number(this.ingest.local.cfPageLimit)||50, this.cfocr.limit||70);
              if(this.cfocr.used>=effLimit){ const nxt=Math.min(ed,p); this.ingest.pdf.start=nxt; this.ingest.local.stop=true; this.flash('已达今日设定上限（'+effLimit+' 页，约 '+(effLimit*this.cfocr.npp)+' 神经元）。停在第 '+p+' 页，明天或调高上限再继续。',true); cv.width=cv.height=0; break; }
              this.ingest.local.prog='Workers AI 第 '+p+'/'+ed+' 页（今日 '+this.cfocr.used+'/'+effLimit+'）';
              try{ text=await this.cfocrOcrCanvas(cv); }
              catch(e){ cv.width=cv.height=0; if(e.message==='unauth')throw e; if(e.quota||e.fatal){ const nxt=Math.min(ed,p); this.ingest.pdf.start=nxt; this.ingest.local.stop=true; this.logPage(p,'err',e.message); this.flash(e.message+(e.quota?('（已停在第 '+p+' 页，明天或换引擎从这继续）'):''),true); break; } this.logPage(p,'err','Workers AI 出错：'+e.message); this.ingest.local.done=(p-st+1); this.ingest.local.lastPage=p; continue; }
            } else if(this.ingest.local.engine==='relay'){
              this.ingest.local.prog='中转站视觉 OCR 第 '+p+'/'+ed+' 页…';
              try{ text=await this.relayOcrCanvas(cv); }
              catch(e){ cv.width=cv.height=0; if(e.message==='unauth')throw e; if(e.fatal){ const nxt=Math.min(ed,p); this.ingest.pdf.start=nxt; this.ingest.local.stop=true; this.logPage(p,'err',e.message); this.flash(e.message,true); break; } this.logPage(p,'err','中转站出错：'+e.message); this.ingest.local.done=(p-st+1); this.ingest.local.lastPage=p; continue; }
            }
            usedOcr=true; scanned++;
            cv.width=cv.height=0;
          }
          this.ingest.local.done=(p-st+1); this.ingest.local.lastPage=p;
          if(!text){ this.logPage(p,'skip', usedOcr?'OCR 没识别出文字（模型可能不支持图片/空白页）':'无文字层（扫描页？可勾选 OCR）'); continue; }
          const title=this.materialBaseTitle()+' · 第 '+p+' 页';
          const md=this.mdFromText(text)+(usedOcr?('\n\n> 本页由'+(this.ingest.local.engine==='cfai'?'Workers AI':'中转站视觉模型')+'识别，可能有误差。'):'');
          const d=await this.saveOneMaterial({id:'mat-'+this.ingest.subject+'-'+this.bookHashId(this.materialBaseTitle()+'#p'+p),subject:this.ingest.subject,title,source:this.materialBaseTitle(),page:p,content_md:md,summary:'',tags:this.ingest.chapter?[this.ingest.chapter,'本地导入']:['本地导入']});
          saved+=d.inserted||1; this.ingest.local.inserted=saved; this.logPage(p,'ok','已存 '+md.length+' 字'+(usedOcr?'（'+(this.ingest.local.engine==='cfai'?'Workers AI':'中转站')+'）':'（文字层）'));
        }
        if(!this.ingest.local.stop){ this.ingest.result={kind:'material',inserted_questions:0,inserted_materials:saved,material_sample:[]}; if(saved===0){ this.flash(this.ingest.local.ocr?'未保存任何内容：本地 OCR 没识别出文字，可能是空白页或图像太糊，可调高清晰度后重试。':'未保存任何内容：这些页提取不到文字（多为扫描版）。请勾选「扫描页用本地 OCR」后重试，或用「AI OCR…只当教材」。',true); } else { this.flash('已保存 '+saved+' 段教材到 Books（未调用 AI）'+(scanned?('，其中 '+scanned+' 页用本地 OCR'):'')); } }
        this.loadMaterials();
      }catch(e){ if(e.message!=='unauth'){ const nxt=Math.min(ed,(this.ingest.local.lastPage||(st-1))+1); this.ingest.pdf.start=nxt; this.flash('本地转化中断：已保存 '+saved+' 段，开始页已设为 '+nxt+'。'+e.message,true); } this.loadMaterials(); }
      if(tess&&tess.terminate){ try{ await tess.terminate(); }catch(_){} }
      this.ingest.local.busy=false; this.ingest.local.prog='';
    },
_fullToHalf(s){ return String(s||'').replace(/[Ａ-Ｚａ-ｚ０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-65248)); },
mdToQuestions(md, ctx){ ctx=ctx||{}; const text=String(md||'').replace(/\r/g,''); const lines=text.split('\n');
      let chapter=ctx.chapter||''; const items=[]; let cur=null;
      const xiti=/(习题|练习|复习题|总习题|自测题|思考题|例题)\s*[0-9０-９]/; const zhang=/第\s*[0-9０-９一二三四五六七八九十百]+\s*[章节]/;
      const headRe=/^#{1,6}\s+(.+?)\s*#*$/; const boldRe=/^\s*\*\*(.+?)\*\*\s*$/; const numRe=/^\s*\*{0,2}\s*([0-9０-９]{1,3})\s*[.．、)）]\s*(.+)$/;
      const braRe=/^\s*\*{0,2}\s*[（(]\s*([0-9０-９]{1,3})\s*[）)]\s*(.+)$/;
      const xitiHead=/^(习\s*题|练\s*习|复习题|总习题|自测题|思考题)/;
      // 答案区标题：真题/试卷普遍在末尾有「参考答案」「答案与解析」「名家精析」段，
      // 里面每条 "N.【精析】...【考点】..." 是对前面第 N 题的解析，绝不能当成新题抽取。
      const answerHead=/^(参考答案|答案(?:与|及)?(?:解析|精析|详解)?|名家精析|试题解析|解析与答案|答案解析|参考答案(?:与|及)名家精析)\s*$/;
      const answerBody=/(?:^|[\s.．、।])(?:【\s*精\s*析\s*】|\[\s*精\s*析\s*\]|【\s*考\s*点\s*】|\[\s*考\s*点\s*\]|【\s*解\s*析\s*】)/;
      let inAnswer=false; const answerMap={};   // 题号 → {answer, analysis}
      let curAns=null; let answerMarkerStreak=0;   // 连续答案标记计数(无标题切区用)
      let inEx=false, exLabel='';
      // —— 阅读材料关联 ——
      // 英语/语文真题结构:一段短文(A/B/C 标记 或 "阅读下面短文")后跟若干题,这些题共享短文。
      // 累积「非题目、非选项、非标记」的连续文本行作为 passage;遇到新题号就把它关联进去。
      let curPassage='', passageBuf=[];
      const isProseLine=(s)=>{ const t=s.trim(); if(t.length<25)return false;
        if(numRe.test(t)||braRe.test(t))return false;
        if(/^\s*[（(]?[A-EＡ-Ｅ][）).．、]/.test(t))return false;
        if(answerBody.test(t))return false;
        const enWords=(t.match(/[A-Za-z]{2,}/g)||[]).length;
        return enWords>=6 || t.length>=40; };
      const flushPassage=()=>{ const p=passageBuf.join(' ').replace(/\s+/g,' ').trim(); if(p.length>=40)curPassage=p; passageBuf=[]; };
      const flush=()=>{ if(cur&&cur.lines.join('').trim()&&!this._isSectionLabel(cur.lines.join('\n'))){ if(curPassage&&!cur.passage)cur.passage=curPassage; items.push(cur); } cur=null; };
      const flushAns=()=>{ if(curAns&&curAns.num){ const body=curAns.lines.join('\n').trim(); if(body){ const km=body.match(/(?:答案|正确答案|应?选|故选)\s*[是为：:]?\s*([A-EＡ-Ｅ](?:\s*[,，、和]\s*[A-EＡ-Ｅ])*)/); answerMap[curAns.num]={ keys: km?this._fullToHalf(km[1]).split(/[,，、和\s]+/).filter(Boolean):[], analysis: body }; } } curAns=null; };
      for(const raw of lines){ let head=null; const h=raw.match(headRe); if(h)head=h[1]; else { const b=raw.match(boldRe); if(b)head=b[1]; }
        // 进入答案区检测(标题行)—— 标题命中最可靠,立刻切
        if(head){ const ht=head.replace(/[\s*#]/g,'').trim(); if(answerHead.test(ht)||/^(参考答案|答案与名家精析|答案及解析|参考答案与名家精析)/.test(ht)){ flush(); inAnswer=true; continue; } }
        // 无标题兜底:必须连续 2 条以上「N.【精析】」才切,防止教材里偶发一条【精析】把后面真题全吞掉
        if(!inAnswer){
          if(answerBody.test(raw) && raw.match(numRe)){ answerMarkerStreak++;
            if(answerMarkerStreak>=2){ inAnswer=true; flush();
              // 回补:把之前几条误当题目的答案标记行移出 items,转成答案条目
              while(items.length){ const last=items[items.length-1]; const lastBody=last.lines.join('\n');
                if(answerBody.test(lastBody) && last.num){ items.pop(); const km=lastBody.match(/(?:答案|正确答案|应?选|故选)\s*[是为：:]?\s*([A-EＡ-Ｅ](?:\s*[,，、和]\s*[A-EＡ-Ｅ])*)/); answerMap[last.num]={ keys: km?this._fullToHalf(km[1]).split(/[,，、和\s]+/).filter(Boolean):[], analysis: lastBody.trim() }; }
                else break;
              }
              const cm=raw.match(numRe); if(cm){ curAns={ num:cm[1], lines:[cm[2]] }; }
              continue;
            }
          }
          else if(raw.trim() && !/【|\[|考点|精析|解析|答案/.test(raw))answerMarkerStreak=0;
        }
        if(inAnswer){
          const anm=raw.match(numRe);
          if(anm){ flushAns(); curAns={ num:anm[1], lines:[anm[2]] }; }
          else if(curAns){ curAns.lines.push(raw); }
          continue;
        }
        if(head){ const t=head.replace(/\*\*/g,'').trim();
          if(xitiHead.test(t)){ inEx=true; exLabel=''; } else if(zhang.test(t)){ inEx=false; exLabel=''; }
          if(this._isChoiceLabel(t))exLabel='choice'; else if(this._isSectionLabel(t))exLabel='other';
          // 阅读段落标记(单个 A/B/C/D 或 Spain/Denmark 这类小标题)后面跟的是新短文 → 清空旧材料重新累积。
          // 关键顺序:必须先 flush(关闭并 push 当前挂起的题,让它保住当前 passage),再清空 passage,
          // 否则新标记会先把 passage 清掉,导致上一段最后一道题丢失阅读材料。
          const isReadingMarker=/^[A-EＡ-Ｅ]$/.test(t) || (t.length<=20 && !numRe.test(t) && !/题|习题|第.*[章节]|部分/.test(t));
          if(xiti.test(t)||zhang.test(t)){ flush(); chapter=t; curPassage=''; passageBuf=[]; continue; }
          if(isReadingMarker){ flush(); flushPassage(); curPassage=''; passageBuf=[]; }
          if(h){ flush(); continue; } }
        const nm=raw.match(numRe); if(nm){ flushPassage(); flush();
          if(this._isChoiceLabel(nm[2]))exLabel='choice'; else if(this._isSectionLabel(nm[2]))exLabel='other';
          cur={ num:nm[1], chapter, lines:[nm[2]], bra:false }; continue; }
        const bm=raw.match(braRe);
        // 「（1）」是独立题还是子项？
        //  · 在习题区、且当前小节是「选择题/判断题」→ 独立题（数据结构 p25/p58）
        //  · 已经在括号模式里 → 兄弟题，必须切开
        //  · 其余一律当子项留在当前题里 —— 高数「1. 根据定义证明：(1)…(2)…」「填空：(1)…(2)…」
        //    都靠这一条保持原样，不会被拆散、不会和后面的「解」失联。
        const standalone = inEx && exLabel==='choice';
        const sibling = !!(cur && cur.bra);
        if(bm && (standalone || sibling)){
          flush(); cur={ num:bm[1], chapter, lines:[bm[2]], bra:true }; continue; }
        if(cur)cur.lines.push(raw);
        else if(isProseLine(raw))passageBuf.push(raw.trim()); }   // 题目之外的散文行 → 累积为阅读材料
      flushPassage(); flush(); flushAns();
      const out=[]; let qnum=0; for(const it of items){ const q=this._buildQuestionFromItem(it, ctx); if(!q)continue;
        if(this._isRefEntry(q.stem))continue;      // 参考书目条目，不是题
        // 回填答案区解析：按题号匹配。题目自己带的编号优先，否则用顺序号
        const byNum = it.num && answerMap[it.num];
        if(byNum){ if(byNum.keys&&byNum.keys.length){ q.answer=byNum.keys; if(byNum.keys.length>1 && q.type==='single_choice')q.type='multiple_choice'; } if(byNum.analysis){ q.analysis=byNum.analysis; if(!(q.answer&&q.answer.length) && q.type==='short_answer')q.answer=[byNum.analysis]; } }
        out.push(q); } return out; },
// 「阅读文献 / 参考书目」条目会被 numRe 当成编号题吃进来。
// 政治理论那本实测 64 道里 35 道（55%）是这种条目，例如
// 「邓小平：《对起草〈…〉的意见》，《三中全会以来重要文献选编》上，中央文献出版社 2011 年版。」
// 判定要保守：必须有书名号 + 出版社/年版这类出版信息，且剥掉书名号内的文字后不含任何设问词
//（书名本身可能带问号，如《人的正确思想是从哪里来的？》，所以必须先剥再判）。
_isRefEntry(t){ const raw=String(t||''); if(raw.length>240)return false;
      if(!/《[^》]{2,}》/.test(raw))return false;
      if(!/(出版社|年版|文献选编|重要文献|文选|译文集|全集|选集)/.test(raw))return false;
      const bare=raw.replace(/《[^》]*》/g,'').replace(/〈[^〉]*〉/g,'');
      if(/[？?]/.test(bare))return false;
      if(/(是什么|如何|为什么|怎样|试述|论述|简述|谈谈|说明|阐述|分析|评价|结合|举例|比较|理解)/.test(bare))return false;
      return true; },
// 只有「选择题/判断题」这类小节的括号项才拆成独立题：它们每项自带选项、互不共享解答。
// 「填空：(1)(2)(3)」不能拆——它们共用一个「解」，拆开后 N-1 项丢答案，
// 而整段解答会全压到最后一项上，甚至把解答正文顶成题干（实测无答案率 25%→27% 且有泄漏）。
_isChoiceLabel(t){ const s=String(t||'').replace(/[\s*#]/g,'').replace(/^[（(]?[0-9０-９一二三四五六七八九十]{1,3}[）).．、]?/,'');
      return /^(单项选择|多项选择|不定项选择|选择|判断)题?[:：]?$/.test(s); },
// 「选择题」「二、填空题」这类只是分节小标题，本身不是题目
_isSectionLabel(t){ const s=String(t||'').replace(/[\s*#]/g,'').replace(/^[（(]?[0-9０-９一二三四五六七八九十]{1,3}[）).．、]?/,'');
      return /^(单项选择|多项选择|不定项选择|选择|填空|判断|简答|名词解释|计算|证明|应用|综合|分析|论述|设计|编程|阅读程序)题?[:：]?$/.test(s); },
// 同一行里的 A. / B. / C. / D. 选项拆出来。
// MinerU 常把整道选择题压成一行：「…分成（）。A. 甲 B. 乙 C. 丙 D. 丁」，
// 原来的 optRe 只认独占一行的选项，所以这类题全都退化成简答。
_splitInlineOptions(text){ const t=String(text||''); const re=/([A-DＡ-Ｄ])\s*[.．、]\s*/g; const found=[]; let m;
      while((m=re.exec(t))){ found.push({ key:this._fullToHalf(m[1]), at:m.index, end:m.index+m[0].length }); }
      // 必须是 A,B,C[,D] 严格递进且至少三个，否则正文里偶然出现的「A.」会被误判
      const want=['A','B','C','D']; const seq=[];
      for(const f of found){ if(f.key===want[seq.length])seq.push(f); }
      if(seq.length<3)return null;
      const stem=t.slice(0,seq[0].at).trim(); if(!stem)return null;
      const options=[];
      for(let i=0;i<seq.length;i++){ const e=(i+1<seq.length)?seq[i+1].at:t.length;
        const txt=t.slice(seq[i].end,e).trim(); if(!txt)return null; options.push({ key:seq[i].key, text:txt }); }
      return { stem, options }; },
// 目录页识别：这种页整页都是「章节号 标题 页码」，抽题时必须整页跳过。
// 数据结构那本的目录（第 6/7/8 页）就被当成习题吃进了 149 道垃圾。
// 注意它的目录用空格而非点线做 leader，所以不能只认点线。
_looksLikeTocPage(md){ const t=String(md||''); if(!t.trim())return false;
      if(/(^|\n)\s*#{0,6}\s*(目\s*录|contents)\s*$/im.test(t))return true;
      const lines=t.split('\n').map(x=>x.trim()).filter(x=>x&&!/^#/.test(x)&&!/^<(figure|img)/i.test(x));
      if(lines.length<8)return false;
      // 两种目录行都要认，末尾必须是页码：
      //  · tocNum：「1.2.3 标题 页码」——章节号开头，leader 可以只是空格（数据结构那本就是这样）
      //  · tocDot：「任意标题……页码」——有点线/省略号 leader 就够，不要求行首是数字（高数那本）
      const tocNum=/^[（(]?[0-9０-９]{1,2}(?:[.．][0-9０-９]{1,2}){0,3}[）)]?\s+\S.*?(?:[.．]{2,}|…+|\s)\s*[0-9０-９]{1,4}\s*$/;
      const tocDot=/^\S.*?(?:[.．]{2,}|…+)\s*[0-9０-９]{1,4}\s*$/;
      const hit=lines.filter(x=>tocNum.test(x)||tocDot.test(x)).length;
      return hit>=8 && hit/lines.length>=0.55; },
_buildQuestionFromItem(it, ctx){ const body=it.lines.join('\n').trim(); if(!body)return null;
      // 找"解/证/解答/证明/分析/答案"边界：可在行首，也可在句末标点后（MinerU 常把题目和解答放在同一段）
      const solRe=/(^|[\n。．.；;！!？?）)\]】」])\s*[>*【「\[]?\s*(解答|证明|分析|解|证|答案|答)\s*[】」\]]?\s*[：:．.、]?\s*(?=[\s$（(\\A-Za-z\u4e00-\u9fa5\d])/;
      const m=body.match(solRe); let stemPart, solPart='';
      if(m && m.index!=null){ const cut=m.index+(m[1]?m[1].length:0); const head=body.slice(0,cut).trim(); if(head){ stemPart=head; solPart=body.slice(cut).trim(); } else { stemPart=body; } }
      else { stemPart=body; }
      const optRe=/^\s*[（(]?\s*([A-DＡ-Ｄ])\s*[）).．、]\s*(.+)$/; const sl=stemPart.split('\n'); const opts=[]; const keep=[];
      for(const ln of sl){ const om=ln.match(optRe); if(om){ opts.push({ key:this._fullToHalf(om[1]), text:om[2].trim() }); } else keep.push(ln); }
      let type='short_answer', options=[], answer=[], analysis='';
      // 独占一行的选项没找到时，再试同一行内的 A./B./C./D.
      if(opts.length<2){ const inl=this._splitInlineOptions(keep.join('\n').trim()||stemPart);
        if(inl){ opts.length=0; for(const o of inl.options)opts.push(o); keep.length=0; keep.push(inl.stem); } }
      if(opts.length>=2){ type='single_choice'; options=opts; stemPart=keep.join('\n').trim();
        const am=solPart.match(/(?:答案|正确答案|答|选|应选)\s*[是为：:]?\s*([A-DＡ-Ｄ](?:\s*[,，、和]\s*[A-DＡ-Ｄ])*)/);
        if(am){ const keys=this._fullToHalf(am[1]).split(/[,，、和\s]+/).filter(Boolean); answer=keys; if(keys.length>1)type='multiple_choice'; }
        analysis=solPart; }
      else { type='short_answer'; if(solPart){ answer=[solPart]; analysis=solPart; } }
      const stem=(stemPart||'').trim(); if(!stem)return null;
      return { subject:ctx.subject||'', chapter:it.chapter||ctx.chapter||'', type, difficulty:3, source:ctx.source||'', passage:(it.passage||''), stem, options, answer, analysis, tags:it.chapter?[it.chapter]:[], page:(ctx.page!=null?ctx.page:null) }; },
async _postQuestions(arr, subject, source){ let inserted=0; const CH=80; for(let i=0;i<arr.length;i+=CH){ const d=await this.api('/api/process',{method:'POST',body:JSON.stringify({ subject, source, questions:arr.slice(i,i+CH) })}); inserted+=(d.inserted_questions??d.inserted??0); } if(inserted>0)this.bankDirty=true; return inserted; },
_openPreview(arr, title, subject, source){ const seen=new Set(); const uniq=[]; let dup=0; for(const q of arr){ const k=String(q.stem||'').replace(/\s+/g,' ').trim(); if(!k)continue; if(seen.has(k)){ dup++; continue; } seen.add(k); uniq.push(q); }
      // 分页渲染：题量大时全量渲染 rich-text(marked+KaTeX) 会卡死浏览器，只渲染当前页
      this.extractPreview={ open:true, items:uniq.map((q,i)=>Object.assign({_use:true,_k:i},q)), title, subject, source, dup, page:1, pageSize:40 }; },
extractPages(){ const p=this.extractPreview; return Math.max(1, Math.ceil(p.items.length/(p.pageSize||40))); },
extractPageItems(){ const p=this.extractPreview; const sz=p.pageSize||40; const st=(Math.min(p.page||1,this.extractPages())-1)*sz; return p.items.slice(st, st+sz); },
extractGoPage(n){ const p=this.extractPreview; p.page=Math.max(1, Math.min(this.extractPages(), parseInt(n,10)||1)); },
extractMissingCount(){ return this.extractPreview.items.filter(q=>q._use && !(q.answer&&q.answer.length)).length; },
extractUseCount(){ return this.extractPreview.items.filter(q=>q._use).length; },
extractToggleMissing(){ const hasOn=this.extractPreview.items.some(q=>q._use&&!(q.answer&&q.answer.length)); this.extractPreview.items.forEach(q=>{ if(!(q.answer&&q.answer.length))q._use=!hasOn; }); },
extractClose(){ this.extractPreview.open=false; this.extractPreview.items=[]; },
ansLines(q){ return ((q&&q.answer)||[]).join('\n'); },
// 整本按「拼接成一条流」解析，而不是逐页各自解析。
// 逐页会把跨页的题从中间切断：线上实测 101 道题的题干断在页边界上，
// 例如「证明任一最高次幂的指数为奇数的代数方程 a₀x^{2n+1}+…」，「至少有一个实根」掉在下一页；
// (1)(2)(3) 子项也会被切走。拼接后题数不变（665），无答案率 34%→25%，全书解析仅 7ms。
_extractWholeBook(book){
      const pages=book.pages||[]; const SEP='\n\n';
      // 目录页整页跳过（置空而不是删掉，这样偏移→页码的映射仍然对齐）
      let skipped=0;
      const texts=pages.map(m=>{ const t=String((m&&m.content_md)||'');
        if(this._looksLikeTocPage(t)){ skipped++; return ''; } return t; });
      this.extractSkippedToc=skipped;
      const starts=[]; let acc=0;
      for(let i=0;i<texts.length;i++){ starts.push(acc); acc+=texts[i].length+SEP.length; }
      const joined=texts.join(SEP);
      const qs=this.mdToQuestions(joined,{subject:book.subject,source:book.title,page:0});
      // 用移动游标把每道题的题干定位回原文偏移，再换算成书页页码
      const pageAt=(off)=>{ let lo=0,hi=starts.length-1,ans=0;
        while(lo<=hi){ const mid=(lo+hi)>>1; if(starts[mid]<=off){ ans=mid; lo=mid+1; } else hi=mid-1; }
        const m=pages[ans]; return m&&m.page?m.page:0; };
      let cur=0;
      for(const q of qs){
        const key=String(q.stem||'').slice(0,40);
        const at=key? joined.indexOf(key,cur) : -1;
        if(at>=0){ cur=at; q.page=pageAt(at); }
      }
      return qs; },
// 内嵌的 base64 图片转存到 R2（复用现成的 /api/qimg），题干里换成短链。
// 之前这里是直接剥成「［图］」占位来省入库体积——那是错的：
// 「对图 1-9 所示的函数 y=f(x)，下列陈述中哪些是对的」这类题，离开插图根本没法做。
// 转存同样能省体积（一条短链 ~40 字节 vs 几百 KB base64），而且图还在。
_collectDataImages(q){ const out=[];
      const scan=(t)=>{ const s=String(t||''); const re=/data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g; let m; while((m=re.exec(s)))out.push(m[0]); };
      scan(q&&q.stem); scan(q&&q.analysis);
      if(q&&Array.isArray(q.options))for(const o of q.options)scan(o&&o.text);
      if(q&&Array.isArray(q.answer))for(const a of q.answer)if(typeof a==='string')scan(a);
      return out; },
_dataUrlToBlob(u){ const m=/^data:([^;,]+);base64,([\s\S]*)$/.exec(String(u||'')); if(!m)return null;
      try{ const bin=atob(m[2].replace(/\s/g,'')); const buf=new Uint8Array(bin.length);
        for(let i=0;i<bin.length;i++)buf[i]=bin.charCodeAt(i);
        return new Blob([buf],{type:m[1]}); }catch(_){ return null; } },
// 小图留在题干里（省一次往返），大图传 R2。传不上去就保留原样——宁可胖，不可丢图。
async _hoistImages(arr){
      const INLINE_MAX=32*1024;
      const seen=new Set();
      for(const q of (arr||[]))for(const u of this._collectDataImages(q))seen.add(u);
      const stat={ total:seen.size, uploaded:0, inlined:0, failed:0 };
      if(!seen.size)return stat;
      const map=new Map(); let i=0;
      for(const u of seen){ i++;
        this.bookExtract.prog='正在转存插图 '+i+' / '+seen.size+'…';
        if(u.length<=INLINE_MAX){ stat.inlined++; continue; }
        const blob=this._dataUrlToBlob(u);
        if(!blob){ stat.failed++; continue; }
        try{
          const ext=(blob.type.split('/')[1]||'png').replace('jpeg','jpg');
          const fd=new FormData(); fd.append('file', blob, 'fig.'+ext);
          const res=await fetch('/api/qimg',{method:'POST',headers:{authorization:'Bearer '+this.token},body:fd});
          const d=await res.json().catch(()=>({}));
          if(!res.ok||!d.url)throw new Error(d.error||('HTTP '+res.status));
          map.set(u,d.url); stat.uploaded++;
        }catch(_){ stat.failed++; }        // 保留内嵌，图不能丢
      }
      if(map.size){
        const swap=(t)=>{ let s=String(t||''); for(const [k,v] of map)s=s.split(k).join(v); return s; };
        for(const q of arr){ q.stem=swap(q.stem); if(q.analysis)q.analysis=swap(q.analysis);
          if(Array.isArray(q.options))q.options=q.options.map(o=>Object.assign({},o,{text:swap(o.text)}));
          if(Array.isArray(q.answer))q.answer=q.answer.map(a=>typeof a==='string'?swap(a):a); }
      }
      return stat; },
// 让浏览器有机会把 spinner 画出来再进同步解析。
// 只 await 一个微任务不够——渲染发生在下一帧，所以要等两个 rAF。
// （v174 我用「切片替换」改这一段时，把这个定义连带删掉了，调用点还留着 4 处，
//   结果两个抽题按钮一点就抛 TypeError、被 finally 吞掉，表现为「点击没反应」。）
// 必须带超时兜底：后台/不可见标签页里 requestAnimationFrame 根本不触发，
// 只靠 rAF 会让这个 Promise 永远不 resolve —— bookExtract.busy 卡在 true，
// 两个抽题按钮永久置灰，防重入守卫又让后续点击全部 return，只能刷新才能恢复。
_yieldToPaint(){ return new Promise(r=>{ let done=false;
      const fin=()=>{ if(done)return; done=true; r(); };
      setTimeout(fin, 60);
      try{ requestAnimationFrame(()=>requestAnimationFrame(fin)); }catch(_){ fin(); } }); },
async localExtractPage(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      if(this.bookExtract.busy)return;                            // 防重入：慢的时候用户会连点
      this.bookExtract.busy=true; this.bookExtract.prog='正在准备正文…';
      try{
        await this._yieldToPaint();
        if(this.ensureBookContent)await this.ensureBookContent();  // 书架只带元信息，抽题前先确保本书正文已载入
        const m=this.currentPageMat; if(!m){ this.flash('请先选择一页',true); return; }
        if(this._looksLikeTocPage(m.content_md)){ this.flash('这一页是书本目录，不是习题页（目录行会被误判成题目，已跳过）',true); return; }
        this.bookExtract.prog='正在解析本页…'; await this._yieldToPaint();
        const src=this.currentBook?this.currentBook.title:(m.source||''); const arr=this.mdToQuestions(m.content_md,{subject:m.subject,source:src,page:m.page});
        if(!arr.length){ this.flash('这一页没解析出题目（可能不是习题页，或编号格式特殊，可改用 AI 抽取）',true); return; }
        const ist=await this._hoistImages(arr);
        if(ist.failed)this.flash(ist.failed+' 张插图没能转存到 R2（已保留内嵌，可能偏大）',true);
        this._openPreview(arr, (m.title||'本页')+'（预览）', m.subject, src);
      // 必须有 catch：只有 try/finally 的话异常会变成 unhandled rejection，
      // busy 复位了、界面却一个字都不说 —— 用户看到的就是「点了没反应」。
      } catch(e){ if(e.message!=='unauth')this.flash('本页抽题失败：'+e.message,true); }
      finally { this.bookExtract.busy=false; this.bookExtract.prog=''; } },
async localExtractBook(){ if(!this.token){ this.flash('请先在设置中填写访问码',true); return; }
      if(this.bookExtract.busy)return;                            // 防重入
      this.bookExtract.busy=true;
      try{ return await this._localExtractBookInner(); }
      catch(e){ if(e.message!=='unauth')this.flash('整本抽题失败：'+e.message,true); }
      finally { this.bookExtract.busy=false; this.bookExtract.prog=''; } },
async _localExtractBookInner(){
      const b0=this.currentBook;
      const need=this.matMissingCount?this.matMissingCount(b0):0;
      this.bookExtract.prog=need? ('正在载入正文 '+need+' 页…') : '正在准备…';
      await this._yieldToPaint();
      if(this.ensureBookContent)await this.ensureBookContent();   // 同上：整本抽题依赖每页 content_md
      const b=this.currentBook; if(!b||!b.pages.length){ this.flash('请先选择一本书',true); return; }
      // 兜底自检：正文没补齐就别开跑，宁可报错也别拿半本书静默少抽
      const missing=this.matMissingCount?this.matMissingCount(b):0;
      if(missing){ this.flash('这本书还有 '+missing+' 页正文没载入完，请等进度条走完再抽题',true); return; }
      this.bookExtract.prog='正在解析全书 '+b.pages.length+' 页…'; await this._yieldToPaint();
      const all=this._extractWholeBook(b);
      if(!all.length){ this.flash('整本书没解析出题目（可能这本不是习题集）',true); return; }
      // 题量大时先给预期：规则抽取在扫描/OCR 文本上会把页眉、目录行误判成题目
      const noAns=all.filter(q=>!(q.answer&&q.answer.length)).length;
      if(all.length>800 && !confirm('整本解析出 '+all.length+' 题，其中 '+noAns+' 题没抽到答案。\n\n题量较大，规则抽取可能把页眉/目录行误判成题目，建议在预览里筛一遍再导入（可用「勾选/取消无答案的题」快速排除）。\n\n继续打开预览？'))return;
      const ist=await this._hoistImages(all);
      if(ist.failed)this.flash(ist.failed+' 张插图没能转存到 R2（已保留内嵌，可能偏大）',true);
      const tocNote=this.extractSkippedToc? '（已跳过 '+this.extractSkippedToc+' 页目录）':'';
      this._openPreview(all, '《'+b.title+'》整本'+tocNote+'（预览）', b.subject, b.title); },
async extractDoImport(){ const p=this.extractPreview; const arr=p.items.filter(q=>q._use).map(q=>{ const c=Object.assign({},q); delete c._use; return c; }); if(!arr.length){ this.flash('没有勾选要导入的题',true); return; }
      this.bookExtract.busy=true; this.bookExtract.done=0; this.bookExtract.total=arr.length;
      try{ let inserted=0, updated=0, dup=0; const CH=80; for(let i=0;i<arr.length;i+=CH){ this.bookExtract.prog='正在导入 '+Math.min(i+CH,arr.length)+' / '+arr.length; const d=await this.api('/api/process',{method:'POST',body:JSON.stringify({ subject:p.subject, source:p.source, questions:arr.slice(i,i+CH) })}); inserted+=(d.inserted_questions??d.inserted??0); updated+=(d.updated_in_place||0); dup+=(d.dup_total||0); this.bookExtract.done=Math.min(i+CH,arr.length); }
        this.flash('已导入 '+inserted+' 道题到题库（未用 AI）'+this._dupNote({updated_in_place:updated,dup_total:dup}), dup>0); this.loadMeta(true); this.statsDirty=true; this.bankDirty=true; this.extractClose(); }
      catch(e){ if(e.message!=='unauth')this.flash('导入失败：'+e.message,true); } this.bookExtract.busy=false; this.bookExtract.prog=''; },
saveOcrCfg(){ try{ localStorage.setItem('zb_ocrcfg', JSON.stringify(this.ocrCfg)); }catch(_){} },
logPage(p,t,msg){ const arr=this.ingest.local.log; arr.push({p,t,msg}); if(arr.length>500)arr.splice(0,arr.length-500); },
async importMarkdownAsBook(md, book, subj, tag, off){ off=off||0; const parts=this.chunkMarkdownByStructure(md); if(!parts.length){ return 0; } const items=[]; for(let i=0;i<parts.length;i++){ const h=this.firstHeadingOf(parts[i]); const gp=off+i+1; const title=book+' · '+(h||('第 '+gp+' 段')); items.push({id:'mat-'+subj+'-'+this.bookHashId(book+'#p'+gp),subject:subj,title,source:book,page:gp,content_md:parts[i],summary:'',tags:tag?[tag]:[]}); } let n=0; const CH=30; for(let i=0;i<items.length;i+=CH){ const part=items.slice(i,i+CH); this.ingest.mineru.prog='导入 '+Math.min(i+CH,items.length)+'/'+items.length+' 段…'; const d=await this.api('/api/materials',{method:'POST',body:JSON.stringify({items:part})}); n+=(d.inserted||part.length); } return n; },
stripFurniturePages(pages){ if(!pages||pages.length<4)return (pages||[]).map(p=>({page:p.page, md:p.md.split('\n').filter(l=>!/^\s*\d{1,4}\s*$/.test(l.trim())).join('\n').replace(/\n{3,}/g,'\n\n').trim()})).filter(p=>p.md); const freq={}; const N=pages.length; pages.forEach(p=>{ const seen=new Set(); p.md.split('\n').forEach(l=>{ const t=l.trim(); if(t&&t.length<=24&&!/^#{1,6}\s/.test(t)&&!/^(figure|<)/i.test(t)){ if(!seen.has(t)){ seen.add(t); freq[t]=(freq[t]||0)+1; } } }); }); const thr=Math.max(3, Math.ceil(N*0.3)); const furniture=new Set(Object.keys(freq).filter(k=>freq[k]>=thr)); return pages.map(p=>{ const lines=p.md.split('\n').filter(l=>{ const t=l.trim(); if(!t)return true; if(/^\s*\d{1,4}\s*$/.test(t))return false; if(furniture.has(t))return false; return true; }); return {page:p.page, md:lines.join('\n').replace(/\n{3,}/g,'\n\n').trim()}; }).filter(p=>p.md); },
async importPagesAsBook(pages, book, subj, tag, off){ off=off||0; pages=this.stripFurniturePages(pages); const items=[]; for(let i=0;i<pages.length;i++){ const p=pages[i]; const gp=off+(p.page||i+1); const h=this.firstHeadingOf(p.md); const title=book+' · '+(h||('第 '+gp+' 页')); items.push({id:'mat-'+subj+'-'+this.bookHashId(book+'#p'+gp),subject:subj,title,source:book,page:gp,content_md:p.md,summary:'',tags:tag?[tag]:[]}); }
  // 按体积+条数双限自适应分批：累积到 ~3MB 或 30 条就发一批，避免带图页请求体过大（撞 Worker 限制/超时）
  let n=0, done=0; const MAXB=3*1048576, MAXN=30; let buf=[], bufBytes=0;
  const flush=async()=>{ if(!buf.length)return; done+=buf.length; this.ingest.mineru.prog='导入 '+done+'/'+items.length+' 页…'; const d=await this.api('/api/materials',{method:'POST',body:JSON.stringify({items:buf})}); n+=(d.inserted||buf.length); buf=[]; bufBytes=0; };
  for(const it of items){ const sz=(it.content_md||'').length; if(buf.length && (bufBytes+sz>MAXB || buf.length>=MAXN))await flush(); buf.push(it); bufBytes+=sz; }
  await flush();
  return n; },
async relayOcrCanvas(cv){ const dataUrl=cv.toDataURL('image/jpeg',0.9); const body={image_b64:dataUrl}; if((this.ocrCfg.model||'').trim())body.model=this.ocrCfg.model.trim();
    if((this.ocrCfg.base||'').trim()){ body.base_url=this.ocrCfg.base.trim(); if((this.ocrCfg.key||'').trim())body.api_key=this.ocrCfg.key.trim(); }
    else if(this.explainCfg&&this.explainCfg.base&&this.explainCfg.key){ body.base_url=this.explainCfg.base; body.api_key=this.explainCfg.key; }
    else if((this.ocrCfg.key||'').trim()){ body.api_key=this.ocrCfg.key.trim(); } const res=await fetch('/api/visionocr',{method:'POST',headers:{'authorization':'Bearer '+this.token,'content-type':'application/json'},body:JSON.stringify(body)}); const ct=res.headers.get('content-type')||''; let d=null; if(ct.includes('json')){ try{ d=await res.json(); }catch(_){} } if(res.status===401){ this.token=''; localStorage.removeItem('zb_token'); this.view='settings'; throw new Error('unauth'); } if(res.status===404 || !ct.includes('json')){ const e=new Error('中转站 OCR 接口不可用：请确认已部署 functions/api/visionocr.js 并重新部署。'); e.fatal=true; throw e; } if(!res.ok){ const e=new Error((d&&d.error)||('中转站失败 HTTP '+res.status)); if(/未配置/.test(e.message))e.fatal=true; throw e; } const text=String((d&&d.text)||'').trim(); if(!text){ throw new Error('模型返回空内容'+((d&&d.finish)?'（finish: '+d.finish+'）':'')+'：该模型可能不支持图片输入或被内容过滤，换个真正支持看图的模型再试'); } return text; },
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
