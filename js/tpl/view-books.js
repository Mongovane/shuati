// 模板分片「TPL_VIEW_BOOKS」——由 tools/split-template.mjs 从单体 app-template.js 拆出。
// 直接编辑本文件即可；js/app-template.js 按固定顺序装配，勿在分片间搬动结构边界。
const TPL_VIEW_BOOKS = `
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
        <div v-if="pdfv.open" class="pdfv" :class="{inv: pdfv.invert, 'bars-off': pdfv.barsOff}" style="margin-top:14px">
          <div class="pdfv-bar">
            <div class="ttl">{{ pdfv.title }}</div>
            <div class="bk-nav">
              <button :disabled="pdfv.cur<=1" @click="pdfvPrev">← 上一页</button>
              <button :disabled="pdfv.cur>=pdfv.pages" @click="pdfvNext">下一页 →</button>
            </div>
            <span class="muted">{{ pdfv.cur }} / {{ pdfv.pages }}</span>
            <input class="bk-jump inp" type="number" min="1" :max="pdfv.pages" @keyup.enter="pdfvGoto($event.target.value)" placeholder="跳页" />
            <button v-if="!pdfvMobile" class="btn subtle" @click="pdfvTocOpen=true" title="目录">☰ 目录</button>
            <button v-if="!pdfvMobile" class="btn subtle" :style="pdfv.invert?'color:var(--accent,#4f46e5);border-color:var(--accent,#4f46e5)':''" @click="pdfvToggleInvert" title="夜间反色">🌙</button>
            <div class="pdfv-zoom"><button @click="pdfvZoom(-0.2)">−</button><span>{{ Math.round(pdfv.scale*100) }}%</span><button @click="pdfvZoom(0.2)">+</button></div>
            <button v-if="!pdfvMobile" class="btn subtle" @click="pdfvToggleMode" :title="pdfv.mode==='scroll'?'切换为单页模式':'切换为连续滚动'">{{ pdfv.mode==='scroll' ? '单页' : '连续' }}</button>
            <button class="btn subtle" @click="pdfAiOpen" title="就当前页内容问 AI">✨ 问 AI</button>
            <button class="btn subtle" @click="pdfvClose">关闭</button>
          </div>
          <div class="pdfv-body" :class="{'one-col': pdfv.mode==='page'}" @touchstart="pdfvTouchStart" @touchmove="pdfvTouchMove" @touchend="pdfvTouchEnd">
            <div class="pdfv-rail" ref="pdfvRail" v-if="pdfv.mode==='scroll'">
              <div v-for="n in pdfv.pages" :key="n" class="pdfv-thumb" :class="{on:n===pdfv.cur}" :data-page="n" @click="pdfvGoto(n)"><canvas></canvas><span>{{ n }}</span></div>
            </div>
            <div class="pdfv-main" ref="pdfvMain" v-if="pdfv.mode==='scroll'">
              <div v-for="n in pdfv.pages" :key="n" class="pdfv-page" :data-page="n"><canvas></canvas></div>
            </div>
            <div class="pdfv-single" v-if="pdfv.mode==='page'"><canvas ref="pdfvSingle"></canvas></div>
          </div>
          <div class="pdfv-slider" v-if="pdfvMobile && pdfv.pages>3">
            <input type="range" min="1" :max="pdfv.pages" :value="pdfvSliderTip || pdfv.cur" @input="pdfvSliderShow($event.target.value)" @change="pdfvGoto($event.target.value); pdfvSliderHide()" />
            <span v-if="pdfvSliderTip" class="pdfv-slider-tip">{{ pdfvSliderTip }} / {{ pdfv.pages }}</span>
          </div>
          <div class="pdfv-foot" :class="{ic:pdfvMobile}">
            <button v-if="pdfvMobile" class="pf-ic" @click="pdfvTocOpen=true" title="目录">☰</button>
            <button class="pf-ic pf-nav" :disabled="pdfv.cur<=1" @click="pdfvPrev" title="上一页">‹</button>
            <span class="muted pf-pg">{{ pdfv.cur }} <i>/</i> {{ pdfv.pages }}</span>
            <button class="pf-ic pf-nav" :disabled="pdfv.cur>=pdfv.pages" @click="pdfvNext" title="下一页">›</button>
            <button class="pf-ic" @click="pdfvToggleInvert" :style="pdfv.invert?'color:var(--accent,#4f46e5)':''" title="夜间反色">🌙</button>
            <button class="pf-ic" @click="pdfAiOpen" title="就当前页问 AI">✨</button>
          </div>
          <div class="pdfv-drawer" :class="{open:pdfvTocOpen}">
            <div class="pdfv-drawer-h"><b>目录</b><span class="muted" style="margin-left:6px">{{ pdfv.outline.length? pdfv.outline.length+' 章节' : ('共 '+pdfv.pages+' 页') }}</span><button class="toc-close" @click="pdfvTocOpen=false" style="margin-left:auto">✕</button></div>
            <input class="inp pdfv-drawer-jump" type="number" min="1" :max="pdfv.pages" @keyup.enter="pdfvGoto($event.target.value); pdfvTocOpen=false" placeholder="输入页码跳转" style="margin:0 12px 8px;width:calc(100% - 24px)" />
            <div class="pdfv-drawer-list" ref="pdfvTocList">
              <template v-if="pdfv.outline.length">
                <div v-for="(o,oi) in pdfv.outline" :key="'ol'+oi" class="toc-row" :class="{on: o.page<=pdfv.cur && (oi===pdfv.outline.length-1 || pdfv.outline[oi+1].page>pdfv.cur)}" :style="{paddingLeft:(14+o.level*16)+'px'}" @click="pdfvGoto(o.page); pdfvTocOpen=false"><span class="toc-t">{{ o.title }}</span><span class="toc-p">{{ o.page }}</span></div>
              </template>
              <template v-else>
                <div v-for="n in pdfv.pages" :key="n" :class="{on:n===pdfv.cur}" @click="pdfvGoto(n); pdfvTocOpen=false">第 {{ n }} 页</div>
              </template>
            </div>
          </div>
          <div v-if="pdfvTocOpen" class="pdfv-backdrop" @click="pdfvTocOpen=false"></div>
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
                <span v-if="bookReadPct(b)" class="bk-pct">{{ bookReadPct(b) }}</span>
                <span class="spine"></span>
                <span class="t">{{ b.title }}</span>
                <span class="m">{{ b.pages.length }} 页</span>
              </button>
            </div>
          </div>
        </template>
        <div v-if="currentBook && currentPageMat" class="bk-reader" :class="{'toc-collapsed':!bookTocOpen,'toc-open':bookTocOpen}">
          <aside class="bk-toc">
            <h4>目录 <span class="muted">{{ bookOutline.length ? bookOutline.length+' 章节' : currentBook.pages.length+' 篇' }}</span><button class="toc-close" @click="bookTocOpen=false" title="关闭">✕</button></h4>
            <template v-if="bookOutline.length">
              <div class="tip">按书本目录页解析，点击跳到对应页</div>
              <div v-for="(o,oi) in bookOutline" :key="'bo'+oi" class="toc-row" :style="{paddingLeft:(14+o.level*16)+'px'}" @click="bookGotoBookPage(o.page)"><span class="toc-t">{{ o.title }}</span><span class="toc-p">{{ o.page }}</span></div>
            </template>
            <template v-else>
              <div class="tip">按每页正文标题/首行生成，点击跳转</div>
              <div v-for="(m,i) in currentBook.pages" :key="m.id" class="bk-toc-item" :class="{on:i===bookIdx}" @click="bookGoto(i); bookTocOpen = (window.innerWidth>860)">{{ pageLabel(m) }}</div>
            </template>
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
              <button v-if="readerCanAi" class="bk-toctoggle" @click="bookAskAI" title="就本篇内容问 AI">✨ 问 AI</button>
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
        <div v-if="rdAi.open && !reader.open" class="bk-inline-backdrop" @click="rdAi.open=false"></div>
        <div v-if="!reader.open" class="r-ai bk-inline-ai" :class="{open:rdAi.open}">
          <div class="rai-h"><b>✨ 问 AI · 本页</b><span style="flex:1"></span>
            <button class="ricon" v-if="rdAi.chat.length||rdAi.quote" @click="rdAi.chat=[]; rdAi.quote=''" title="清空对话与引用">🗑</button>
            <button class="ricon" @click="rdAi.open=false">✕</button></div>
          <div v-if="rdAi.quote" class="rai-quote">已引用选段：{{ rdAi.quote.slice(0,120) }}{{ rdAi.quote.length>120?'…':'' }}</div>
          <div class="rai-list">
            <div v-for="(c,i) in rdAi.chat" :key="'brai'+i" class="chat-round">
              <div class="chat-bub chat-q"><div class="chat-tag">🙋 你</div>{{ c.q }}</div>
              <div v-if="c.a" class="chat-bub chat-a"><div class="chat-tag">✨ AI</div><rich-text :content="c.a" />
                <div v-if="c.err && !rdAi.asking" style="text-align:right;margin-top:6px"><button class="rbtn" style="flex:none;padding:4px 14px" @click="rdAiRetry(i)">⟳ 重试</button></div>
              </div>
              <div v-else class="chat-bub chat-a"><span class="spin"></span></div>
            </div>
            <div v-if="!rdAi.chat.length" class="muted" style="font-size:13px;padding:6px 0">就本页内容提问，例如：这页在讲什么？这个公式怎么来的？</div>
          </div>
          <div class="rai-in">
            <input ref="rdAiInpInline" v-model="rdAi.input" :disabled="rdAi.asking" placeholder="就本页提问（Enter 发送）…" @keyup.enter="rdAiSend" />
            <button v-if="rdAi.asking" class="rbtn" @click="rdAiStop" title="停止本次回答">■ 停止</button>
            <button v-else class="rbtn" :disabled="!rdAi.input.trim()" @click="rdAiSend">发送</button>
          </div>
        </div>
      </template>
      </div>
    </div>
`;
