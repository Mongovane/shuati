// 主应用模板（从 app.js 拆出，便于检索与修改视图结构）
const APP_TEMPLATE = `
  <div class="topbar"><div class="topbar-in">
    <div class="brand"><span class="dot"></span>{{ appName }}</div>
    <div class="spacer"></div>
    <button class="icon-btn" @click="stealthHide" title="快速隐藏（按 &#96; 切换）"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.4 5.2A9 9 0 0 1 21 12a9.4 9.4 0 0 1-1.3 1.9"/><path d="M6.1 6.1A9.4 9.4 0 0 0 3 12a9 9 0 0 0 11 6.6"/></svg></button>
    <button class="icon-btn" @click="theme=theme==='light'?'dark':'light'" :title="theme==='light'?'深色模式':'浅色模式'">{{ theme==='light'?'☾':'☀' }}</button>
  </div>
  <div class="tabs">
    <button class="tab" :class="{active:view==='practice'}" @click="go('practice')">Home</button>
    <button class="tab" :class="{active:view==='books'}" @click=\"go('books')\">Books</button>
    <button class="tab" :class="{active:view==='wrong'}" @click="go('wrong')">Review<span v-if="wrongTotal" class="badge">{{ wrongTotal }}</span></button>
    <button class="tab" :class="{active:view==='favorite'}" @click="go('favorite')">Saved</button>
    <button class="tab" :class="{active:view==='mock'}" @click=\"go('mock')\">Test</button>
    <button class="tab" :class="{active:view==='stats'}" @click="go('stats')">Reports</button>
    <button class="tab" :class="{active:view==='bank'}" @click="go('bank')">Bank</button>
    <button class="tab" :class="{active:view==='ingest'}" @click=\"go('ingest')\">Import</button>
    <button class="tab" :class="{active:view==='settings'}" @click=\"go('settings')\">Settings <span class="muted" style="font-size:10px">v36</span></button>
  </div></div>

  <div v-if="offline" class="offline-bar">离线模式 · 显示已缓存内容，作答将在联网后自动同步<span v-if="offlineQueued>0">（待同步 {{ offlineQueued }} 条）</span></div>

  <div class="wrap">

    <div v-if="['practice','wrong','favorite'].includes(view)">
      <div class="toolbar">
        <div class="field"><label>科目</label>
          <select v-model="f.subject" @change="onFilter">
            <option value="all">全部科目</option>
            <option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option>
          </select></div>
        <div class="field"><label>章节</label>
          <select v-model="f.chapter" @change="onFilter">
            <option value="">全部章节</option>
            <option v-for="c in chaptersForSubject" :key="c.subject+'|'+c.chapter" :value="c.chapter">{{ c.chapter }} ({{ c.n }})</option>
          </select></div>
        <div class="field"><label>题型</label>
          <select v-model="f.type" @change="onFilter">
            <option value="">全部题型</option>
            <option v-for="t in types" :key="t.v" :value="t.v">{{ t.t }}</option>
          </select></div>
        <div class="field" v-if="view==='practice'"><label>范围</label>
          <select v-model="f._mode" @change="onFilter">
            <option value="all">全部题目</option>
            <option value="unseen">仅未做</option>
            <option value="due">今日待复习</option>
            <option value="wrong">仅错题</option>
            <option value="favorite">仅收藏</option>
          </select></div>
        <div class="field"><label>顺序</label>
          <select v-model="f.order" @change="onFilter">
            <option value="random">随机</option>
            <option value="seq">顺序</option>
          </select></div>
        <button class="btn subtle" @click="startSession" style="margin-left:auto">↻ 刷新</button>
      </div>

      <div v-if="loading" class="empty"><span class="spin"></span> 加载中…</div>
      <template v-else>
        <div v-if="cur">
          <div class="row" style="margin-bottom:12px;align-items:center;gap:10px"><span class="q-counter">第 {{ qi+1 }} / {{ queue.length }} 题</span>
            <span class="muted" v-if="view==='wrong'">· 复习（最不熟优先）</span>
            <span class="muted" v-if="view==='wrong' && queueTotal">· 待复习 {{ queueTotal }} 题</span>
            <span class="muted" v-if="view==='favorite'">· 收藏</span>
            <span v-if="curStatus" class="q-badge" :style="{color:curStatus.c,borderColor:curStatus.c}">{{ curStatus.t }}</span>
            <span v-if="view==='practice' && queueTotal" class="muted">· {{ f._mode==='unseen'?'未做剩 '+queueTotal:'本范围共 '+queueTotal }} 题</span>
            <span v-if="streak>=2" style="color:var(--accent);font-weight:600;font-size:13px">🔥 连对 {{ streak }}</span>
            <select class="bk-mini" style="margin-left:auto" :value="cur.subject" @change="setQuestionSubject($event.target.value)" title="改本题科目（纠正分类）"><option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option></select>
            <button class="bk-del" @click="deleteCurrentQuestion" title="从题库删除本题">删除本题</button>
          </div>
          <question-card :q="cur" :key="cur.id" :can-ai="(ai.hasAI || !!(explainCfg.base && explainCfg.key)) && !offline" :ai-text="curAiText" :ai-busy="aiX.busy && aiX.id===cur.id" :ai-chat="curAiChat" :ai-asking="aiX.asking && aiX.id===cur.id" :ai-model="curAiModel" @answered="onAnswered" @favorite="onFav" @master="onMaster" @note="onNote" @next="next" @ai-explain="aiExplain" @ai-save="aiSaveToAnalysis" @ai-ask="aiAsk" @ai-note="aiNoteFromChat" @ai-retry="aiRetryAsk" />
          <div class="q-nav-bar">
            <button class="btn subtle" :disabled="qi<=0" @click="prev">← 上一题</button>
            <button class="btn" @click="next">{{ qi>=queue.length-1 ? '换一批 ↻' : '下一题 →' }}</button>
          </div>
          <div v-if="queue.length>1" class="qnav-wrap">
            <button class="qnav-toggle" @click="qnavOpen=!qnavOpen">
              <span>答题卡 · 已答 {{ sessionDone }}/{{ queue.length }}</span>
              <span class="qnav-legend" v-if="qnavOpen"><i class="ok"></i>对<i class="bad"></i>错/待复习<i class="done"></i>做过<i class="un"></i>未做</span>
              <span class="qnav-caret">{{ qnavOpen?'收起 ▴':'展开 ▾' }}</span>
            </button>
            <div v-if="qnavOpen" class="qnav">
              <button v-for="(q,i) in queue" :key="q.id" class="qnav-dot" :class="qnavCls(q,i)" @click="qi=i" :title="'第'+(i+1)+'题'">{{ i+1 }}</button>
            </div>
          </div>
        </div>
        <div v-else class="empty">
          <template v-if="view==='practice' && f._mode==='unseen'">
            <div class="big">🎉</div>
            <p>太棒了！{{ f.subject==='all'?'全部':subjName(f.subject) }}{{ f.chapter?('· '+f.chapter):'' }} 的题都做过一遍了。</p>
            <svg v-if="stats" class="acc-ring" viewBox="0 0 120 120" width="132" height="132">
              <circle cx="60" cy="60" r="52" fill="none" stroke="var(--surface-2)" stroke-width="12"/>
              <circle cx="60" cy="60" r="52" fill="none" :stroke="accPct>=60?'var(--ok)':'var(--bad)'" stroke-width="12" stroke-linecap="round" :stroke-dasharray="ringDash" transform="rotate(-90 60 60)"/>
              <text x="60" y="56" text-anchor="middle" font-size="27" font-weight="700" fill="var(--ink)">{{ accPct }}%</text>
              <text x="60" y="77" text-anchor="middle" font-size="12" fill="var(--ink-soft)">正确率</text>
            </svg>
            <p class="muted" v-if="stats">已作答 {{ statTotals.seen }} / {{ statTotals.totalQ }} · 待复习 {{ statTotals.wrongOpen }} · 已掌握 {{ statTotals.mastered }}</p>
            <p class="muted">本次用时 {{ sessionElapsed }} · 最高连对 {{ bestStreak }}</p>
            <div class="row" style="justify-content:center;margin-top:16px;gap:8px;flex-wrap:wrap">
              <button class="btn" v-if="statTotals.wrongOpen" @click="go('wrong')">复习错题（{{ statTotals.wrongOpen }}）</button>
              <button class="btn subtle" @click="f._mode='all'; startSession()">重做全部</button>
              <button class="btn subtle" @click="go('stats')">查看统计</button>
            </div>
          </template>
          <template v-else-if="view==='wrong'">
            <div class="big">✓</div><p>暂无错题，做得不错。</p>
            <div class="row" style="justify-content:center;margin-top:14px"><button class="btn" @click="go('practice')">去刷题</button></div>
          </template>
          <template v-else-if="view==='favorite'">
            <div class="big">☆</div><p>暂无收藏题。刷题时点题目上的 ★ 可收藏。</p>
            <div class="row" style="justify-content:center;margin-top:14px"><button class="btn" @click="go('practice')">去刷题</button></div>
          </template>
          <template v-else-if="f._mode==='due'">
            <div class="big">🌱</div><p>今天没有到期要复习的题，休息一下或去刷新题。</p>
            <div class="row" style="justify-content:center;margin-top:14px"><button class="btn subtle" @click="f._mode='all'; startSession()">刷新题</button></div>
          </template>
          <template v-else-if="f._mode==='mastered'">
            <div class="big">∅</div><p>还没有标记为「已掌握」的题。</p>
            <div class="row" style="justify-content:center;margin-top:14px"><button class="btn subtle" @click="f._mode='all'; startSession()">看全部题</button></div>
          </template>
          <template v-else>
            <div class="big">∅</div><p>没有匹配的题目。请调整筛选条件，或先导入题目。</p>
            <div class="row" style="justify-content:center;margin-top:14px">
              <button class="btn subtle" @click="startSession">重新加载</button>
              <button class="btn" @click=\"go('ingest')\">前往导入</button>
            </div>
          </template>
        </div>
      </template>
    </div>


    <div v-else-if="view==='books'">
      <h2 style="margin:.2em 0 .5em">教材阅读</h2>
      <div class="seg" style="margin-bottom:16px">
        <button :class="{on:booksMode==='notes'}" @click="booksMode='notes'">整理笔记</button>
        <button :class="{on:booksMode==='pdf'}" @click="booksMode='pdf'">PDF 原书</button>
      </div>
      <div v-show="booksMode==='pdf'">
        <p class="muted" style="margin-bottom:14px">选一个 PDF 在浏览器里直接渲染原版页面（公式/图表/排版原样，不转换）。「本地打开」仅本次有效；「上传到云端」会存到 R2，之后任何设备都能打开。</p>
        <div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:14px">
          <label class="btn subtle" style="cursor:pointer">本地打开（仅本次）<input type="file" accept="application/pdf,.pdf" @change="pdfvOpenLocal" style="display:none" /></label>
          <label class="btn" style="cursor:pointer"><span v-if="pdfShelf.uploading" class="spin"></span>上传 PDF 到云端<input type="file" accept="application/pdf,.pdf" :disabled="pdfShelf.uploading" @change="uploadPdf" style="display:none" /></label>
          <span v-if="pdfv.loading" class="muted"><span class="spin"></span> {{ pdfv.msg || '正在打开 PDF…' }}</span>
          <span v-else-if="pdfShelf.loading" class="muted"><span class="spin"></span> 正在加载 PDF 列表…</span>
        </div>
        <div v-if="pdfShelf.uploading" style="margin:0 0 14px;max-width:520px">
          <div class="muted" style="font-size:13px;margin-bottom:6px">{{ pdfShelf.prog }} <span v-if="pdfShelf.pct">· {{ pdfShelf.pct }}%</span></div>
          <div style="height:9px;background:var(--surface-2);border-radius:99px;overflow:hidden;border:1px solid var(--line)"><div :style="{width:pdfShelf.pct+'%',height:'100%',background:'var(--accent)',transition:'width .2s'}"></div></div>
        </div>
        <div v-if="pdfShelf.note" class="hint" style="border:1px solid color-mix(in srgb,#c0392b 35%,var(--line));background:color-mix(in srgb,#c0392b 6%,var(--surface));margin-bottom:14px">{{ pdfShelf.note }}</div>
        <template v-if="pdfShelf.items.length">
          <template v-for="(list,sub) in pdfShelfBySubject()" :key="sub">
            <div v-if="list.length" class="bk-shelf">
              <div class="bk-shelf-label fold-head" @click="bookFold['pdf_'+sub]=!bookFold['pdf_'+sub]"><span>{{ subjName(sub)==='other'? '其他' : subjName(sub) }} <span class="muted" style="font-weight:400;font-size:12px">{{ list.length }} 本</span></span><span class="fold-arrow" :class="{open:!bookFold['pdf_'+sub]}">▾</span></div>
              <div v-show="!bookFold['pdf_'+sub]" class="bk-grid">
                <div v-for="it in list" :key="it.id" class="bk-card" @click="openShelfPdf(it)">
                  <span class="spine"></span>
                  <span class="t">{{ it.title }}</span>
                  <span class="m">{{ (it.size/1048576).toFixed(1) }} MB · 云端 · <a href="#" style="color:#c0392b" @click.stop.prevent="deleteShelfPdf(it)">删除</a></span>
                </div>
              </div>
            </div>
          </template>
        </template>
        <div v-if="pdfv.open" class="pdfv" style="margin-top:14px">
          <div class="pdfv-bar">
            <div class="ttl">{{ pdfv.title }}</div>
            <div class="bk-nav">
              <button :disabled="pdfv.cur<=1" @click="pdfvPrev">← 上一页</button>
              <button :disabled="pdfv.cur>=pdfv.pages" @click="pdfvNext">下一页 →</button>
            </div>
            <span class="muted">{{ pdfv.cur }} / {{ pdfv.pages }}</span>
            <input class="bk-jump inp" type="number" min="1" :max="pdfv.pages" @keyup.enter="pdfvGoto($event.target.value)" placeholder="跳页" />
            <div class="pdfv-zoom"><button @click="pdfvZoom(-0.2)">−</button><span>{{ Math.round(pdfv.scale*100) }}%</span><button @click="pdfvZoom(0.2)">+</button></div>
            <button v-if="!pdfvMobile" class="btn subtle" @click="pdfvToggleMode" :title="pdfv.mode==='scroll'?'切换为单页模式':'切换为连续滚动'">{{ pdfv.mode==='scroll' ? '单页' : '连续' }}</button>
            <button class="btn subtle" @click="pdfAiOpen" title="就当前页内容问 AI">✨ 问 AI</button>
            <button class="btn subtle" @click="pdfvClose">关闭</button>
          </div>
          <div class="pdfv-body" :class="{'one-col': pdfv.mode==='page'}">
            <div class="pdfv-rail" ref="pdfvRail" v-if="pdfv.mode==='scroll'">
              <div v-for="n in pdfv.pages" :key="n" class="pdfv-thumb" :class="{on:n===pdfv.cur}" :data-page="n" @click="pdfvGoto(n)"><canvas></canvas><span>{{ n }}</span></div>
            </div>
            <div class="pdfv-main" ref="pdfvMain" v-if="pdfv.mode==='scroll'">
              <div v-for="n in pdfv.pages" :key="n" class="pdfv-page" :data-page="n"><canvas></canvas></div>
            </div>
            <div class="pdfv-single" v-if="pdfv.mode==='page'"><canvas ref="pdfvSingle"></canvas></div>
          </div>
          <div class="pdfv-foot">
            <button v-if="pdfvMobile" @click="pdfvTocOpen=true">☰ 目录</button>
            <button :disabled="pdfv.cur<=1" @click="pdfvPrev">← 上一页</button>
            <span class="muted">{{ pdfv.cur }} / {{ pdfv.pages }}</span>
            <button :disabled="pdfv.cur>=pdfv.pages" @click="pdfvNext">下一页 →</button>
            <button @click="pdfAiOpen" title="就当前页问 AI">✨</button>
          </div>
          <div v-if="pdfvMobile" class="pdfv-drawer" :class="{open:pdfvTocOpen}">
            <div class="pdfv-drawer-h"><b>目录</b><span class="muted" style="margin-left:6px">共 {{ pdfv.pages }} 页</span><button class="toc-close" @click="pdfvTocOpen=false" style="margin-left:auto">✕</button></div>
            <input class="inp pdfv-drawer-jump" type="number" min="1" :max="pdfv.pages" @keyup.enter="pdfvGoto($event.target.value); pdfvTocOpen=false" placeholder="输入页码跳转" style="margin:0 12px 8px;width:calc(100% - 24px)" />
            <div class="pdfv-drawer-list">
              <div v-for="n in pdfv.pages" :key="n" :class="{on:n===pdfv.cur}" @click="pdfvGoto(n); pdfvTocOpen=false">第 {{ n }} 页</div>
            </div>
          </div>
          <div v-if="pdfvMobile && pdfvTocOpen" class="pdfv-backdrop" @click="pdfvTocOpen=false"></div>
        </div>
        <div v-else-if="!pdfv.loading" class="empty"><p>选择一个 PDF 直接在线阅读。适合公式、图表多、不想被 OCR 弄花的教材。<br>提示：PDF 仅在本次打开期间保留；想长期保存请用「整理笔记」导入，或把 PDF 放进部署的 public/。</p></div>
      </div>
      <div v-show="booksMode==='notes'">
      <template v-if="!materials.loaded">
        <div class="bk-loading" style="min-height:200px"><span class="bk-loadbar"></span><span class="muted" style="margin-top:10px">正在加载教材… {{ loadProgMsg }}</span></div>
      </template>
      <template v-else-if="!materialBooks.length">
        <div class="empty">
          <p>还没有教材资料。去「导入」粘贴教材正文或上传教材 PDF，整理好的知识点会显示在这里。</p>
          <button class="btn" @click=\"go('ingest')\">去导入教材</button>
        </div>
      </template>
      <template v-else>
        <template v-for="(list,sub) in booksBySubject" :key="sub">
          <div v-if="list.length" class="bk-shelf">
            <div class="bk-shelf-label fold-head" @click="bookFold[sub]=!bookFold[sub]"><span>{{ subjName(sub)==='other'? '其他' : subjName(sub) }} <span class="muted" style="font-weight:400;font-size:12px">{{ list.length }} 本</span></span><span class="fold-arrow" :class="{open:!bookFold[sub]}">▾</span></div>
            <div v-show="!bookFold[sub]" class="bk-grid">
              <button v-for="b in list" :key="b.key" class="bk-card" :class="{on:currentBookId===b.key}" @click="currentBookId=b.key">
                <span class="spine"></span>
                <span class="t">{{ b.title }}</span>
                <span class="m">{{ b.pages.length }} 页</span>
              </button>
            </div>
          </div>
        </template>
        <div v-if="currentBook && currentPageMat" class="bk-reader" :class="{'toc-collapsed':!bookTocOpen,'toc-open':bookTocOpen}">
          <aside class="bk-toc">
            <h4>目录 <span class="muted">{{ currentBook.pages.length }} 篇</span><button class="toc-close" @click="bookTocOpen=false" title="关闭">✕</button></h4>
            <div class="tip">按每页正文标题/首行生成，点击跳转</div>
            <div v-for="(m,i) in currentBook.pages" :key="m.id" class="bk-toc-item" :class="{on:i===bookIdx}" @click="bookGoto(i); bookTocOpen = (window.innerWidth>860)">{{ pageLabel(m) }}</div>
          </aside>
          <div class="bk-toc-backdrop" @click="bookTocOpen=false"></div>
          <div class="bk-page">
            <div class="bk-bar">
              <button class="bk-toctoggle" @click="bookTocOpen=!bookTocOpen" :title="bookTocOpen?'收起目录':'展开目录'">{{ bookTocOpen ? '⟨ 收起目录' : '☰ 目录' }}</button>
              <div style="flex:1;min-width:160px">
                <div class="ttl">{{ pageLabel(currentPageMat) }}</div>
                <div class="sub">{{ subjName(currentPageMat.subject) }}<span v-if="currentPageMat.page"> · 第 {{ currentPageMat.page }} 页</span> · 本书第 {{ bookIdx+1 }} / {{ currentBook.pages.length }} 篇</div>
              </div>
              <div class="bk-nav">
                <button :disabled="bookIdx<=0" @click="bookPrev">← 上一页</button>
                <button :disabled="bookIdx>=currentBook.pages.length-1" @click="bookNext">下一页 →</button>
              </div>
              <button class="bk-toctoggle" @click="readerOpen" title="全屏沉浸阅读：可调字号、行距、主题，点两侧翻篇">📖 沉浸阅读</button>
              <input class="bk-jump inp" type="number" min="1" @keyup.enter="bookJumpPage($event.target.value)" placeholder="跳页" title="输入页码回车跳转" />
              <button class="btn subtle" @click="currentBookId=''" style="flex:none">关闭</button>
            </div>
            <div class="bk-body">
              <div v-if="pageRendering" class="bk-loading"><span class="bk-loadbar"></span><span class="muted" style="margin-top:10px">正在加载本页…</span></div>
              <template v-else>
                <div v-if="currentPageMat.summary" class="summary">{{ currentPageMat.summary }}</div>
                <img v-if="currentPageMat.page_image" :src="currentPageMat.page_image" style="max-width:100%;border-radius:12px;border:1px solid var(--line);margin-bottom:16px" />
                <rich-text :content="cleanPageMd(currentPageMat.content_md)" />
                <div v-if="genq.result" class="ref" style="margin-top:20px">
                  <h5>已生成 {{ genq.result.inserted_questions ?? genq.result.inserted ?? 0 }} 道题（进题库 · {{ subjName(currentPageMat.subject) }}）</h5>
                  <div v-for="(s,i) in (genq.result.sample||[])" :key="i" class="muted">· [{{ typeMap[s.type]||s.type }}] {{ s.stem }}</div>
                </div>
              </template>
            </div>
            <div class="bk-foot">
              <div class="bk-nav">
                <button :disabled="bookIdx<=0" @click="bookPrev">← 上一页</button>
                <button :disabled="bookIdx>=currentBook.pages.length-1" @click="bookNext">下一页 →</button>
              </div>
              <select class="bk-mini" :value="currentPageMat.subject" @change="setBookSubject($event.target.value)" title="修改本书科目"><option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option></select>
              <button class="btn" :disabled="bookExtract.busy" @click="localExtractPage" title="用规则解析本页现成的习题+解答，直接入题库，不消耗 AI"><span v-if="bookExtract.busy" class="spin"></span>本页抽题入库（不花 AI）</button>
              <button class="btn subtle" :disabled="bookExtract.busy" @click="localExtractBook" title="把整本书的习题一次性抽进题库，不消耗 AI"><span v-if="bookExtract.busy" class="spin"></span>整本抽题入库</button>
              <button class="btn subtle" :disabled="genq.busy || !(ai.hasAI || (explainCfg.base && explainCfg.key))" @click="genQuestionsFromMaterial" title="让 AI 依据本页内容出题（会消耗 AI 额度）"><span v-if="genq.busy" class="spin"></span>AI 出题</button>
              <span v-if="bookExtract.busy && bookExtract.prog" class="muted">{{ bookExtract.prog }}</span>
              <button class="bk-del" style="margin-left:auto" @click="deleteCurrentBook">删除本书</button>
            </div>
          </div>
        </div>
      </template>
      </div>
    </div>

    <div v-else-if="view==='mock'">
      <div v-if="!mock.started && !mock.finished">
        <h2 style="margin:.2em 0 .5em">模拟测试</h2>
        <p class="muted" style="margin-bottom:16px">限时测试。提交后自动判分；错题会进入复习。</p>
        <div class="toolbar">
          <div class="field"><label>科目</label>
            <select v-model="mock.subject">
              <option value="all">全部科目</option>
              <option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option>
            </select></div>
          <div class="field"><label>题数</label>
            <select v-model.number="mock.count"><option :value="10">10</option><option :value="20">20</option><option :value="30">30</option><option :value="50">50</option><option :value="100">100</option></select></div>
          <div class="field"><label>时间（分钟）</label>
            <select v-model.number="mock.minutes"><option :value="15">15</option><option :value="30">30</option><option :value="60">60</option><option :value="90">90</option><option :value="120">120</option></select></div>
        </div>
        <label class="row" style="margin:6px 0 18px;cursor:pointer"><input type="checkbox" v-model="mock.objectiveOnly" /> <span class="muted">仅自动判分题（单选 / 多选 / 判断）</span></label>
        <button class="btn" :disabled="loading" @click="startMock"><span v-if="loading" class="spin"></span>开始测试</button>
      </div>

      <template v-else>
        <div v-if="mock.started" class="mock-bar">
          <span class="timer" :class="{warn:mock.remaining<60}">{{ fmtTime(mock.remaining) }}</span>
          <span class="muted">{{ mock.questions.length }} 题 · {{ subjName(mock.subject==='all'?'':mock.subject)||'全部科目' }}</span>
          <div class="spacer" style="flex:1"></div>
          <button class="btn" @click="submitMock">提交</button>
        </div>

        <div v-if="mock.finished" class="card" style="text-align:center">
          <div class="stamp" :class="mockPct>=60?'ok':'bad'"><div><div class="s">{{ mockPct }}</div><div class="u">得分</div></div></div>
          <div style="font-weight:700;font-size:18px">得分 {{ mockResult.correct }} / {{ mockResult.total }}</div>
          <p class="muted" style="margin-top:6px">用时 {{ fmtTime(mock.elapsed) }}<span v-if="mockResult.graded<mockResult.total"> · 还有 {{ mockResult.total-mockResult.graded }} 道主观题需自评</span></p>
          <div class="row" style="justify-content:center;margin-top:14px">
            <button class="btn subtle" @click="quitMock">返回</button>
            <button class="btn" @click="startMock">重新测试</button>
          </div>
        </div>
        <h3 v-if="mock.finished" style="margin:22px 0 10px">复盘</h3>

        <div v-for="(q,i) in mock.questions" :key="q.id" style="margin-bottom:16px">
          <div class="q-counter" style="margin-bottom:6px">第 {{ i+1 }} 题
            <template v-if="mock.finished">·
              <span v-if="mock.answers[q.id]===true" style="color:var(--ok)">正确</span>
              <span v-else-if="mock.answers[q.id]===false" style="color:var(--bad)">错误</span>
              <span v-else class="muted">自评</span>
            </template>
          </div>
          <question-card ref="mockCards" :q="q" mode="exam" :exam-reveal="mock.finished" @answered="onMockAnswer" />
        </div>

        <button v-if="mock.started" class="btn" style="width:100%" @click="submitMock">提交</button>
      </template>
    </div>

    <div v-else-if="view==='bank'">
      <div class="filters">
        <div class="field"><label>科目</label>
          <select v-model="bank.subject" @change="loadBank(true)"><option value="">全部科目</option><option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option></select></div>
        <div class="field"><label>题型</label>
          <select v-model="bank.type" @change="loadBank(true)"><option value="">全部题型</option><option v-for="t in types" :key="t.v" :value="t.v">{{ t.t }}</option></select></div>
        <div class="field" style="flex:1;min-width:180px"><label>关键词</label>
          <input class="inp" v-model="bank.kw" @keyup.enter="loadBank(true)" placeholder="搜题干 / 章节，回车搜索" /></div>
        <button class="btn subtle" @click="loadBank(true)" style="align-self:flex-end">↻ 搜索</button>
      </div>

      <div class="bank-toolbar">
        <label class="bank-check"><input type="checkbox" :checked="bank.items.length && bank.items.every(q=>bank.sel.includes(q.id))" @change="bankAllOnPage" /> 全选本页</label>
        <span class="muted">已选 {{ bank.sel.length }} · 共 {{ bank.total }} 题(已加载 {{ bank.items.length }})</span>
        <button class="btn subtle" v-if="bank.items.length" @click="bankAutoClassify" title="按题干内容自动纠正科目（仅强特征命中）">🪄 智能归类(本页)</button>
        <button class="btn subtle" @click="loadBank(true)" :disabled="bank.loading" title="重新从服务器拉取题库列表">🔄 刷新</button>
        <button class="btn subtle" v-if="bank.total" @click="bankDedup" title="扫描整个题库，删除题干完全相同的重复题（每组保留一道）">🧹 清理重复</button>
        <template v-if="bank.sel.length">
          <select class="bk-mini" v-model="bank.batchSubject"><option value="">改科目为…</option><option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option></select>
          <button class="btn subtle" @click="bankBatchSubject">应用</button>
          <button class="bk-del" @click="bankBatchDelete">删除选中 ({{ bank.sel.length }})</button>
        </template>
      </div>

      <div v-if="bank.loading && !bank.items.length" class="empty"><span class="spin"></span> 加载中…</div>
      <div v-else-if="!bank.items.length" class="empty"><div class="big">∅</div><p>题库为空或没有匹配的题目。</p></div>
      <template v-else>
        <div v-for="(q,i) in bank.items" :key="q.id" class="bank-row" :class="{sel:bank.sel.includes(q.id)}">
          <input type="checkbox" class="bank-rowck" :checked="bank.sel.includes(q.id)" @change="bankToggle(q.id)" />
          <div class="bank-main">
            <div class="bank-meta"><span class="tag">{{ subjName(q.subject) }}</span><span class="tag2">{{ typeMap[q.type]||q.type }}</span><span v-if="q.mastered" class="q-badge" style="color:var(--ok);border-color:var(--ok)">已掌握</span><span v-else-if="q.wrong_count>0" class="q-badge" style="color:var(--bad);border-color:var(--bad)">错 {{ q.wrong_count }} 次</span><span v-else-if="q.right_count>0" class="q-badge" style="color:var(--ok);border-color:var(--ok)">已做对</span><span v-if="q.favorited" class="q-badge" style="color:var(--accent);border-color:var(--accent)">★ 收藏</span><span class="muted" style="font-size:12px">#{{ i+1 }}</span></div>
            <div class="bank-stem"><rich-text :content="q.stem || '（空题干）'" /></div>
            <div v-if="q.source || q.page" class="bank-src"><span class="bank-src-book" :title="q.source">📖 {{ srcBook(q.source) }}</span><span v-if="q.page" class="bank-src-pg">P{{ q.page }}</span></div>
          </div>
          <div class="bank-side">
            <button class="btn subtle xs" @click="bankOpenEdit(q)">编辑</button>
            <button class="bk-del xs" @click="bankDelete(q)">删除</button>
          </div>
        </div>
        <div class="row" style="justify-content:center;margin:16px 0" v-if="bank.items.length < bank.total">
          <button class="btn subtle" :disabled="bank.loading" @click="bankMore"><span v-if="bank.loading" class="spin"></span>加载更多（还有 {{ bank.total - bank.items.length }} 题）</button>
        </div>
      </template>

      <div v-if="bankEdit.open" class="modal-mask" @click.self="bankCloseEdit">
        <div class="modal">
          <div class="modal-h"><b>编辑题目</b><button class="toc-close" @click="bankCloseEdit">✕</button></div>
          <div class="modal-b">
            <div class="row" style="gap:10px;margin-bottom:10px">
              <div class="field" style="flex:1"><label>科目</label><select v-model="bankEdit.subject"><option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option></select></div>
              <div class="field" style="flex:1"><label>题型</label><select v-model="bankEdit.type"><option v-for="t in types" :key="t.v" :value="t.v">{{ t.t }}</option></select></div>
            </div>
            <label class="lbl">题干（支持 Markdown / LaTeX，行内公式用 $…$ 需成对）</label>
            <textarea class="inp" v-model="bankEdit.stem" rows="5"></textarea>
            <template v-if="isChoiceType(bankEdit.type) && bankEdit.type!=='true_false'">
              <label class="lbl" style="margin-top:10px">选项</label>
              <div v-for="(o,i) in bankEdit.options" :key="i" class="row" style="gap:8px;margin-bottom:6px">
                <input class="inp" style="width:54px;text-align:center" v-model="o.key" placeholder="A" />
                <input class="inp" style="flex:1" v-model="o.text" placeholder="选项内容" />
                <button class="btn subtle xs" @click="bankEditDelOpt(i)">删</button>
              </div>
              <button class="btn subtle xs" @click="bankEditAddOpt">+ 添加选项</button>
            </template>
            <label class="lbl" style="margin-top:10px">正确答案
              <span class="muted" style="font-weight:400">{{ bankEdit.type==='single_choice' ? '（填选项字母，如 C）' : bankEdit.type==='multiple_choice' ? '（多个字母用逗号，如 A,C）' : bankEdit.type==='true_false' ? '（填 T 或 F）' : bankEdit.type==='fill_blank' ? '（每空一行）' : '（参考答案文本）' }}</span>
            </label>
            <textarea class="inp" v-model="bankEdit.answerText" :rows="isChoiceType(bankEdit.type)?1:4" placeholder="答案"></textarea>
            <label class="lbl" style="margin-top:10px">解析（可选）</label>
            <textarea class="inp" v-model="bankEdit.analysis" rows="3"></textarea>
            <div class="prev-box"><div class="lbl">预览</div><rich-text :content="bankEdit.stem || '（空）'" /></div>
          </div>
          <div class="modal-f">
            <button class="btn subtle" @click="bankCloseEdit">取消</button>
            <button class="btn" :disabled="bankEdit.busy" @click="bankSaveEdit"><span v-if="bankEdit.busy" class="spin"></span>保存</button>
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="view==='stats'">
      <div v-if="statsLoading" class="empty"><span class="spin"></span> 加载中…</div>
      <template v-else-if="stats">
        <div class="stat-grid">
          <div class="stat"><div class="n">{{ statTotals.totalQ }}</div><div class="l">题目总数</div></div>
          <div class="stat"><div class="n">{{ statTotals.seen }}</div><div class="l">已作答</div></div>
          <div class="stat"><div class="n" style="color:var(--bad)">{{ statTotals.wrongOpen }}</div><div class="l">待复习</div></div>
          <div class="stat"><div class="n" style="color:var(--ok)">{{ statTotals.mastered }}</div><div class="l">已掌握</div></div>
        </div>
        <div v-if="!statTotals.totalQ" class="empty"><p>暂无题目。请到导入页面添加题目。</p><button class="btn" @click=\"go('ingest')\">前往导入</button></div>
        <template v-else>
          <h3 style="margin:6px 0 12px">按科目统计正确率</h3>
          <div v-for="r in stats.bySubject" :key="r.subject" class="subj-row">
            <div class="top"><span>{{ subjName(r.subject) }}</span><span class="muted">{{ rate(r) }}% · 正确 {{ r.right_sum||0 }} / 已答 {{ (r.right_sum||0)+(r.wrong_sum||0) }}</span></div>
            <div class="bar"><span :style="{width:rate(r)+'%', background: rate(r)>=60?'var(--ok)':'var(--bad)'}"></span></div>
            <div class="muted" style="margin-top:6px">总数 {{ r.total_q }} · 错题 {{ r.wrong_open||0 }} · <b :style="r.due?'color:var(--bad)':''">今日到期 {{ r.due||0 }}</b> · 收藏 {{ r.favorited||0 }}</div>
          </div>
          <template v-if="heatCells.length">
            <h3 style="margin:22px 0 10px">刷题热力图 <span class="muted" style="font-weight:400;font-size:13px">近 20 周 · 共 {{ heatTotal }} 次作答</span></h3>
            <div class="heat-grid">
              <div v-for="c in heatCells" :key="c.key" class="heat-cell" :class="heatColor(c.n)" :title="c.key+'：'+c.n+' 题（对 '+c.r+'）'"></div>
            </div>
          </template>
          <template v-if="stats.mocks && stats.mocks.length">
            <h3 style="margin:22px 0 12px">近期测试</h3>
            <div v-for="(m,i) in stats.mocks" :key="i" class="subj-row">
              <div class="top"><span>{{ subjName(m.subject) }} · {{ m.correct }}/{{ m.total }}</span>
                <span class="muted">{{ fmtTime(m.duration_seconds) }}
                  <button class="btn subtle" style="margin-left:8px;padding:2px 10px;font-size:12px" @click="reviewMock(m)">错题回顾</button>
                </span></div>
              <div class="bar"><span :style="{width:(m.total?Math.round(m.correct/m.total*100):0)+'%', background:(m.total&&m.correct/m.total>=0.6)?'var(--ok)':'var(--bad)'}"></span></div>
            </div>
          </template>
        </template>
      </template>
      <div v-else class="empty"><span class="spin"></span> 加载中…</div>
    </div>

    <div v-else-if="view==='ingest'">
      <h2 style="margin:.2em 0 .5em">导入</h2>
      <div class="seg" style="margin-bottom:14px">
        <button :class="{on:ingest.tab==='manual'}" @click="ingest.tab='manual'">手动录入</button>
        <button :class="{on:ingest.tab==='photo'}" @click="ingest.tab='photo'">拍照辅助</button>
        <button :class="{on:ingest.tab==='json'}" @click="ingest.tab='json'">导入 JSON</button>
        <button :class="{on:ingest.tab==='pdf'}" @click="ingest.tab='pdf'">PDF 文本</button>
        <button :class="{on:ingest.tab==='md'}" @click="ingest.tab='md'">Markdown</button>
        <button :class="{on:ingest.tab==='mineru'}" @click="ingest.tab='mineru'">MinerU</button>
        <button :class="{on:ingest.tab==='ai'}" @click="ingest.tab='ai'">AI 整理</button>
      </div>
      <div class="toolbar">
        <div class="field" v-if="!['manual','json','md','mineru'].includes(ingest.tab)"><label>导入类型</label>
          <select v-model="ingest.kind"><option value="auto">自动分辨（题库 / 教材）</option><option value="questions">只当题库</option><option value="material">只当教材</option></select></div>
        <div class="field"><label>默认科目</label>
          <select v-model="ingest.subject"><option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option></select></div>
        <div class="field" v-if="['photo','pdf','ai','md','mineru'].includes(ingest.tab)"><label>教材名称（转教材时用作书名，按科目归类）</label><input class="inp" v-model="ingest.bookTitle" placeholder="如 谭浩强C程序设计（选 PDF/MD 会自动填）" /></div>
        <template v-if="!['json','md','mineru'].includes(ingest.tab)">
          <div class="field"><label>章节预设</label>
            <select v-model="ingest.chapter"><option value="">选择 / 下方自定义</option><option v-for="c in ingestChapterOptions" :key="c.chapter" :value="c.chapter">{{ c.chapter }} {{ c.n ? '('+c.n+')' : '' }}</option></select></div>
          <div class="field"><label>自定义章节</label><input class="inp" v-model="ingest.chapter" placeholder="例如：C语言-指针" /></div>
        </template>
        <template v-if="ingest.tab==='manual'">
          <div class="field"><label>书本 / 来源模式</label><label class="row" style="height:40px;cursor:pointer"><input type="checkbox" v-model="ingest.bookMode" /> <span class="muted">小红本自动来源</span></label></div>
          <template v-if="ingest.bookMode">
            <div class="field"><label>书名</label><input class="inp" v-model="ingest.bookName" placeholder="小红本" /></div>
            <div class="field"><label>页码</label><input class="inp" v-model="ingest.pageNo" placeholder="12" /></div>
            <div class="field"><label>题号</label><input class="inp" v-model="ingest.questionNo" placeholder="3" /></div>
          </template>
          <div class="field" v-else><label>来源</label><input class="inp" v-model="ingest.source" placeholder="例如：2023 真题" /></div>
        </template>
        <div class="field" v-else-if="['photo','ai'].includes(ingest.tab)"><label>来源（可选，作题目出处）</label><input class="inp" v-model="ingest.source" placeholder="例如：2023 真题" /></div>
      </div>
      <div class="hint" v-if="!['json','md','mineru'].includes(ingest.tab)">当前分类： <b>{{ subjName(ingest.subject) }}</b><span v-if="ingest.chapter"> · {{ ingest.chapter }}</span><span v-if="['photo','pdf','ai'].includes(ingest.tab) && ingest.bookTitle"> · 教材：{{ ingest.bookTitle }}</span><br>题目来源： <code>{{ currentSource() || '（无）' }}</code></div>
      <template v-if="ingest.tab==='manual' || ingest.tab==='photo'">
        <div v-if="ingest.tab==='photo'" class="card" style="margin-bottom:14px">
          <label class="btn subtle" style="cursor:pointer">拍摄 / 选择照片
            <input type="file" accept="image/*" capture="environment" @change="onPhotoFile" style="display:none" />
          </label>
          <div class="hint">照片先保留在浏览器本地。“AI OCR 识别并导入”会把图片发给你配置的 AI 视觉模型，识别出的题目写入题库。若模型不支持图片，可用“本地 OCR 存为教材”，全程在浏览器里识别、不花 AI 额度。</div>
          <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:8px"><button class="btn" :disabled="ingest.busy || ingest.local.busy || !ingest.photoDataUrl" @click="aiPhotoImport"><span v-if="ingest.busy" class="spin"></span>AI OCR 识别并导入</button><button class="btn subtle" :disabled="ingest.busy || ingest.local.busy || !ingest.photoDataUrl" @click="photoToMaterialLocal"><span v-if="ingest.local.busy" class="spin"></span>本地 OCR 存为教材（不调用 AI）</button></div>
          <div class="hint" v-if="ingest.local.busy || ingest.local.prog">{{ ingest.local.prog || '处理中…' }}</div>
          <img v-if="ingest.photoUrl" :src="ingest.photoUrl" style="max-width:100%;margin-top:12px;border-radius:12px;border:1px solid var(--line)" />
        </div>
        <div class="toolbar">
          <div class="field"><label>题型</label><select v-model="ingest.manual.type"><option v-for="t in types" :key="t.v" :value="t.v">{{ t.t }}</option></select></div>
          <div class="field"><label>难度</label><select v-model.number="ingest.manual.difficulty"><option v-for="n in [1,2,3,4,5]" :key="n" :value="n">{{ n }}</option></select></div>
        </div>
        <textarea v-model="ingest.manual.passage" style="min-height:80px;margin-bottom:10px" placeholder="可选：材料 / 阅读文本"></textarea>
        <textarea v-model="ingest.manual.stem" placeholder="题干。数学可用 $...$；代码可用 Markdown 代码块。"></textarea>
        <div v-if="ingest.manual.type==='single_choice'||ingest.manual.type==='multiple_choice'" style="margin-top:10px">
          <div v-for="o in ingest.manual.options" :key="o.key" class="row" style="margin-bottom:8px"><span class="chip">{{ o.key }}</span><input class="inp" style="flex:1" v-model="o.text" :placeholder="'选项 '+o.key" /></div>
        </div>
        <input class="inp" style="width:100%;margin-top:10px" v-model="ingest.manual.answer" placeholder="答案：单选填 A；多选填 A,C；判断填 T 或 F；填空每行一个；主观题填写参考答案" />
        <textarea v-model="ingest.manual.analysis" style="min-height:90px;margin-top:10px" placeholder="解析 / 分析（可选）"></textarea>
        <input class="inp" style="width:100%;margin-top:10px" v-model="ingest.manual.tags" placeholder="标签，用逗号分隔（可选）" />
        <div class="hint">这会通过 /api/process 将结构化 JSON 直接保存到 D1。无需 AI、无需 OCR、无需付费服务。</div>
        <div class="row" style="margin-top:12px"><button class="btn" :disabled="ingest.busy" @click="saveManual"><span v-if="ingest.busy" class="spin"></span>免费保存题目</button><button class="btn subtle" @click="resetManual">清空</button></div>
      </template>
      <template v-else-if="ingest.tab==='ai'">
        <textarea v-model="ingest.raw" placeholder="粘贴任意原文：可以是杂乱的题目，也可以是教材正文。AI 会自动分辨——是题目就结构化进题库，是教材就整理成知识点笔记进「教材阅读」。此功能消耗 AI 中转额度。"></textarea>
        <div class="hint">上方「导入类型」选<b>自动分辨</b>时，AI 会判断这段是题库还是教材并分别入库；也可强制只当题库 / 只当教材。纯免费零成本请用手动录入、JSON 或 PDF 本地提取文本。</div>
        <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:8px"><button class="btn" :disabled="ingest.busy || ingest.local.busy" @click="doIngest"><span v-if="ingest.busy" class="spin"></span>用 AI 整理并导入</button><button class="btn subtle" :disabled="ingest.busy || ingest.local.busy" @click="saveTextAsMaterial"><span v-if="ingest.local.busy" class="spin"></span>不调用 AI，直接存为教材</button></div>
        <div class="hint" v-if="ingest.local.busy || ingest.local.prog">{{ ingest.local.prog || '处理中…' }}</div>
      </template>
      <template v-else-if="ingest.tab==='json'">
        <textarea class="code" v-model="ingest.json" placeholder='Paste a JSON array, e.g. [{"subject":"computer","type":"single_choice","stem":"...","options":[{"key":"A","text":"..."}],"answer":["B"]}]'></textarea>
        <div class="hint">如果你已经有结构化题目，请用这里。<b>无 AI 成本</b>。数据格式见项目 README。</div>
        <div class="row" style="margin-top:12px">
          <button class="btn" :disabled="ingest.busy" @click="doIngest"><span v-if="ingest.busy" class="spin"></span>导入</button>
          <button class="btn subtle" @click="loadSample">加载示例题集</button>
        </div>
      </template>
      <template v-else-if="ingest.tab==='pdf'">
        <label class="btn subtle" style="cursor:pointer">选择 PDF
          <input type="file" accept="application/pdf,.pdf" @change="onPdfFile" style="display:none" />
        </label>
        <span v-if="ingest.pdf.pages" class="muted" style="margin-left:10px">已加载，{{ ingest.pdf.pages }} 页</span>
        <div class="hint">扫描版勾「扫描页用本地 OCR」后选引擎：<b>中转站·你的视觉模型</b>（最准，识别成带标题/公式的 Markdown，按你中转额度计费）；Scribe.js / tesseract（免费本地，公式弱）；Workers AI（Cloudflare 免费额度，每天 {{ cfocr.limit }} 页封顶）。公式会输出 LaTeX 并用 KaTeX 显示。建议每次先测 1–3 页。</div>
        <div class="toolbar" style="margin-top:12px" v-if="ingest.pdf.pages">
          <div class="field"><label>开始页</label><input class="inp" type="number" min="1" :max="ingest.pdf.pages" v-model.number="ingest.pdf.start" /></div>
          <div class="field"><label>结束页</label><input class="inp" type="number" min="1" :max="ingest.pdf.pages" v-model.number="ingest.pdf.end" /></div>
          <div class="field"><label>清晰度</label><input class="inp" type="number" step="0.1" min="1" max="2.5" v-model.number="ingest.pdf.scale" /></div>
        </div>
        <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:8px" v-if="ingest.pdf.pages">
          <button class="btn subtle" :disabled="ingest.pdf.busy || ingest.local.busy" @click="pdfExtractText"><span v-if="ingest.pdf.busy" class="spin"></span>本地提取文本</button>
          <button class="btn" :disabled="ingest.pdf.busy || ingest.local.busy" @click="pdfByImages"><span v-if="ingest.pdf.busy" class="spin"></span>AI OCR 当前页范围并导入（题库）</button>
          <button class="btn subtle" :disabled="ingest.pdf.busy || ingest.local.busy" @click="pdfToMaterialLocal"><span v-if="ingest.local.busy" class="spin"></span>当前页范围转教材存入 Books（不调用 AI）</button>
          <button class="btn subtle" :disabled="ingest.pdf.busy || ingest.local.busy" @click="pdfAllToMaterialLocal">全部页转教材（共 {{ ingest.pdf.pages }} 页）</button>
          <button v-if="ingest.local.busy" class="btn subtle" @click="ingest.local.stop=true">停止</button>
          <label class="row" style="height:40px;cursor:pointer;gap:6px"><input type="checkbox" v-model="ingest.local.ocr" /> <span class="muted">扫描页用本地 OCR</span></label>
          <div class="field" v-if="ingest.local.ocr" style="margin:0"><label>OCR 引擎</label><select v-model="ingest.local.engine" @change="ingest.local.engine==='cfai' && loadCfUsage()"><option value="relay" :disabled="!ai.hasAI && !ocrCfg.key && !(explainCfg.base && explainCfg.key)">中转站·你的视觉模型（最准）</option><option value="scribe">Scribe.js（免费·较慢）</option><option value="tesseract">tesseract（免费·一般）</option><option value="cfai" :disabled="!ai.hasCfAI">Workers AI（免费额度{{ ai.hasCfAI?'':'·未绑定' }}）</option></select></div>
          <template v-if="ingest.local.ocr && ingest.local.engine==='relay'">
            <div class="field" style="margin:0;min-width:260px"><label>视觉模型（须支持看图，如 gpt-4o / qwen-vl-max / gemini-1.5-pro）</label><input class="inp" v-model="ocrCfg.model" @change="saveOcrCfg" placeholder="留空用服务端 AI_VISION_MODEL" /></div>
            <details style="flex-basis:100%;margin-top:4px"><summary class="muted" style="cursor:pointer;font-size:13px">高级：自定义 Base URL / API Key（可选）</summary>
              <div class="toolbar" style="margin-top:8px">
                <div class="field" style="margin:0;min-width:280px"><label>Base URL（留空用服务端）</label><input class="inp" v-model="ocrCfg.base" @change="saveOcrCfg" placeholder="https://你的中转站/v1" /></div>
                <div class="field" style="margin:0;min-width:280px"><label>API Key（留空用服务端）</label><input class="inp" type="password" v-model="ocrCfg.key" @change="saveOcrCfg" placeholder="sk-..." /></div>
              </div>
              <div class="hint" style="margin-top:6px">⚠ 这里填的 Key 仅保存在你本机浏览器（localStorage），请求时经本站后端转发给你的中转站；公用电脑勿填，建议用额度受限的子 Key。留空则用服务端环境变量里的配置。</div>
            </details>
          </template>
          <template v-if="ingest.local.ocr && ingest.local.engine==='cfai'">
            <div class="field" style="margin:0"><label>每日页数上限（防超额度）</label><select v-model.number="ingest.local.cfPageLimit"><option :value="30">30 页（约 {{ 30*cfocr.npp }} 神经元·很保守）</option><option :value="50">50 页（约 {{ 50*cfocr.npp }} 神经元·推荐）</option><option :value="70">70 页（约 {{ 70*cfocr.npp }} 神经元·接近上限）</option></select></div>
            <div class="field" style="margin:0;min-width:320px"><label>Workers AI 模型（留空=默认 Llama 3.2 Vision；可粘贴 @cf/ 模型）</label><input class="inp" v-model="ingest.local.cfModel" list="cfModelList" placeholder="@cf/meta/llama-3.2-11b-vision-instruct" />
              <datalist id="cfModelList">
                <option value="@cf/meta/llama-3.2-11b-vision-instruct">Llama 3.2 11B Vision（默认·最稳妥）</option>
                <option value="@cf/meta/llama-4-scout-17b-16e-instruct">Llama 4 Scout 17B（更新·多模态·可试）</option>
                <option value="@cf/google/gemma-3-12b-it">Gemma 3 12B（多模态·可试）</option>
                <option value="@cf/mistralai/mistral-small-3.1-24b-instruct">Mistral Small 3.1 24B（多模态·可试）</option>
              </datalist>
            </div>
            <div class="hint" style="flex-basis:100%">今日 Workers AI：已用 <b>{{ cfocr.used }}</b> 页 · 约 <b>{{ cfocr.used*cfocr.npp }}</b> / {{ cfocr.budget }} 神经元，剩约 <b>{{ Math.max(0, cfocr.budget - cfocr.used*cfocr.npp) }}</b>（估算 {{ cfocr.npp }}/页，实际因模型与页面内容而异；精确值看 Cloudflare 后台「神经元」）。免费层每天 {{ cfocr.budget }} 神经元，UTC 0 点重置。默认 Llama 3.2 最稳；其它为多模态模型，<b>调用图片的格式不一定兼容，可能识别效果差或报错，不行就换回默认</b>。Workers AI 模型库里没有 Qwen-VL。</div>
          </template>
          <span v-if="ingest.pdf.inserted" class="muted">已导入 {{ ingest.pdf.inserted }} 题</span>
        </div>
        <div class="hint" v-if="ingest.pdf.pages">转教材将存入：<b>{{ materialBaseTitle() }}</b>（即上方「教材名称」；同名同页会覆盖，换书请改书名）</div>
        <div v-if="ingest.local.busy || (ingest.local.prog && !ingest.pdf.busy)" class="ocr-panel">
          <div class="top"><div><b>本地转教材进度</b><div class="muted">不调用 AI，全程在浏览器内完成</div></div><div class="row" style="gap:10px;align-items:center"><button v-if="ingest.local.busy" class="btn subtle" style="color:#c0392b;height:32px;padding:0 14px" @click="ingest.local.stop=true">■ 停止</button><div class="pct">{{ ingest.local.total ? Math.round(ingest.local.done/ingest.local.total*100) : 0 }}%</div></div></div>
          <div class="bar accent"><span :style="{width:(ingest.local.total ? Math.round(ingest.local.done/ingest.local.total*100) : 0)+'%'}"></span></div>
          <div class="hint" style="margin-top:10px"><span v-if="ingest.local.busy" class="spin"></span> {{ ingest.local.prog || '等待开始' }} · {{ ingest.local.done }}/{{ ingest.local.total || 0 }} · 已存 {{ ingest.local.inserted }} 段教材</div>
          <div v-if="ingest.local.log.length" style="margin-top:10px">
            <div class="muted" style="font-size:12px;margin-bottom:4px">逐页明细（共 {{ ingest.local.log.length }} 条，最新在下）：</div>
            <div style="max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:8px 10px;font-size:12.5px;line-height:1.6;font-family:var(--mono,monospace)">
              <div v-for="(l,i) in ingest.local.log" :key="i" :style="{color: l.t==='ok'?'var(--ink)': l.t==='skip'?'#b8860b':'#c0392b'}">{{ l.t==='ok'?'✓':l.t==='skip'?'⚠':'✗' }} 第 {{ l.p }} 页 · {{ l.msg }}</div>
            </div>
          </div>
        </div>
        <div v-if="!ingest.local.busy && ingest.local.lastPage && ingest.local.lastPage < ingest.local.endPage" class="hint" style="margin-top:10px;color:var(--accent)">已处理到第 {{ ingest.local.lastPage }} 页（共到第 {{ ingest.local.endPage }} 页未完）。「开始页」已自动设为 {{ ingest.pdf.start }}，直接再点「当前页范围转教材」即可从断点继续。</div>
        <div v-if="ingest.pdf.busy || ingest.pdf.prog" class="ocr-panel">
          <div class="top"><div><b>AI OCR 进度</b><div class="muted">模型：{{ ocrModelName }}</div></div><div class="pct">{{ ingest.pdf.total ? Math.round(ingest.pdf.done/ingest.pdf.total*100) : 0 }}%</div></div>
          <div class="bar accent"><span :style="{width:(ingest.pdf.total ? Math.round(ingest.pdf.done/ingest.pdf.total*100) : 0)+'%'}"></span></div>
          <div class="hint" style="margin-top:10px"><span v-if="ingest.pdf.busy" class="spin"></span> {{ ingest.pdf.prog || '等待开始' }} · {{ ingest.pdf.done }}/{{ ingest.pdf.total || 0 }} 页 · 已导入 {{ ingest.pdf.inserted }} 题</div>
        </div>
        <textarea v-if="ingest.pdf.extracted" class="code" style="margin-top:10px" v-model="ingest.pdf.extracted" placeholder="提取出的 PDF 文本会显示在这里"></textarea><div class="hint" style="margin-top:10px">如果是文字 PDF，可复制文本到“AI 整理”；如果是扫描版，直接用“AI OCR 当前页范围并导入”。</div>
      </template>
      <template v-else-if="ingest.tab==='md'">
        <label class="btn subtle" style="cursor:pointer">选择 Markdown 文件（可多选）
          <input type="file" accept=".md,.markdown,text/markdown" multiple @change="onMdFiles" style="display:none" />
        </label>
        <span v-if="ingest.mdFiles.length" class="muted" style="margin-left:10px">已选 {{ ingest.mdFiles.length }} 个文件</span>
        <div class="hint">把本地转好的章节 Markdown（如 chapter-01.md … 或 front-matter.md）选进来，按「## 第 N 页」自动拆成页存入 Books，复用翻页/目录/出题阅读器。<b>免费、无 OCR、文本干净。</b></div>
        <div class="hint">书名取上方「教材名称」（首个文件的「来源」会自动填）；多文件会按页码合并成同一本书。页面原图若引用 <code>public/textbooks-pages/…</code>，需把对应图片文件夹放进部署的 <code>public/</code> 才能显示；折叠的检索文本始终可读。</div>
        <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:8px">
          <button class="btn" :disabled="ingest.local.busy || !ingest.mdFiles.length" @click="importMarkdown"><span v-if="ingest.local.busy" class="spin"></span>导入到 Books</button>
        </div>
        <div class="hint" v-if="ingest.local.busy || ingest.local.prog">{{ ingest.local.prog || '处理中…' }} · {{ ingest.local.done }}/{{ ingest.local.total || 0 }}</div>
      </template>
      <template v-else-if="ingest.tab==='mineru'">
        <label class="btn subtle" style="cursor:pointer">选择 PDF<input type="file" accept="application/pdf,.pdf" @change="onMineruFile" style="display:none" /></label>
        <span v-if="ingest.mineru.name" class="muted" style="margin-left:10px">{{ ingest.mineru.name }}</span>
        <div class="hint">用 <b>MinerU 云端</b>把整本 PDF 转成高质量 Markdown（公式 LaTeX、版面规整），自动按段导入 Books——很适合高数这类公式书。需先在 Cloudflare 配 <code>MINERU_API_KEY</code>（控制台「API 管理 → 创建 Token」生成的 Token，不是 Access/Secret Key）。解析在 MinerU 服务器进行，按你的 MinerU 额度计费（每天 1000 页高优先级）。书名取上方「教材名称」，科目自动判断。</div>
        <div class="field" style="margin-top:8px;max-width:420px"><label>模式</label><select v-model="ingest.mineru.mode"><option value="agent">免 Token 轻量（≤10MB·≤20页·公式较弱·现在就能用）</option><option value="precise">精准 vlm（需 Token·≤200MB·≤200页·公式最好）</option></select></div>
        <div class="field" style="margin-top:8px;max-width:340px"><label>页码范围（轻量≤20页不支持逗号；精准留空=整本自动按200页分段连跑）</label><input class="inp" v-model="ingest.mineru.pageRange" placeholder="轻量如 1-20；精准留空=整本，或填 1-200" /></div>
        <div class="hint" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:16px;align-items:center">
          <span>今日已用（本工具统计）：<b :style="(Number(mineruCfg.pageLimit)>0 && mineruUsageView.pages>=Number(mineruCfg.pageLimit))?'color:var(--bad)':''">{{ mineruUsageView.pages }}</b> / {{ mineruCfg.pageLimit||'∞' }} 页 · {{ mineruUsageView.files }} / {{ mineruCfg.fileLimit||'∞' }} 文件</span>
          <span v-if="mineruTokenDays()!=null" :style="mineruTokenDays()<=7?'color:var(--bad);font-weight:600':''">⏳ Token 还有 {{ mineruTokenDays() }} 天过期</span>
          <a href="#" @click.prevent="view='settings'" style="color:var(--accent)">配额 / Token 设置 ›</a>
        </div>
        <div v-if="mineruTokenDays()!=null && mineruTokenDays()<=7" class="hint" style="color:var(--bad);background:color-mix(in srgb,var(--bad) 8%,transparent);border:1px solid color-mix(in srgb,var(--bad) 35%,var(--line));border-radius:8px;padding:8px 10px;margin-top:6px">Token {{ mineruTokenDays()<0?'已过期':'即将过期' }}：MinerU 不支持续期，请去控制台「API 管理 → 创建 Token」重建，把新 Token 填到 Cloudflare Pages 环境变量 <code>MINERU_API_KEY</code> 后重新部署（应用无法自动创建）。</div>
        <div v-if="mineruTokenBad" class="hint" style="color:var(--bad);background:color-mix(in srgb,var(--bad) 10%,transparent);border:1px solid color-mix(in srgb,var(--bad) 45%,var(--line));border-radius:8px;padding:8px 10px;margin-top:6px"><b>MinerU Token 已过期或无效</b>（接口返回 A0211 / A0202）。请去 MinerU 控制台「API 管理 → 创建 Token」重建，把新 Token 填到 Cloudflare Pages 环境变量 <code>MINERU_API_KEY</code> 后重新部署。<a href="#" @click.prevent="mineruTokenOk()" style="color:var(--accent);margin-left:6px">我已更新，清除提示</a></div>
        <div class="row" style="margin-top:12px;gap:8px"><button class="btn" :disabled="ingest.mineru.busy || !ingest.mineru.name" @click="mineruConvert"><span v-if="ingest.mineru.busy" class="spin"></span>转换并导入 Books</button></div>
        <div v-if="ingest.mineru.busy || ingest.mineru.log.length" class="ocr-panel" style="margin-top:12px">
          <div class="top"><div><b>MinerU 转换进度</b><div class="muted">提交 → 解析 → 取回 Markdown → 导入</div></div><div class="pct">{{ ingest.mineru.pct }}%</div></div>
          <div class="bar accent"><span :style="{width:ingest.mineru.pct+'%'}"></span></div>
          <div class="hint" style="margin-top:8px"><span v-if="ingest.mineru.busy" class="spin"></span> {{ ingest.mineru.prog || '等待开始' }}</div>
          <div v-if="ingest.mineru.log.length" style="max-height:220px;overflow:auto;border:1px solid var(--line);border-radius:8px;background:var(--surface);padding:8px 10px;font-size:12.5px;line-height:1.6;margin-top:8px;font-family:var(--mono,monospace)"><div v-for="(l,i) in ingest.mineru.log" :key="i">{{ l }}</div></div>
        </div>
      </template>
      <div v-if="ingest.result" class="ref" style="margin-top:16px">
        <h5>导入完成<span v-if="ingest.result.kind"> · 识别为{{ ingest.result.kind==='material'?'教材':ingest.result.kind==='mixed'?'题目+教材':'题库' }}</span></h5>
        <div class="muted">题目 {{ ingest.result.inserted_questions ?? ingest.result.inserted ?? 0 }} 道<span v-if="ingest.result.inserted_materials"> · 教材 {{ ingest.result.inserted_materials }} 段（已进「教材阅读」）</span></div>
        <div v-for="(s,i) in ingest.result.sample" :key="i" class="muted">· [{{ subjName(s.subject) }} / {{ typeMap[s.type]||s.type }}] {{ s.stem }}</div>
        <div v-for="(s,i) in (ingest.result.material_sample||[])" :key="'m'+i" class="muted">· [{{ subjName(s.subject) }} / 教材] {{ s.title }}</div>
      </div>
    </div>

    <div v-else-if="view==='settings'">
      <h2 style="margin:.2em 0 .5em">设置</h2>
      <div class="card" style="max-width:520px">
        <div class="field" style="margin-bottom:14px"><label>访问码（APP_TOKEN）</label>
          <input class="inp" style="width:100%" type="password" v-model="tokenInput" :placeholder="token?'已设置（重新输入可修改）':'输入你在 Cloudflare 设置的 APP_TOKEN'" @keyup.enter="saveToken" />
        </div>
        <div class="row">
          <button class="btn" @click="saveToken">保存</button>
          <button class="btn subtle" v-if="token" @click="logout">清空</button>
          <span class="muted" v-if="token">状态：已连接 ✓</span>
        </div>
        <div class="hint" style="margin-top:16px">访问码是你在 Cloudflare Pages 控制台设置的 <code>APP_TOKEN</code> 环境变量。它用于保护数据并防止他人使用你的 AI 额度。仅存储在当前浏览器中。</div>
      </div>
      <div class="card" style="max-width:680px;margin-top:14px">
        <div class="fold-head" @click="settFold.mineru=!settFold.mineru"><span style="font-weight:700;font-size:15px">MinerU 配额与 Token</span><span class="fold-arrow" :class="{open:!settFold.mineru}">▾</span></div>
        <div v-show="!settFold.mineru" class="fold-body" style="margin-top:10px">
        <div class="hint" style="margin-bottom:14px">用于限制导入页数、避免超出 MinerU 每日额度，并在 Token 快过期时提醒你。<b>API Token 可自带</b>：填入后「精准模式」用你的 Token（仅存本机浏览器、只发往 mineru.net 官方接口），留空则用服务端配置。用量为<b>本工具本地统计</b>（按提交的页数估算），实际以 MinerU 后台为准；每天 0 点自动归零。</div>
        <div class="row" style="gap:12px;flex-wrap:wrap;margin-bottom:12px">
          <div class="field" style="flex:1;min-width:150px"><label>每日页数上限</label><input class="inp" type="number" min="0" v-model.number="mineruCfg.pageLimit" placeholder="1000" /></div>
          <div class="field" style="flex:1;min-width:150px"><label>每日文件数上限</label><input class="inp" type="number" min="0" v-model.number="mineruCfg.fileLimit" placeholder="5000" /></div>
          <div class="field" style="flex:1;min-width:170px"><label>Token 过期日期（从 MinerU 后台抄）</label><input class="inp" type="date" v-model="mineruCfg.tokenExp" /></div>
          <div class="field" style="flex:2;min-width:280px"><label>MinerU API Token（留空用服务端{{ ai.hasMineru?"·已配置":"·未配置" }}）</label>
            <div style="display:flex;gap:8px"><input class="inp" type="password" style="flex:1;min-width:0" v-model="mineruCfg.token" placeholder="mineru.net → API 管理 → 创建 Token 后粘贴" />
            <button class="btn subtle" style="flex:none" @click="saveMineruCfg(); flash(mineruCfg.token?'MinerU Token 已保存（仅本机）':'已清除，回退服务端配置')">确认</button></div></div>
        </div>
        <div class="row" style="gap:14px;align-items:center;flex-wrap:wrap">
          <span class="muted">今日已用：<b>{{ mineruUsageView.pages }}</b> / {{ mineruCfg.pageLimit||'∞' }} 页 · <b>{{ mineruUsageView.files }}</b> / {{ mineruCfg.fileLimit||'∞' }} 文件</span>
          <span v-if="mineruTokenDays()!=null" class="muted" :style="mineruTokenDays()<=7?'color:var(--bad);font-weight:600':''">Token 剩余 {{ mineruTokenDays() }} 天</span>
          <button class="btn subtle xs" @click="mineruResetUsage">重置今日用量</button>
        </div>
        <div class="hint" style="margin-top:12px">设上限为 0 表示不限制。Token 到期后 MinerU <b>不支持续期</b>，需到控制台「API 管理 → 创建 Token」重建，再把新 Token 填到 Cloudflare Pages 环境变量 <code>MINERU_API_KEY</code> 并重新部署——这一步无法由应用自动完成。</div>
        </div>
      </div>
      <div class="card" style="max-width:680px;margin-top:14px">
        <div class="fold-head" @click="settFold.aicfg=!settFold.aicfg"><span style="font-weight:700;font-size:15px">AI 中转站（全局）</span><span class="fold-arrow" :class="{open:!settFold.aicfg}">▾</span></div>
        <div v-show="!settFold.aicfg" class="fold-body" style="margin-top:10px">
        <div class="hint" style="margin-bottom:14px">对本站<b>所有 AI 功能</b>全局生效：AI 解析与追问 / 智能导入 / 拍照识题 / 教材出题（拍照与看图的<b>视觉模型</b>仍取「导入 → OCR 设置」）。留空则用服务端配置。</div>
        <div class="toolbar">
          <div class="field" style="margin:0;min-width:280px"><label>Base URL（留空用服务端）</label><input class="inp" v-model="explainCfg.base" @change="saveExplainCfg" placeholder="https://你的中转站/v1" /></div>
          <div class="field" style="margin:0;min-width:280px"><label>API Key（自定义 Base 时必填）</label><input class="inp" type="password" v-model="explainCfg.key" @change="saveExplainCfg" placeholder="sk-..." /></div>
          <div class="field" style="margin:0;min-width:220px"><label>模型（留空用服务端 AI_MODEL）</label><input class="inp" v-model="explainCfg.model" @change="saveExplainCfg" placeholder="gpt-4o / deepseek-v3 …" /></div>
        </div>
        <label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px;cursor:pointer"><input type="checkbox" v-model="explainStable" @change="saveExplainStable" style="width:auto;flex:none" /> 稳定模式（关闭流式）：某些模型或网络下流式易断（如 HTTP2 报错），开启后改用一次性返回，更稳但无逐字效果、需等全部生成</label>
        <div class="hint" style="margin-top:10px">⚠ 配置仅保存在你本机浏览器（localStorage）。自定义 Base 必须同时填该站的 Key，不会使用服务端密钥；公用电脑勿填，建议用额度受限的子 Key。</div>
        </div>
      </div>
      <div class="card" style="max-width:680px;margin-top:14px">
        <div class="fold-head" @click="settFold.offline=!settFold.offline"><span style="font-weight:700;font-size:15px">离线使用（地铁/通勤）</span><span class="fold-arrow" :class="{open:!settFold.offline}">▾</span></div>
        <div v-show="!settFold.offline" class="fold-body" style="margin-top:10px">
        <div class="hint" style="margin-bottom:14px">把全部题目和教材一次性下载到本机，之后<b>彻底断网也能刷全部题、翻全部书、用筛选</b>。离线作答会排队，联网后自动补传。建议先「添加到主屏幕」装成 App 再用。</div>
        <div class="row" style="gap:12px;align-items:center">
          <button class="btn" :disabled="offlineSyncing || offline" @click="offlineSync"><span v-if="offlineSyncing" class="spin"></span>{{ offlineSyncing ? '下载中…' : '下载全部供离线使用' }}</button>
          <button class="btn subtle" :disabled="exporting || offline" @click="exportBackup"><span v-if="exporting" class="spin"></span>{{ exporting ? '导出中…' : '导出数据备份 (JSON)' }}</button>
          <span v-if="offlineSyncing" class="muted">{{ offlineSyncMsg }}</span>
          <span v-else-if="offlineSynced" class="muted">已缓存 {{ offlineSynced.q }} 题 · {{ offlineSynced.m }} 页教材 · {{ new Date(offlineSynced.at).toLocaleString() }}</span>
          <span v-else class="muted">尚未下载离线包</span>
        </div>
        <div class="hint" style="margin-top:12px">题库更新后想让离线包同步，重新点一次即可覆盖。离线包存在本机浏览器，换设备需各自下载。</div>
        </div>
      </div>
      <div class="card" style="max-width:680px;margin-top:14px">
        <div class="fold-head" @click="settFold.subjects=!settFold.subjects"><span style="font-weight:700;font-size:15px">科目管理</span><span class="fold-arrow" :class="{open:!settFold.subjects}">▾</span></div>
        <div v-show="!settFold.subjects" class="fold-body" style="margin-top:10px">
        <div class="hint" style="margin-bottom:14px">在这里增删改科目;新增后,刷题、题库、导入等所有科目下拉会自动出现该科目。「关键词」用于导入与「智能归类」时自动判断科目(术语类,逗号分隔);代码 / 数学符号 / 英文等结构特征已内置在程序里,无需填写。</div>
        <div v-for="s in subjects" :key="s.v" class="subj-edit">
          <div class="subj-row">
            <span class="subj-code">{{ s.v }}</span>
            <input class="inp" style="width:140px" v-model="s.t" placeholder="科目名称" />
            <input class="inp" type="number" style="width:72px" v-model="s.sort" title="排序(小在前)" />
            <button class="btn subtle xs" @click="subjSave(s)">保存</button>
            <button class="bk-del xs" @click="subjDelete(s)">删除</button>
          </div>
          <input class="inp" style="width:100%;margin-top:6px" v-model="s.keywords" placeholder="自动判断关键词，逗号分隔（可留空）" />
        </div>
        <div class="subj-add">
          <div style="font-weight:600;font-size:13px;margin-bottom:8px">＋ 新增科目</div>
          <div class="subj-row">
            <input class="inp" style="width:130px" v-model="subjMgr.code" placeholder="代码 如 major" title="小写字母/数字/下划线" />
            <input class="inp" style="width:140px" v-model="subjMgr.name" placeholder="名称 如 专业课" />
            <input class="inp" type="number" style="width:72px" v-model="subjMgr.sort" placeholder="排序" />
            <button class="btn xs" :disabled="subjMgr.busy" @click="subjAdd"><span v-if="subjMgr.busy" class="spin"></span>新增</button>
          </div>
          <input class="inp" style="width:100%;margin-top:6px" v-model="subjMgr.keywords" placeholder="关键词，逗号分隔（可留空，之后也能改）" />
        </div>
        </div>
      </div>

      <div class="card" style="max-width:520px;margin-top:14px">
        <div class="field" style="margin-bottom:14px"><label>显示名称（浏览器标签页 + 页头）</label>
          <input class="inp" style="width:100%" v-model="appName" placeholder="例如：刷题 / 资料库 / 仪表盘 / 笔记" />
        </div>
        <div class="row" style="justify-content:space-between;margin-bottom:12px"><span style="font-weight:600">外观</span>
          <button class="btn subtle" @click="theme=theme==='light'?'dark':'light'">{{ theme==='light'?'深色模式 ☾':'浅色模式 ☀' }}</button>
        </div>
        <label class="row" style="cursor:pointer"><input type="checkbox" v-model="stealth.autoHide" /> <span class="muted">窗口失焦时自动隐藏（返回时恢复）</span></label>
        <div class="hint" style="margin-top:14px">快速隐藏：点击眼睛图标，或按 <code>&#96;</code>（1 左侧的按键）。再次按下或点击即可恢复。隐藏时显示 Vane 品牌页，点击任意位置恢复。</div>
      </div>
      <div class="muted" style="text-align:center;margin-top:28px;font-size:12px;opacity:.4">刷题文档 {{ appVer }}</div>
    </div>

  </div>

  <div v-if="reader.open && currentBook && currentPageMat" class="reader" :class="['t-'+reader.theme, {serif:reader.serif, 'bars-hidden':reader.barsHidden}]" :style="{'--rfs':reader.fontSize+'px','--rlh':reader.lineGap}">
    <div class="r-scroll" ref="readerScroll" @click="readerTap" @touchstart.passive="readerTouchStart" @touchend.passive="readerTouchEnd">
      <div class="r-wrap">
        <div class="r-head">
          <div class="rt">{{ pageLabel(currentPageMat) }}</div>
          <div class="rs">{{ subjName(currentPageMat.subject) }}<span v-if="currentPageMat.page"> · 第 {{ currentPageMat.page }} 页</span> · 第 {{ bookIdx+1 }} / {{ currentBook.pages.length }} 篇</div>
          <div v-if="currentPageMat.summary" class="rsum">{{ currentPageMat.summary }}</div>
        </div>
        <img v-if="currentPageMat.page_image" :src="currentPageMat.page_image" style="max-width:100%;height:auto;display:block;margin:0 auto 18px;border-radius:10px;border:1px solid var(--rline);background:#fff;padding:6px" />
        <div ref="rdBox" :class="{'seg-on':reader.segMode}" @click="readerSegClick"><rich-text :content="cleanPageMd(currentPageMat.content_md)" :key="currentPageMat.id" /></div>
      </div>
    </div>
    <div class="r-top">
      <button class="ricon" @click="readerClose" title="退出阅读">‹ 退出</button>
      <div class="rttl">{{ pageLabel(currentPageMat) }}</div>
      <button class="ricon" @click="reader.tocOpen=true" title="目录">☰</button>
      <button class="ricon" :style="reader.segMode?'color:var(--accent,#4f46e5)':''" @click="readerSegToggle" title="选段：点选段落/公式后合并复制或问 AI">📝</button>
      <button class="ricon" v-if="readerCanAi" @click="readerAskAI" title="就本页内容问 AI">✨</button>
      <button class="ricon" @click="reader.panel=!reader.panel; reader.barsHidden=false" title="字号 / 主题">Aa</button>
    </div>
    <div class="r-bot">
      <div class="rprog">第 <b>{{ bookIdx+1 }}</b> / {{ currentBook.pages.length }} 篇 · {{ Math.round((bookIdx+1)/currentBook.pages.length*100) }}%</div>
      <div class="rrow">
        <button class="rbtn" :disabled="bookIdx<=0" @click="readerPrev">← 上一篇</button>
        <button class="rbtn" :disabled="bookIdx>=currentBook.pages.length-1" @click="readerNext">下一篇 →</button>
      </div>
    </div>
    <div v-if="reader.segMode" class="seg-bar r-segbar">
      <span class="muted" style="font-size:12px">{{ reader.segCount? '已选 '+reader.segCount+' 块' : '点选虚线块（段落 / 公式 / 代码）' }}</span>
      <span style="flex:1"></span>
      <button class="rbtn" :disabled="!reader.segCount" @click="readerSegCopy">合并复制</button>
      <button class="rbtn" v-if="readerCanAi" :disabled="!reader.segCount" @click="readerAskAI">✨ 问 AI</button>
      <button class="rbtn" @click="readerSegToggle">✕</button>
    </div>
    <div v-if="pdfAi.open" class="r-panel-backdrop" @click="pdfAi.open=false"></div>
    <div class="r-ai" :class="{open:pdfAi.open}">
      <div class="rai-h"><b>✨ 问 AI · 第 {{ pdfv.cur }} 页</b><span style="flex:1"></span>
        <button class="ricon" v-if="pdfAi.chat.length" @click="pdfAi.chat=[]" title="清空对话">🗑</button>
        <button class="ricon" @click="pdfAi.open=false">✕</button></div>
      <div class="rai-quote" v-if="pdfAi.pageAtOpen && pdfAi.pageAtOpen!==pdfv.cur">提示：你已翻到第 {{ pdfv.cur }} 页，提问将针对当前页</div>
      <div class="rai-list">
        <div v-for="(c,i) in pdfAi.chat" :key="'pai'+i" class="rai-item">
          <div class="rai-q">🙋 {{ c.q }} <span class="muted" style="font-size:11px">· 第{{ c.page }}页</span></div>
          <rich-text v-if="c.a" :content="c.a" /><span v-else class="spin"></span>
          <div v-if="c.err && !pdfAi.asking" style="text-align:right;margin-top:6px"><button class="rbtn" @click="pdfAiRetry(i)">⟳ 重试</button></div>
        </div>
        <div v-if="!pdfAi.chat.length" class="muted" style="font-size:13px;padding:6px 0">就本页 PDF 内容提问，例如：这页在讲什么？帮我总结要点。（扫描图 PDF 无文字层时无法提取）</div>
      </div>
      <div class="rai-in">
        <input ref="pdfAiInp" v-model="pdfAi.input" :disabled="pdfAi.asking" placeholder="就第 {{ pdfv.cur }} 页提问（Enter 发送）…" @keyup.enter="pdfAiSend" />
        <button class="rbtn" :disabled="pdfAi.asking||!pdfAi.input.trim()" @click="pdfAiSend"><span v-if="pdfAi.asking" class="spin"></span>{{ pdfAi.asking?'回答中':'发送' }}</button>
      </div>
    </div>
    <div v-if="rdAi.open" class="r-panel-backdrop" @click="rdAi.open=false"></div>
    <div class="r-ai" :class="{open:rdAi.open}">
      <div class="rai-h"><b>✨ 问 AI · 本页</b><span style="flex:1"></span>
        <button class="ricon" v-if="rdAi.chat.length||rdAi.quote" @click="rdAi.chat=[]; rdAi.quote=''" title="清空对话与引用">🗑</button>
        <button class="ricon" @click="rdAi.open=false">✕</button></div>
      <div v-if="rdAi.quote" class="rai-quote">已引用选段：{{ rdAi.quote.slice(0,120) }}{{ rdAi.quote.length>120?'…':'' }}</div>
      <div class="rai-list">
        <div v-for="(c,i) in rdAi.chat" :key="'rai'+i" class="rai-item">
          <div class="rai-q">🙋 {{ c.q }}</div>
          <rich-text v-if="c.a" :content="c.a" /><span v-else class="spin"></span>
          <div v-if="c.err && !rdAi.asking" style="text-align:right;margin-top:6px"><button class="rbtn" @click="rdAiRetry(i)">⟳ 重试</button></div>
        </div>
        <div v-if="!rdAi.chat.length" class="muted" style="font-size:13px;padding:6px 0">就本页内容或选段提问，例如：这段在讲什么？这个公式怎么来的？</div>
      </div>
      <div class="rai-in">
        <input ref="rdAiInp" v-model="rdAi.input" :disabled="rdAi.asking" placeholder="就本页 / 选段提问（Enter 发送）…" @keyup.enter="rdAiSend" />
        <button class="rbtn" :disabled="rdAi.asking||!rdAi.input.trim()" @click="rdAiSend"><span v-if="rdAi.asking" class="spin"></span>{{ rdAi.asking?'回答中':'发送' }}</button>
      </div>
    </div>
    <div v-if="reader.panel" class="r-panel-backdrop" @click="reader.panel=false"></div>
    <div class="r-panel" :class="{open:reader.panel}">
      <div class="pr"><span class="lbl">字号</span><div class="step"><button @click="readerFont(-1)">A−</button><span class="val">{{ reader.fontSize }} px</span><button @click="readerFont(1)">A+</button></div></div>
      <div class="pr"><span class="lbl">行距</span><div class="seg"><button :class="{on:reader.lineGap===1.6}" @click="readerSetGap(1.6)">紧凑</button><button :class="{on:reader.lineGap===1.9}" @click="readerSetGap(1.9)">适中</button><button :class="{on:reader.lineGap===2.3}" @click="readerSetGap(2.3)">宽松</button></div></div>
      <div class="pr"><span class="lbl">字体</span><div class="seg"><button :class="{on:!reader.serif}" @click="readerSetSerif(false)">黑体</button><button :class="{on:reader.serif}" @click="readerSetSerif(true)">宋体</button></div></div>
      <div class="pr"><span class="lbl">主题</span><div class="seg" style="gap:14px"><span class="sw paper" :class="{on:reader.theme==='paper'}" @click="readerSetTheme('paper')" title="纸白"></span><span class="sw sepia" :class="{on:reader.theme==='sepia'}" @click="readerSetTheme('sepia')" title="米黄"></span><span class="sw green" :class="{on:reader.theme==='green'}" @click="readerSetTheme('green')" title="护眼绿"></span><span class="sw night" :class="{on:reader.theme==='night'}" @click="readerSetTheme('night')" title="夜间"></span></div></div>
    </div>
    <div v-if="reader.tocOpen" class="r-toc-backdrop" @click="reader.tocOpen=false"></div>
    <div class="r-toc" :class="{open:reader.tocOpen}">
      <h4>目录 <span style="color:var(--rsoft);font-weight:400;margin-left:6px">{{ currentBook.pages.length }} 篇</span><button class="ricon" style="margin-left:auto" @click="reader.tocOpen=false">✕</button></h4>
      <div class="list">
        <div v-for="(m,i) in currentBook.pages" :key="m.id" :class="{on:i===bookIdx}" @click="readerGoto(i)">{{ pageLabel(m) }}</div>
      </div>
    </div>
  </div>

  <div v-if="extractPreview.open" class="modal-mask" @click.self="extractClose">
    <div class="modal" style="max-width:860px;width:94vw">
      <div class="modal-h"><b>抽题预览 · {{ extractPreview.title }}</b><button class="toc-close" @click="extractClose">✕</button></div>
      <div class="modal-b">
        <div class="row" style="gap:14px;align-items:center;flex-wrap:wrap;margin-bottom:10px">
          <span>共解析 <b>{{ extractPreview.items.length }}</b> 题，已勾选 <b>{{ extractUseCount() }}</b> 题导入</span>
          <span v-if="extractPreview.dup" class="muted">（已自动去重 {{ extractPreview.dup }} 题）</span>
          <span v-if="extractMissingCount()" class="muted" style="color:var(--bad)">其中 {{ extractMissingCount() }} 题没抽到答案</span>
          <button v-if="extractPreview.items.some(q=>!(q.answer&&q.answer.length))" class="btn subtle xs" @click="extractToggleMissing">勾选/取消「无答案」的题</button>
          <span class="muted" style="font-size:12px">提示：计算/证明题按「简答题」入库；导入后仍可在「题库」编辑修改。</span>
        </div>
        <div class="prev-list">
          <div v-for="(q,i) in extractPreview.items" :key="i" class="prev-item" :class="{off:!q._use, noans:!(q.answer&&q.answer.length)}">
            <label class="prev-ck"><input type="checkbox" v-model="q._use" /></label>
            <div class="prev-body">
              <div class="prev-meta"><span class="tag2">{{ typeName(q.type) }}</span><span v-if="q.chapter" class="muted" style="font-size:12px">{{ q.chapter }}</span><span v-if="!(q.answer&&q.answer.length)" class="tag" style="color:var(--bad);border-color:var(--bad)">无答案</span></div>
              <div class="prev-q"><span class="prev-lab">题干</span><rich-text :content="q.stem || '（空）'" /></div>
              <div v-if="q.options&&q.options.length" class="prev-opts"><span v-for="o in q.options" :key="o.key" class="prev-opt"><b>{{ o.key }}.</b> {{ o.text }}</span></div>
              <div v-if="q.answer&&q.answer.length" class="prev-q"><span class="prev-lab ans">答案</span><rich-text :content="ansLines(q)" /></div>
              <div v-if="q.page" class="muted" style="font-size:11.5px;margin-top:6px;opacity:.8">📄 出自第 {{ q.page }} 页</div>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-f">
        <span v-if="bookExtract.busy" class="muted">{{ bookExtract.prog }}</span>
        <button class="btn subtle" :disabled="bookExtract.busy" @click="extractClose">取消</button>
        <button class="btn" :disabled="bookExtract.busy || !extractUseCount()" @click="extractDoImport"><span v-if="bookExtract.busy" class="spin"></span>导入勾选的 {{ extractUseCount() }} 题（不花 AI）</button>
      </div>
    </div>
  </div>

  <div v-if="toast" class="toast" :class="{err:toast.err}">{{ toast.msg }}</div>
  <div v-if="stealth.hidden" class="stealth" @click="stealthShow">
    <div class="stealth-vane">Vane</div>
  </div>
  `;
