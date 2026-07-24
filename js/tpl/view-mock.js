// 模板分片「TPL_VIEW_MOCK」——由 tools/split-template.mjs 从单体 app-template.js 拆出。
// 直接编辑本文件即可；js/app-template.js 按固定顺序装配，勿在分片间搬动结构边界。
const TPL_VIEW_MOCK = `
    <div v-else-if="view==='mock'">
      <div v-if="!mock.started && !mock.finished">
        <div v-if="mockSaved" class="card" style="border:1.5px solid var(--accent);margin-bottom:14px">
          <div style="font-weight:700;margin-bottom:6px"><icon name="clock" :size="15" /> 有一场未完成的模拟考</div>
          <p class="muted" style="margin:0 0 10px">{{ subjName(mockSaved.subject==='all'?'':mockSaved.subject)||'全部科目' }} · {{ (mockSaved.questions||[]).length }} 题 · 剩余 {{ fmtTime(mockSaved.remaining|0) }} · 存于 {{ new Date(mockSaved.savedAt).toLocaleString() }}</p>
          <div class="row" style="gap:8px">
            <button class="btn" @click="resumeMock">继续这场考试</button>
            <button class="btn subtle" @click="mockSnapClear(); flash('已丢弃未完成的模考')">丢弃</button>
          </div>
        </div>
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
        <label class="row" style="margin:6px 0 14px;cursor:pointer"><input type="checkbox" v-model="mock.objectiveOnly" /> <span class="muted">仅自动判分题（单选 / 多选 / 判断）</span></label>
        <div class="card" style="margin:0 0 16px;padding:14px 16px">
          <label class="row" style="cursor:pointer;justify-content:space-between;align-items:center">
            <span style="font-weight:600"><icon name="puzzle" :size="15" /> 高级组卷 <span class="muted" style="font-weight:400;font-size:12px">按章节 × 题型配比出卷</span></span>
            <input type="checkbox" v-model="mock.bp.on" />
          </label>
          <template v-if="mock.bp.on">
            <div v-for="(r,ri) in mock.bp.rows" :key="ri" class="bp-row">
              <select class="bk-mini" v-model="r.type"><option value="">不限题型</option><option v-for="t in types" :key="t.v" :value="t.v">{{ t.t }}</option></select>
              <select class="bk-mini" v-model="r.chapter"><option value="">不限章节</option><option v-for="c in mockChapters" :key="c" :value="c">{{ c }}</option></select>
              <input class="inp bp-n" type="number" min="1" max="100" v-model.number="r.count" />
              <span class="muted" style="font-size:12px">题</span>
              <button class="bk-del xs" @click="bpDel(ri)" title="删除这行"><icon name="x" :size="16" /></button>
            </div>
            <div class="row" style="gap:10px;margin-top:8px;align-items:center;flex-wrap:wrap">
              <button class="btn subtle xs" @click="bpAdd">+ 加一行</button>
              <span class="muted" style="font-size:12px">合计 {{ bpTotal() }} 题（生效时替代上面的「题数」）</span>
            </div>
          </template>
        </div>
        <button class="btn" :disabled="loading" @click="startMock"><span v-if="loading" class="spin"></span>开始测试</button>
      </div>

      <template v-else>
        <div v-if="mock.started" class="mock-bar">
          <span class="timer" :class="{warn:mock.remaining<60}">{{ fmtTime(mock.remaining) }}</span>
          <span class="muted">{{ mock.questions.length }} 题 · {{ subjName(mock.subject==='all'?'':mock.subject)||'全部科目' }}</span>
          <div class="spacer" style="flex:1"></div>
          <button class="btn" @click="submitMock">提交</button>
        </div>
        <div v-if="mock.started" class="mock-sheet">
          <button class="ms-toggle" @click="mock.sheetOpen=!mock.sheetOpen">答题卡 {{ Object.values(mock.touched).filter(Boolean).length }}/{{ mock.questions.length }} {{ mock.sheetOpen?'▾':'▸' }}</button>
          <div v-show="mock.sheetOpen" class="ms-grid">
            <button v-for="(q,i) in mock.questions" :key="q.id" class="ms-chip" :class="{done:mock.touched[q.id]}" @click="mockJump(i)">{{ i+1 }}</button>
          </div>
        </div>

        <div v-if="mock.finished" class="card" style="text-align:center">
          <div class="stamp" :class="mockPct>=60?'ok':'bad'"><div><div class="s">{{ mockPct }}</div><div class="u">得分</div></div></div>
          <div style="font-weight:700;font-size:18px">得分 {{ mockResult.score }} / {{ mockResult.total }}</div>
          <p v-if="mockResult.half" class="muted" style="margin:4px 0 0;font-size:13px">全对 {{ mockResult.correct }} 题 · 多选少选 {{ mockResult.half }} 题按半分计</p>
          <p class="muted" style="margin-top:6px">用时 {{ fmtTime(mock.elapsed) }}<span v-if="mockResult.graded<mockResult.total"> · 还有 {{ mockResult.total-mockResult.graded }} 道主观题需自评</span></p>
          <div class="row" style="justify-content:center;margin-top:14px">
            <button class="btn subtle" @click="quitMock">返回</button>
            <button class="btn" @click="startMock">重新测试</button>
          </div>
        </div>
        <h3 v-if="mock.finished" style="margin:22px 0 10px">复盘</h3>

        <div v-for="(q,i) in mock.questions" :key="q.id" :id="'mockq'+i" style="margin-bottom:16px">
          <div class="q-counter" style="margin-bottom:6px">第 {{ i+1 }} 题
            <template v-if="mock.finished">·
              <span v-if="mock.answers[q.id]===true" style="color:var(--ok)">正确</span>
              <span v-else-if="mock.answers[q.id]===0.5" style="color:#d97706">部分正确 · 少选半分</span>
              <span v-else-if="mock.answers[q.id]===false" style="color:var(--bad)">错误</span>
              <span v-else class="muted">自评</span>
            </template>
          </div>
          <question-card ref="mockCards" :q="q" mode="exam" :exam-reveal="mock.finished" @answered="onMockAnswer" />
        </div>

        <button v-if="mock.started" class="btn" style="width:100%" @click="submitMock">提交</button>
      </template>
    </div>
`;
