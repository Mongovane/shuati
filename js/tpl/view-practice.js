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
        <div class="field" v-if="view!=='wrong'"><label>顺序</label>
          <select v-model="f.order" @change="onFilter">
            <option value="random">随机</option>
            <option value="seq">顺序</option>
          </select></div>
        <button class="btn subtle" @click="startSession" style="margin-left:auto">↻ 刷新</button>
      </div>

      <div v-if="loading" class="empty"><span class="spin"></span> 加载中…</div>
      <template v-else>
        <div v-if="cur">
          <div v-if="reviewSession" class="review-banner">
            <span class="rb-dot"></span>
            <span class="rb-txt">错题回顾 · <b>{{ reviewSession.title }}</b> · 共 {{ reviewSession.count }} 题</span>
            <button class="btn subtle xs" @click="exitReviewSession">退出回顾</button>
          </div>
          <div class="row" style="margin-bottom:12px;align-items:center;gap:10px"><span class="q-counter">第 {{ qi+1 }} / {{ queue.length }} 题</span>
            <span class="muted" v-if="view==='wrong' && !reviewSession">· 复习（最不熟优先）</span>
            <span class="muted" v-if="view==='wrong' && !reviewSession && queueTotal">· 本范围待复习 {{ queueTotal }} 题</span>
            <span class="muted" v-if="view==='favorite'">· 收藏</span>
            <span v-if="curStatus" class="q-badge" :style="{color:curStatus.c,borderColor:curStatus.c}">{{ curStatus.t }}</span>
            <span v-if="view==='practice' && queueTotal" class="muted">· {{ f._mode==='unseen'?'未做剩 '+queueTotal:'本范围共 '+queueTotal }} 题</span>
            <span v-if="streak>=2" style="color:var(--accent);font-weight:600;font-size:13px">🔥 连对 {{ streak }}</span>
            <span class="muted" style="margin-left:auto;font-size:12px">归类</span><select class="bk-mini" :value="cur.subject" @change="setQuestionSubject($event.target.value)" title="发现分类错了？直接改，立即生效"><option v-for="s in subjects" :key="s.v" :value="s.v">{{ s.t }}</option></select>
            <button class="btn subtle xs" v-if="view==='wrong'" @click="dropFromReview" title="标记为已掌握，从待复习队列移除；题目仍保留在题库">✓ 移出复习</button>
            <button class="bk-del-min" @click="deleteCurrentQuestion" title="从题库彻底删除本题（用于清理 OCR 坏题，不可恢复）">删除</button>
          </div>
          <transition name="qfade" mode="out-in">
          <question-card ref="curCard" :q="cur" :key="cur.id" :can-ai="(ai.hasAI || !!(explainCfg.base && explainCfg.key)) && !offline" :ai-text="curAiText" :ai-busy="aiX.busy && aiX.id===cur.id" :ai-chat="curAiChat" :ai-asking="aiX.asking && aiX.id===cur.id" :ai-model="curAiModel" @answered="onAnswered" @favorite="onFav" @master="onMaster" @note="onNote" @next="next" @ai-explain="aiExplain" @ai-save="aiSaveToAnalysis" @ai-ask="aiAsk" @ai-note="aiNoteFromChat" @ai-retry="aiRetryAsk" @seg-mode="segActive=$event" />
          </transition>
          <div class="q-nav-bar">
            <button class="btn subtle" :disabled="qi<=0" @click="prev">← 上一题</button>
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

`;
