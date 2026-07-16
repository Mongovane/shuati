// 模板分片「TPL_VIEW_INGEST」——由 tools/split-template.mjs 从单体 app-template.js 拆出。
// 直接编辑本文件即可；js/app-template.js 按固定顺序装配，勿在分片间搬动结构边界。
const TPL_VIEW_INGEST = `
    <div v-else-if="view==='ingest'">
      <h2 style="margin:.2em 0 .5em">导入</h2>
      <div class="seg" style="margin-bottom:14px">
        <button :class="{on:ingest.tab==='manual'}" @click="ingest.tab='manual'">手动录入</button>
        <button :class="{on:ingest.tab==='photo'}" @click="ingest.tab='photo'">拍照辅助</button>
        <button :class="{on:ingest.tab==='json'}" @click="ingest.tab='json'">导入 JSON</button>
        <button :class="{on:ingest.tab==='excel'}" @click="ingest.tab='excel'">Excel/CSV</button>
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
      <template v-if="ingest.tab==='excel'">
        <div class="card">
          <p class="muted" style="margin:0 0 10px">上传 .xlsx / .xls / .csv，表头需含「题干」，其余列（题型 / 答案 / 选项A…H / 科目 / 章节 / 解析 / 难度 / 标签 / 材料）可选。本机解析、预览确认后入库；选择题答案写 A 或 AC，判断写 对/错，填空多写法用「；」分隔。</p>
          <div class="row" style="gap:12px;flex-wrap:wrap;align-items:flex-end">
            <div class="field" style="max-width:220px"><label>默认科目（表格没有科目列时）</label>
              <select v-model="ingest.subject"><option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option></select></div>
            <input ref="xlsxFile" type="file" accept=".xlsx,.xls,.csv" style="display:none" @change="onXlsxFile" />
            <button class="btn" :disabled="ingest.xl.busy" @click="$refs.xlsxFile.click()"><span v-if="ingest.xl.busy" class="spin"></span>选择表格文件</button>
            <span v-if="ingest.xl.name" class="muted">{{ ingest.xl.name }}</span>
          </div>
          <template v-if="ingest.xl.rows.length">
            <div class="hint" style="margin-top:12px">解析到 <b>{{ ingest.xl.rows.length }}</b> 题，前 3 题预览：</div>
            <div v-for="(q,i) in ingest.xl.rows.slice(0,3)" :key="i" class="bank-item" style="margin-top:8px"><div class="bank-main"><div class="bank-meta"><span class="tag">{{ subjName(q.subject) }}</span><span class="tag2">{{ typeMap[q.type]||q.type }}</span><span v-if="q.chapter" class="tag2">{{ q.chapter }}</span></div><div class="bank-stem">{{ q.stem.slice(0,90) }}</div></div></div>
            <div v-if="ingest.xl.issues.length" class="hint" style="margin-top:10px;color:var(--bad)">注意：<br/><span v-for="(x,i) in ingest.xl.issues" :key="'i'+i">· {{ x }}<br/></span></div>
            <button class="btn" style="margin-top:12px" :disabled="ingest.busy" @click="importXlsx"><span v-if="ingest.busy" class="spin"></span>确认导入 {{ ingest.xl.rows.length }} 题</button>
          </template>
          <div v-else-if="ingest.xl.done" class="hint" style="margin-top:12px">✅ 导入完成，可去「题库」查看，或继续选择下一张表。</div>
        </div>
      </template>

      <template v-if="ingest.tab==='manual' || ingest.tab==='photo'">
        <div v-if="ingest.tab==='photo'" class="card" style="margin-bottom:14px">
          <label class="btn subtle" style="cursor:pointer">拍摄 / 选择照片
            <input type="file" accept="image/*" capture="environment" @change="onPhotoFile" style="display:none" />
          </label>
          <div class="hint">照片先存本机。「AI OCR」发给你的视觉模型识题入库；模型不支持图片就用「本地 OCR 存为教材」，全程本机、零额度。</div>
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
        <div class="hint">结构化 JSON 直接入库：不走 AI，零成本。</div>
        <div class="row" style="margin-top:12px"><button class="btn" :disabled="ingest.busy" @click="saveManual"><span v-if="ingest.busy" class="spin"></span>免费保存题目</button><button class="btn subtle" @click="resetManual">清空</button></div>
      </template>
      <template v-else-if="ingest.tab==='ai'">
        <textarea v-model="ingest.raw" placeholder="粘贴任意原文：可以是杂乱的题目，也可以是教材正文。AI 会自动分辨——是题目就结构化进题库，是教材就整理成知识点笔记进「教材阅读」。此功能消耗 AI 中转额度。"></textarea>
        <div class="hint">「自动分辨」由 AI 判断题库/教材分别入库，也可强制其一。想零成本：用手动录入、JSON 或 Excel。</div>
        <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:8px"><button class="btn" :disabled="ingest.busy || ingest.local.busy" @click="doIngest"><span v-if="ingest.busy" class="spin"></span>用 AI 整理并导入</button><button class="btn subtle" :disabled="ingest.busy || ingest.local.busy" @click="saveTextAsMaterial"><span v-if="ingest.local.busy" class="spin"></span>不调用 AI，直接存为教材</button></div>
        <div class="hint" v-if="ingest.local.busy || ingest.local.prog">{{ ingest.local.prog || '处理中…' }}</div>
      </template>
      <template v-else-if="ingest.tab==='json'">
        <textarea class="code" v-model="ingest.json" placeholder='Paste a JSON array, e.g. [{"subject":"computer","type":"single_choice","stem":"...","options":[{"key":"A","text":"..."}],"answer":["B"]}]'></textarea>
        <div class="hint">已有结构化题目用这里，零 AI 成本；格式见 README。</div>
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
        <div class="hint">扫描版选 OCR 引擎：中转站视觉模型最准（计费）；Scribe / tesseract 免费本地但公式弱；Workers AI 走免费额度（每天约 {{ cfocr.limit }} 页）。公式输出 LaTeX。先拿 1–3 页试效果。</div>
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
              <div class="hint" style="margin-top:6px">⚠ Key 只存本机、经本站转发到你的中转站。公用电脑别填，建议用限额子 Key；留空用服务端配置。</div>
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
        <textarea v-if="ingest.pdf.extracted" class="code" style="margin-top:10px" v-model="ingest.pdf.extracted" placeholder="提取出的 PDF 文本会显示在这里"></textarea><div class="hint" style="margin-top:10px">文字 PDF：复制文本给「AI 整理」；扫描版：直接「AI OCR 当前页范围」。</div>
      </template>
      <template v-else-if="ingest.tab==='md'">
        <label class="btn subtle" style="cursor:pointer">选择 Markdown 文件（可多选）
          <input type="file" accept=".md,.markdown,text/markdown" multiple @change="onMdFiles" style="display:none" />
        </label>
        <span v-if="ingest.mdFiles.length" class="muted" style="margin-left:10px">已选 {{ ingest.mdFiles.length }} 个文件</span>
        <div class="hint">选入本地转好的章节 Markdown，按「## 第 N 页」自动拆页进 Books——免费、文本干净。</div>
        <div class="hint">书名取上方「教材名称」，多文件按页码并成一本。引用 <code>public/textbooks-pages/…</code> 的原图需随部署放进 <code>public/</code>。</div>
        <div class="row" style="margin-top:12px;flex-wrap:wrap;gap:8px">
          <button class="btn" :disabled="ingest.local.busy || !ingest.mdFiles.length" @click="importMarkdown"><span v-if="ingest.local.busy" class="spin"></span>导入到 Books</button>
        </div>
        <div class="hint" v-if="ingest.local.busy || ingest.local.prog">{{ ingest.local.prog || '处理中…' }} · {{ ingest.local.done }}/{{ ingest.local.total || 0 }}</div>
      </template>
      <template v-else-if="ingest.tab==='mineru'">
        <label class="btn subtle" style="cursor:pointer">选择 PDF<input type="file" accept="application/pdf,.pdf" @change="onMineruFile" style="display:none" /></label>
        <span v-if="ingest.mineru.name" class="muted" style="margin-left:10px">{{ ingest.mineru.name }}</span>
        <div class="hint">MinerU 云端把整本 PDF 转成高质量 Markdown（公式 LaTeX）按段入 Books，最适合公式书。需在 Cloudflare 配 <code>MINERU_API_KEY</code>（「API 管理 → 创建 Token」，不是 Access Key）。按 MinerU 额度计费，书名取上方「教材名称」。</div>
        <div class="field" style="margin-top:8px;max-width:420px"><label>模式</label><select v-model="ingest.mineru.mode"><option value="agent">免 Token 轻量（≤10MB·≤20页·公式较弱·现在就能用）</option><option value="precise">精准 vlm（需 Token·≤200MB·≤200页·公式最好）</option></select></div>
        <div class="field" style="margin-top:8px;max-width:340px"><label>页码范围（轻量≤20页不支持逗号；精准留空=整本自动按200页分段连跑）</label><input class="inp" v-model="ingest.mineru.pageRange" placeholder="轻量如 1-20；精准留空=整本，或填 1-200" /></div>
        <div class="hint" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:16px;align-items:center">
          <span>今日已用（本工具统计）：<b :style="(Number(mineruCfg.pageLimit)>0 && mineruUsageView.pages>=Number(mineruCfg.pageLimit))?'color:var(--bad)':''">{{ mineruUsageView.pages }}</b> / {{ mineruCfg.pageLimit||'∞' }} 页 · {{ mineruUsageView.files }} / {{ mineruCfg.fileLimit||'∞' }} 文件</span>
          <span v-if="mineruTokenDays()!=null" :style="mineruTokenDays()<=7?'color:var(--bad);font-weight:600':''">⏳ Token 还有 {{ mineruTokenDays() }} 天过期</span>
          <a href="#" @click.prevent="view='settings'" style="color:var(--accent)">配额 / Token 设置 ›</a>
        </div>
        <div v-if="mineruTokenDays()!=null && mineruTokenDays()<=7" class="hint" style="color:var(--bad);background:color-mix(in srgb,var(--bad) 8%,transparent);border:1px solid color-mix(in srgb,var(--bad) 35%,var(--line));border-radius:8px;padding:8px 10px;margin-top:6px">Token {{ mineruTokenDays()<0?'已过期':'即将过期' }}：MinerU 不支持续期，请去控制台「API 管理 → 创建 Token」重建，把新 Token 填到 Cloudflare Pages 环境变量 <code>MINERU_API_KEY</code> 后重新部署（应用无法自动创建）。</div>
        <div v-if="mineruTokenBad" class="hint" style="color:var(--bad);background:color-mix(in srgb,var(--bad) 10%,transparent);border:1px solid color-mix(in srgb,var(--bad) 45%,var(--line));border-radius:8px;padding:8px 10px;margin-top:6px"><b>MinerU Token 已过期/无效</b>（A0211/A0202）：控制台重建 Token → 更新 <code>MINERU_API_KEY</code> → 重新部署。<a href="#" @click.prevent="mineruTokenOk()" style="color:var(--accent);margin-left:6px">我已更新，清除提示</a></div>
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
`;
