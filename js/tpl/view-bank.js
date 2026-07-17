// 模板分片「TPL_VIEW_BANK」——由 tools/split-template.mjs 从单体 app-template.js 拆出。
// 直接编辑本文件即可；js/app-template.js 按固定顺序装配，勿在分片间搬动结构边界。
const TPL_VIEW_BANK = `
    <div v-else-if="view==='bank'">
      <div class="filters">
        <div class="field"><label>科目</label>
          <select v-model="bank.subject" @change="loadBank(true)"><option value="">全部科目</option><option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option></select></div>
        <div class="field"><label>题型</label>
          <select v-model="bank.type" @change="loadBank(true)"><option value="">全部题型</option><option v-for="t in types" :key="t.v" :value="t.v">{{ t.t }}</option></select></div>
        <div class="field" style="flex:1;min-width:180px"><label>关键词</label>
          <input class="inp" v-model="bank.kw" @keyup.enter="loadBank(true)" placeholder="搜题干 / 章节，回车搜索" /></div>
        <div class="field" style="min-width:120px"><label>标签</label>
          <input class="inp" v-model="bank.tag" @keyup.enter="loadBank(true)" placeholder="整词筛选" /></div>
        <div class="field" style="min-width:120px"><label>状态</label>
          <select v-model="bank.mode" @change="loadBank(true)"><option value="all">全部</option><option value="wrong">仅错题</option><option value="favorite">仅收藏</option><option value="mastered">仅已掌握</option><option value="unseen">仅未做</option></select></div>
        <button class="btn subtle" @click="loadBank(true)" style="align-self:flex-end">↻ 搜索</button>
      </div>

      <div class="bank-toolbar">
        <div class="seg xs">
          <button :class="{on:bank.status===''}" @click="bank.status='';loadBank(true)">已发布</button>
          <button :class="{on:bank.status==='draft'}" @click="bank.status='draft';loadBank(true)">待审核<span v-if="meta.drafts" class="seg-badge">{{ meta.drafts }}</span></button>
        </div>
        <label class="bank-check"><input type="checkbox" :checked="bank.items.length && bank.items.every(q=>bank.sel.includes(q.id))" @change="bankAllOnPage" /> 全选本页</label>
        <span class="muted">已选 {{ bank.sel.length }} · 共 {{ bank.total }} 题(已加载 {{ bank.items.length }})</span>
        <button class="btn subtle" v-if="bank.items.length" @click="bankAutoClassify" title="按题干内容自动纠正科目（仅强特征命中）">🪄 智能归类(本页)</button>
        <button class="btn subtle" @click="loadBank(true)" :disabled="bank.loading" title="重新从服务器拉取题库列表">🔄 刷新</button>
        <button class="btn subtle" v-if="bank.items.length && !bank.sel.length" @click="bankExportSel" title="把当前已加载的题导出为 JSON">⬇ 导出本页</button>
        <button class="btn subtle" v-if="bank.total" @click="bankDedup" title="扫描整个题库，删除题干完全相同的重复题（每组保留一道）">🧹 清理完全重复</button>
        <button class="btn subtle" v-if="bank.total" @click="bankDupScan" :disabled="dup.busy" title="simhash 相似度扫描：找出题干高度相似（OCR 错字/标点差异）的疑似重复组，人工确认后删除"><span v-if="dup.busy" class="spin"></span>🔍 近似查重</button>
        <template v-if="bank.sel.length">
          <select class="bk-mini" v-model="bank.batchSubject"><option value="">改科目为…</option><option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option></select>
          <button class="btn subtle" @click="bankBatchSubject">应用</button>
          <button class="btn subtle" @click="bankBatchChapter" title="批量修改选中题的章节">改章节</button>
          <button class="btn subtle" @click="bankBatchTag" title="给选中题批量添加标签（与原标签合并）">加标签</button>
          <button class="btn subtle" @click="bankExportSel" title="把选中题导出为 JSON（可在导入页导回）">⬇ 导出</button>
          <button v-if="bank.status==='draft'" class="btn subtle" style="color:var(--ok);border-color:var(--ok)" @click="bankBatchApprove">✓ 通过选中 ({{ bank.sel.length }})</button>
          <button class="bk-del" @click="bankBatchDelete">删除选中 ({{ bank.sel.length }})</button>
        </template>
      </div>

      <div v-if="bank.loading && !bank.items.length" class="empty"><span class="spin"></span> 加载中…</div>
      <div v-else-if="!bank.items.length" class="empty"><div class="big">∅</div><p>题库为空或没有匹配的题目。</p></div>
      <template v-else>
        <div v-for="(q,i) in bank.items" :key="q.id" class="bank-row" :class="{sel:bank.sel.includes(q.id)}">
          <input type="checkbox" class="bank-rowck" :checked="bank.sel.includes(q.id)" @change="bankToggle(q.id)" />
          <div class="bank-main">
            <div class="bank-meta"><span class="tag">{{ subjName(q.subject) }}</span><span class="tag2">{{ typeMap[q.type]||q.type }}</span><span v-if="q.mastered" class="q-badge" style="color:var(--ok);border-color:var(--ok)">已掌握</span><span v-else-if="q.wrong_count>0" class="q-badge" style="color:var(--bad);border-color:var(--bad)">错 {{ q.wrong_count }} 次</span><span v-else-if="q.right_count>0" class="q-badge" style="color:var(--ok);border-color:var(--ok)">已做对</span><span v-if="q.favorited" class="q-badge" style="color:var(--accent);border-color:var(--accent)">★ 收藏</span><span v-if="q.status==='draft'" class="q-badge" style="color:#d97706;border-color:#d97706">待审核</span></div>
            <div class="bank-stem"><rich-text :content="q.stem || '（空题干）'" /></div>
            <div v-if="q.source || q.page" class="bank-src"><span class="bank-src-book" :title="q.source">📖 {{ srcBook(q.source) }}</span><span v-if="q.page" class="bank-src-pg">P{{ q.page }}</span></div>
          </div>
          <div class="bank-side">
            <button v-if="q.status==='draft'" class="btn subtle xs" style="color:var(--ok);border-color:var(--ok)" @click="bankApprove(q)">✓ 通过</button>
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
            <div class="row" style="gap:10px;margin-bottom:10px">
              <div class="field" style="flex:2"><label>章节</label><input class="inp" v-model="bankEdit.chapter" placeholder="如 C语言-指针" /></div>
              <div class="field" style="flex:1"><label>难度</label><select v-model.number="bankEdit.difficulty"><option v-for="n in [1,2,3,4,5]" :key="n" :value="n">{{ n }}</option></select></div>
            </div>
            <div class="field" style="margin-bottom:10px"><label>标签（逗号分隔）</label><input class="inp" v-model="bankEdit.tags" placeholder="如 指针, 易错" /></div>
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
            <div class="row" style="gap:10px;align-items:center;margin-top:12px;flex-wrap:wrap">
              <input ref="qimgFile" type="file" accept="image/*" style="display:none" @change="bankImgFile" />
              <button class="btn subtle xs" @click="bankPickImg">🖼 插入配图</button>
              <label class="row" style="cursor:pointer;font-size:12px;gap:4px"><input type="checkbox" v-model="qimgInline" />小图内嵌(≤100KB)</label>
              <span class="muted" style="font-size:12px">大图上传到 R2（未绑定会提示改用内嵌）；插入到题干末尾</span>
            </div>
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

      <div v-if="dup.open" class="modal-mask" @click.self="dup.busy?null:(dup.open=false)">
        <div class="modal">
          <div class="modal-h"><b>🔍 近似查重</b><button class="toc-close" @click="dup.open=false">✕</button></div>
          <div class="modal-b">
            <div v-if="dup.busy" class="empty"><span class="spin"></span> 正在扫描…已读取 {{ dup.scanned }} 题</div>
            <template v-else>
              <p class="muted" style="margin:0 0 12px">共 {{ dup.groups.length }} 组高度相似题（含待审核）。每组已默认保留<b>最早的一道</b>、勾选其余为删除；点击可切换取舍。</p>
              <div v-for="(g,gi) in dup.groups" :key="gi" class="dup-group">
                <div class="muted" style="font-size:12px;margin-bottom:6px">第 {{ gi+1 }} 组 · {{ g.length }} 题 · {{ subjName(g[0].subject) }}</div>
                <label v-for="q in g" :key="q.id" class="dup-item" :class="{del:dup.del[q.id]}">
                  <input type="checkbox" :checked="!!dup.del[q.id]" @change="dupToggle(q.id)" />
                  <span class="dup-stem">{{ (q.stem||'').slice(0,90) }}</span>
                  <span class="muted" style="font-size:12px;white-space:nowrap">{{ q.chapter||'—' }}<template v-if="q.status==='draft'"> · 待审核</template></span>
                </label>
              </div>
            </template>
          </div>
          <div class="modal-f">
            <button class="btn subtle" @click="dup.open=false">关闭</button>
            <button class="bk-del" :disabled="dup.busy||!dupDelCount()" @click="dupDelete">删除勾选 ({{ dupDelCount() }})</button>
          </div>
        </div>
      </div>
    </div>
`;
