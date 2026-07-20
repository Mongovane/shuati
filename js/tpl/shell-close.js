// 模板分片「TPL_SHELL_CLOSE」——由 tools/split-template.mjs 从单体 app-template.js 拆出。
// 直接编辑本文件即可；js/app-template.js 按固定顺序装配，勿在分片间搬动结构边界。
const TPL_SHELL_CLOSE = `
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
      <button class="ricon" @click="readerTocShow" title="目录">☰</button>
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
        <div v-if="rdAi.open" class="r-panel-backdrop" @click="rdAi.open=false"></div>
    <div class="r-ai" :class="{open:rdAi.open}">
      <div class="rai-h"><b>✨ 问 AI · 本页</b><span style="flex:1"></span>
        <button class="ricon" v-if="rdAi.chat.length||rdAi.quote" @click="rdAi.chat=[]; rdAi.quote=''" title="清空对话与引用">🗑</button>
        <button class="ricon" @click="rdAi.open=false">✕</button></div>
      <div v-if="rdAi.quote" class="rai-quote">已引用选段：{{ rdAi.quote.slice(0,120) }}{{ rdAi.quote.length>120?'…':'' }}</div>
      <div class="rai-list">
        <div v-for="(c,i) in rdAi.chat" :key="'rai'+i" class="chat-round">
          <div class="chat-bub chat-q"><div class="chat-tag">🙋 你</div>{{ c.q }}</div>
          <div v-if="c.a" class="chat-bub chat-a"><div class="chat-tag">✨ AI</div><rich-text :content="c.a" />
            <div v-if="c.err && !rdAi.asking" style="text-align:right;margin-top:6px"><button class="rbtn" style="flex:none;padding:4px 14px" @click="rdAiRetry(i)">⟳ 重试</button></div>
          </div>
          <div v-else class="chat-bub chat-a"><span class="spin"></span></div>
        </div>
        <div v-if="!rdAi.chat.length" class="muted" style="font-size:13px;padding:6px 0">就本页内容或选段提问，例如：这段在讲什么？这个公式怎么来的？</div>
      </div>
      <div class="rai-in">
        <input ref="rdAiInp" v-model="rdAi.input" :disabled="rdAi.asking" placeholder="就本页 / 选段提问（Enter 发送）…" @keyup.enter="rdAiSend" />
        <button v-if="rdAi.asking" class="rbtn" @click="rdAiStop" title="停止本次回答">■ 停止</button>
        <button v-else class="rbtn" :disabled="!rdAi.input.trim()" @click="rdAiSend">发送</button>
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

  <div v-if="pdfAi.open" class="pdf-ai-backdrop" @click="pdfAi.open=false"></div>
    <div class="r-ai pdf-ai" :class="{open:pdfAi.open}">
      <div class="rai-h"><b>✨ 问 AI · 第 {{ pdfv.cur }} 页</b><span style="flex:1"></span>
        <button class="ricon" v-if="pdfAi.chat.length" @click="pdfAi.chat=[]" title="清空对话">🗑</button>
        <button class="ricon" @click="pdfAi.open=false">✕</button></div>
      <div class="rai-quote" v-if="pdfAi.pageAtOpen && pdfAi.pageAtOpen!==pdfv.cur">提示：你已翻到第 {{ pdfv.cur }} 页，提问将针对当前页</div>
      <div class="rai-list">
        <div v-for="(c,i) in pdfAi.chat" :key="'pai'+i" class="chat-round">
          <div class="chat-bub chat-q"><div class="chat-tag">🙋 你 · 第{{ c.page }}页</div>{{ c.q }}</div>
          <div v-if="c.a" class="chat-bub chat-a"><div class="chat-tag">✨ AI</div><rich-text :content="c.a" />
            <div v-if="c.err && !pdfAi.asking" style="text-align:right;margin-top:6px"><button class="rbtn" style="flex:none;padding:4px 14px" @click="pdfAiRetry(i)">⟳ 重试</button></div>
          </div>
          <div v-else class="chat-bub chat-a"><span class="spin"></span></div>
        </div>
        <div v-if="!pdfAi.chat.length" class="muted" style="font-size:13px;padding:6px 0">就本页 PDF 内容提问，例如：这页在讲什么？帮我总结要点。（文字版直接读取；扫描版会自动识图，稍慢些）</div>
      </div>
      <div class="rai-in">
        <input ref="pdfAiInp" v-model="pdfAi.input" :disabled="pdfAi.asking" :placeholder="'就第 '+pdfv.cur+' 页提问（Enter 发送）…'" @keyup.enter="pdfAiSend" />
        <button v-if="pdfAi.asking" class="rbtn" @click="pdfAiStop" title="停止本次回答">■ 停止</button>
        <button v-else class="rbtn" :disabled="!pdfAi.input.trim()" @click="pdfAiSend">发送</button>
      </div>
    </div>

    <div v-if="printW.items.length" class="print-area">
      <h2 style="margin:0 0 4px">错题卷 · {{ subjName(f.subject==='all'?'':f.subject)||'全部科目' }} · 共 {{ printW.items.length }} 题</h2>
      <p class="pmeta">{{ new Date().toLocaleDateString() }} · 姓名____________ · 得分______</p>
      <div v-for="(q,i) in printW.items" :key="q.id" class="pq">
        <div class="pq-h">{{ i+1 }}. <span class="pq-t">〔{{ typeMap[q.type]||q.type }}〕</span></div>
        <div v-if="q.passage" class="pq-passage"><rich-text :content="q.passage" /></div>
        <rich-text :content="q.stem" />
        <div v-for="o in (q.options||[])" :key="o.key" class="pq-opt"><b>{{ o.key }}.</b> <rich-text class="pq-opt-t" :content="o.text" /></div>
        <div class="pq-blank" v-if="q.type==='fill_blank'||q.type==='short_answer'||q.type==='code'"></div>
      </div>
      <template v-if="printW.withAns">
        <div class="pq-ans-h">参考答案</div>
        <div class="pq-ans">
          <span v-for="(q,i) in printW.items" :key="'a'+q.id" class="pq-ans-i"><b>{{ i+1 }}.</b> {{ (q.answer||[]).map(a=>String(a).split('||').join(' ⁄ ')).join('、').slice(0,80) }}</span>
        </div>
      </template>
    </div>
    <div v-if="toast" class="toast" :class="{err:toast.err}">{{ toast.msg }}</div>
  <button v-show="showTop" class="fab-top" @click="scrollTop" title="回到顶部" aria-label="回到顶部">↑</button>
  <div v-if="stealth.hidden" class="stealth" @click="stealthShow">
    <div class="stealth-vane">Vane</div>
  </div>
  `;
