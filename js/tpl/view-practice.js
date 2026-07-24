// 模板分片「TPL_VIEW_PRACTICE」——由 tools/split-template.mjs 从单体 app-template.js 拆出。
// 直接编辑本文件即可；js/app-template.js 按固定顺序装配，勿在分片间搬动结构边界。
const TPL_VIEW_PRACTICE = `
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
        <div class="field" style="min-width:110px"><label>标签</label>
          <input class="inp" v-model="f.tag" @keyup.enter="onFilter" @change="onFilter" placeholder="整词筛选" /></div>
        <div class="field" v-if="view==='practice'"><label>范围</label>
          <select v-model="f._mode" @change="onFilter">
            <option value="all">全部题目</option>
            <option value="unseen">仅未做</option>
            <option value="due">今日待复习</option>
            <option value="wrong">仅错题</option>
            <option value="favorite">仅收藏</option>
          </select></div>
        <div class="field" v-if="view==='wrong'"><label>范围</label>
          <select v-model="reviewScope" @change="onFilter">
            <option value="due">今日到期（SRS）</option>
            <option value="all">全部错题</option>
          </select></div>
        <div class="field" v-if="view!=='wrong'"><label>顺序</label>
          <select v-model="f.order" @change="onFilter">
            <option value="random">随机</option>
            <option value="seq">顺序</option>
          </select></div>
        <button class="btn subtle" @click="startSession" style="margin-left:auto"><icon name="rotate-cw" :size="15" /> 刷新</button>
      </div>

      <!-- Saved 收藏清单模式 -->
      <template v-if="view==='favorite' && fav.listMode">
        <div v-if="fav.loading && !fav.items.length" class="skel-wrap"><div class="skel skel-row" v-for="n in 5" :key="'fsk'+n"></div></div>
        <template v-else-if="fav.items.length">
          <div class="bank-toolbar">
            <label class="bank-check"><input type="checkbox" :checked="fav.items.length && fav.items.every(q=>fav.sel.includes(q.id))" @change="favAllOnPage" /> 全选本页</label>
            <span class="muted">已选 {{ fav.sel.length }} · 共 {{ fav.total }} 收藏(已加载 {{ fav.items.length }})</span>
            <button class="btn subtle" @click="favPractice" title="把收藏的题作为一轮练习逐题刷">▶ 开始刷这些收藏</button>
            <button class="btn subtle" v-if="!fav.sel.length" @click="favExportSel" title="导出当前收藏为 JSON"><icon name="download" :size="15" /> 导出本页</button>
            <template v-if="fav.sel.length">
              <button class="btn subtle" @click="favExportSel" title="导出选中为 JSON"><icon name="download" :size="15" /> 导出 ({{ fav.sel.length }})</button>
              <button class="bk-del" @click="favUnstarSel">取消收藏 ({{ fav.sel.length }})</button>
            </template>
          </div>
          <div v-for="q in fav.items" :key="q.id" class="bank-row" :class="{sel:fav.sel.includes(q.id)}">
            <input type="checkbox" class="bank-rowck" :checked="fav.sel.includes(q.id)" @change="favToggleSel(q.id)" />
            <div class="bank-main">
              <div class="bank-meta"><span class="tag">{{ subjName(q.subject) }}</span><span class="tag2">{{ typeMap[q.type]||q.type }}</span><span v-if="q.chapter" class="muted">{{ q.chapter }}</span></div>
              <div class="bank-stem"><rich-text :content="q.stem || '（空题干）'" /></div>
            </div>
            <button class="bk-del-min" @click="favUnstarOne(q)" title="取消收藏" style="color:var(--accent)"><icon name="star" :size="16" /></button>
          </div>
          <div v-if="fav.items.length < fav.total" class="row" style="justify-content:center;margin-top:14px"><button class="btn subtle" :disabled="fav.loading" @click="favLoadMore"><span v-if="fav.loading" class="spin"></span>加载更多（{{ fav.items.length }}/{{ fav.total }}）</button></div>
        </template>
        <div v-else class="empty">
          <div class="big"><icon name="star" :size="16" /></div><p>暂无收藏题。刷题时点题目上的 ★ 可收藏。</p>
          <div class="row" style="justify-content:center;margin-top:14px"><button class="btn" @click="go('practice')">去刷题</button></div>
        </div>
      </template>

      <div v-else-if="loading" class="skel-wrap">
        <div class="skel skel-q">
          <div class="skel-line w40" style="height:11px"></div>
          <div class="skel-line w90"></div>
          <div class="skel-line w100"></div>
          <div class="skel-line w60" style="margin-bottom:20px"></div>
          <div class="skel skel-opt"></div>
          <div class="skel skel-opt"></div>
          <div class="skel skel-opt"></div>
          <div class="skel skel-opt" style="margin-bottom:0"></div>
        </div>
      </div>
      <template v-else>
        <div v-if="cur">
          <div v-if="reviewSession" class="review-banner">
            <span class="rb-dot"></span>
            <span class="rb-txt">错题回顾 · <b>{{ reviewSession.title }}</b> · 共 {{ reviewSession.count }} 题</span>
            <button class="btn subtle xs" @click="exitReviewSession">退出回顾</button>
          </div>
          <div class="row" style="margin-bottom:12px;align-items:center;gap:10px"><span class="q-counter">第 {{ qi+1 }} / {{ queue.length }} 题</span>
            <span class="muted" v-if="view==='wrong' && !reviewSession">· {{ reviewScope==='due' ? '今日到期（按到期先后）' : '全部错题（最不熟优先）' }}</span>
            <span class="muted" v-if="view==='wrong' && !reviewSession && queueTotal">· {{ reviewScope==='due' ? '今日待复习 ' : '待复习共 ' }}{{ queueTotal }} 题</span>
            <span class="muted" v-if="view==='favorite'">· 收藏</span>
            <span v-if="curStatus" class="q-badge" :style="{color:curStatus.c,borderColor:curStatus.c}">{{ curStatus.t }}</span>
            <span v-if="view==='practice' && queueTotal" class="muted">· {{ f._mode==='unseen'?'未做剩 '+queueTotal:'本范围共 '+queueTotal }} 题</span>
            <span v-if="streak>=2" style="color:var(--accent);font-weight:600;font-size:13px"><icon name="flame" :size="15" /> 连对 {{ streak }}</span>
            <span class="muted" style="margin-left:auto;font-size:12px">归类</span><select class="bk-mini" :value="cur.subject" @change="setQuestionSubject($event.target.value)" title="发现分类错了？直接改，立即生效"><option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option></select>
            <button class="btn subtle xs" v-if="view==='wrong'" @click="dropFromReview" title="标记为已掌握，从待复习队列移除；题目仍保留在题库"><icon name="check" :size="15" /> 移出复习</button>
            <button class="bk-del-min" @click="deleteCurrentQuestion" title="从题库彻底删除本题（用于清理 OCR 坏题，不可恢复）">删除</button>
          </div>
          <transition name="qfade" mode="out-in">
          <question-card ref="curCard" :q="cur" :key="cur.id" :can-ai="(ai.hasAI || !!(explainCfg.base && explainCfg.key)) && !offline" :ai-text="curAiText" :ai-busy="aiX.busy && aiX.id===cur.id" :ai-chat="curAiChat" :ai-asking="aiX.asking && aiX.id===cur.id" :ai-model="curAiModel" :ai-kind="aiX.id===cur.id ? (aiX.view||'') : ''" :ai-cards="aiX.id===cur.id && aiX.view==='concept' ? (aiX.cards||[]) : []" :ai-flip="aiX.id===cur.id ? (aiX.flip||{}) : {}" :has-explain="aiX.id===cur.id && !!aiX.text" :has-concept="aiX.id===cur.id && !!(aiX.cards&&aiX.cards.length)" :all-flipped="curAllFlipped" :init-state="qStates[cur.id]||null" @answered="onAnswered" @favorite="onFav" @master="onMaster" @note="onNote" @next="next" @ai-explain="aiExplain()" @ai-concept="aiExplain('concept')" @ai-explain-redo="aiExplain('',true)" @ai-concept-redo="aiExplain('concept',true)" @ai-save="aiSaveToAnalysis" @ai-ask="aiAsk" @ai-note="aiNoteFromChat" @ai-retry="aiRetryAsk" @seg-mode="segActive=$event" @card-flip="toggleCard" @cards-flip-all="toggleAllCards" @save-state="onSaveState" />
          </transition>
          <div class="q-nav-bar">
            <button class="btn subtle" :disabled="qi<=0" @click="prev"><icon name="arrow-left" :size="15" /> 上一题</button>
            <button class="btn" @click="next">{{ qi>=queue.length-1 ? (reviewSession ? '完成回顾 ✓' : '换一批 ↻') : '下一题 →' }}</button>
          </div>
          <div class="kbd-hint muted">快捷键：A–D / 1–4 选选项（判断题 1=对 2=错）· Enter 提交/下一题 · ← → 切题 · 揭晓后 F 收藏 · M 掌握 · 自评 1 重来 2 困难 3 良好 4 简单</div>
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
            <div class="big"><icon name="party-popper" :size="16" /></div>
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
            <template v-if="reviewScope==='due'">
              <div class="big"><icon name="party-popper" :size="16" /></div>
              <p>今日到期的复习已全部完成！</p>
              <p class="muted" v-if="stats && stats.dueTomorrow">明日还有 <b style="color:var(--accent)">{{ stats.dueTomorrow }}</b> 题到期，明天见。</p>
              <p class="muted" v-else-if="stats">明天暂无到期复习，保持住 <icon name="thumbs-up" :size="15" /></p>
              <p class="muted" v-if="bestStreak">本次最高连对 {{ bestStreak }}</p>
              <div class="row" style="justify-content:center;margin-top:16px;gap:8px;flex-wrap:wrap">
                <button class="btn" v-if="statTotals.wrongOpen" @click="reviewScope='all'; startSession()">继续复习全部错题（{{ statTotals.wrongOpen }}）</button>
                <button class="btn subtle" @click="go('practice')">去刷新题</button>
                <button class="btn subtle" @click="go('stats')">查看统计</button>
              </div>
            </template>
            <template v-else>
              <div class="big"><icon name="check" :size="16" /></div><p>{{ statTotals.wrongOpen ? '这个范围没有错题了。' : '暂无错题，做得不错。' }}</p>
              <div class="row" style="justify-content:center;margin-top:14px;gap:8px;flex-wrap:wrap">
                <button class="btn subtle" v-if="stats && stats.dueTomorrow" @click="reviewScope='due'; startSession()">看今日到期</button>
                <button class="btn" @click="go('practice')">去刷题</button>
              </div>
            </template>
          </template>
          <template v-else-if="view==='favorite'">
            <div class="big"><icon name="star" :size="16" /></div><p>暂无收藏题。刷题时点题目上的 ★ 可收藏。</p>
            <div class="row" style="justify-content:center;margin-top:14px"><button class="btn" @click="go('practice')">去刷题</button></div>
          </template>
          <template v-else-if="f._mode==='due'">
            <div class="big"><icon name="sprout" :size="16" /></div><p>今天没有到期要复习的题，休息一下或去刷新题。</p>
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

`;
