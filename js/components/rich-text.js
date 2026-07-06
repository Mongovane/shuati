const RichText={
  props:['content'],
  template:`<div class="rich" v-html="html"></div>`,
  computed:{ html(){ if(!this.content)return''; const raw=String(this.content);
    try{
      const math=[]; let src=raw;
      // AI/教材常用 \[...\] 与 \(...\) 作为公式定界符，但 marked 会把 \[ \, 等当转义符吃掉，
      // 导致公式以裸文本漏出（如 "\int \frac{x^4}{25+4x^2},dx"）。先归一化成 KaTeX 认的 $ / $$：
      src=src.replace(/\\\[([\s\S]+?)\\\]/g,(m,t)=>'\n$$ '+t.replace(/\s*\n\s*/g,' ').trim()+' $$\n').replace(/\\\(([\s\S]+?)\\\)/g,(m,t)=>'$'+t.replace(/\s*\n\s*/g,' ').trim()+'$');
      // 粗体加固：模型可能写出紧贴中文标点/序号的 **……**，个别 marked 版本按侧翼规则拒绝配对导致 ** 漏出。
      // 在数学占位之后、marked 之前做确定性转换；跳过 ``` 围栏与 `行内代码`（避免破坏 C 代码里的 **p）。
      { const L=src.split('\n'); let fence=false;
        for(let i=0;i<L.length;i++){ const line=L[i];
          if(/^\s*(```|~~~)/.test(line)){ fence=!fence; continue; }
          if(fence || line.indexOf('**')<0) continue;
          const seg=line.split(/(`[^`]*`)/);
          for(let j=0;j<seg.length;j++){ if(j%2===0) seg[j]=seg[j].replace(/\*\*([^*\n]+?)\*\*/g,'<strong>$1</strong>'); }
          L[i]=seg.join('');
        }
        src=L.join('\n'); }
      // MinerU 有时把公式当普通文本输出（没有 $ 包裹）→ 把连续的“裸 LaTeX 行”自动包成 $$…$$
      { const L=src.split('\n'); const o=[]; let run=[];
        const isTex=(l)=>{ const t=l.trim(); if(!t)return false; if(/\$/.test(t))return false; const tc=t.replace(/\\text\s*\{[^}]*\}/g,''); if(/[\u4e00-\u9fa5]/.test(tc))return false; if(/^[#>|]/.test(t)||/^!\[/.test(t)||/^<\w/.test(t)||/^\uE000/.test(t))return false; return /\\[a-zA-Z]{2,}|[\^_]\s*\{|\\frac|\\sqrt|\\begin|\\mid|\\left|\\right|\\overrightarrow|\\boldsymbol|\\quad|\\times|\\cdot/.test(t); };
        const flush=()=>{ if(run.length){ o.push('$$ '+run.join(' \\\\ ')+' $$'); run=[]; } };
        for(const l of L){ if(isTex(l))run.push(l.trim()); else { flush(); o.push(l); } } flush(); src=o.join('\n'); }
      // 先抽出公式（占用私有区字符占位），避免 marked 把多行 $$…$$ 拆散或转义反斜杠
      src=src.replace(/\$\$([\s\S]+?)\$\$/g,(m,x)=>{ math.push({tex:x,display:true}); return '\uE000'+(math.length-1)+'\uE001'; });
      src=src.replace(/\\\[([\s\S]+?)\\\]/g,(m,x)=>{ math.push({tex:x,display:true}); return '\uE000'+(math.length-1)+'\uE001'; });
      src=src.replace(/\$([^\$\n]+?)\$/g,(m,x)=>{ math.push({tex:x,display:false}); return '\uE000'+(math.length-1)+'\uE001'; });
      src=src.replace(/\\\(([^\n]+?)\\\)/g,(m,x)=>{ math.push({tex:x,display:false}); return '\uE000'+(math.length-1)+'\uE001'; });
      // 去页码/页眉残留：整段只是页码、或常见页眉/页脚装饰的，删掉
      src=src.split(/\n{2,}/).filter(b=>{ const t=b.trim(); if(!t)return false; if(/^[\s·•\.\-—–=*_>]*\d{1,4}[\s·•\.\-—–=*_>]*$/.test(t))return false; if(/^[-—–=_·•\s]{2,}$/.test(t))return false; return true; }).join('\n\n');
      // 题号钉最左 + 悬挂缩进（保留原始编号，不交给 marked 重新编号）
      src=src.replace(/^[ \t>]{0,4}(\d{1,3})[.．、][ \t]+(.+)$/gm,(m,n,rest)=>'<div class="prob"><span class="pn">'+n+'.</span>'+rest+'</div>');
      // 形如「图8-1 / 表 8-2」的独立文本，渲成居中图注
      src=src.replace(/^[ \t]*((?:图|表)\s?\d+(?:[-－.]\d+)*)\s*$/gm,(m,c)=>'<p class="figcap">'+c+'</p>');
      let out=marked.parse(src);
      // XSS 防线：题目/教材可能来自网上的第三方 JSON，先消毒 marked 产物；
      // KaTeX 的占位符是私有区字符，能安全穿过消毒；KaTeX 本身输出为转义后的安全 HTML，在消毒后注入。
      if(window.DOMPurify) out=DOMPurify.sanitize(out,{USE_PROFILES:{html:true}});
      out=out.replace(/\uE000(\d+)\uE001/g,(m,i)=>{ const it=math[+i]; if(!it)return ''; if(window.katex){ try{ return window.katex.renderToString(it.tex,{displayMode:it.display,throwOnError:false,strict:false}); }catch(e){ return '<code>'+it.tex.replace(/</g,'&lt;')+'</code>'; } } return (it.display?'$$':'$')+it.tex+(it.display?'$$':'$'); });
      return out;
    }catch(e){ try{ const fb=marked.parse(raw); return window.DOMPurify?DOMPurify.sanitize(fb,{USE_PROFILES:{html:true}}):fb; }catch(_){return raw;} }
  } },
  mounted(){ this.enhance(); },
  updated(){ this.enhance(); },
  methods:{ enhance(){ const el=this.$el;
    if(window.katex&&!window.katex.renderToString){} // 已在 html 内预渲染；此处仅兜底
    if(!window.katex&&window.renderMathInElement){ try{ renderMathInElement(el,{delimiters:[{left:'$$',right:'$$',display:true},{left:'$',right:'$',display:false},{left:'\\(',right:'\\)',display:false},{left:'\\[',right:'\\]',display:true}],throwOnError:false,strict:false}); }catch(e){} }
    if(window.hljs){ el.querySelectorAll('pre code').forEach(b=>{ try{hljs.highlightElement(b);}catch(e){} }); }
    this.fitMath();
  },
  fitMath(){ const el=this.$el; if(!el)return; const FLOOR=0.5; const fit=(k,avail)=>{ k.style.fontSize=''; const w=k.scrollWidth||k.offsetWidth; if(!w||avail<=0||w<=avail+1)return null; let s=avail/w, scroll=false; if(s<FLOOR){ s=FLOOR; scroll=true; } const cur=parseFloat(getComputedStyle(k).fontSize)||16; k.style.fontSize=(cur*s)+'px'; return {scroll}; };
    const run=()=>{ el.querySelectorAll('.katex-display').forEach(d=>{ const k=d.querySelector('.katex'); if(!k)return; d.style.overflowX='hidden'; const r=fit(k, d.clientWidth||el.clientWidth); d.style.overflowX=(r&&r.scroll)?'auto':'hidden'; });
      el.querySelectorAll('.katex').forEach(k=>{ if(k.closest('.katex-display'))return; let wrap=k.closest('.mathwrap'); if(!wrap){ const parent=k.parentElement; if(!parent)return; const avail=parent.clientWidth||el.clientWidth; k.style.fontSize=''; const w=k.scrollWidth||k.offsetWidth; if(!w||w<=avail+1)return; wrap=document.createElement('span'); wrap.className='mathwrap'; parent.insertBefore(wrap,k); wrap.appendChild(k); } const r=fit(k, wrap.clientWidth||el.clientWidth); wrap.style.overflowX=(r&&r.scroll)?'auto':'hidden'; }); };
    run(); requestAnimationFrame(run); setTimeout(run,150); setTimeout(run,500); setTimeout(run,1200); if(document.fonts&&document.fonts.ready){ document.fonts.ready.then(run).catch(()=>{}); } } }
};

