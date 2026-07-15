// 模板分片「TPL_VIEW_STATS」——由 tools/split-template.mjs 从单体 app-template.js 拆出。
// 直接编辑本文件即可；js/app-template.js 按固定顺序装配，勿在分片间搬动结构边界。
const TPL_VIEW_STATS = `
    <div v-else-if="view==='stats'">
      <div v-if="statsLoading" class="empty"><span class="spin"></span> 加载中…</div>
      <template v-else-if="stats">
        <div class="stat-grid">
          <div class="stat"><div class="n">{{ statTotals.totalQ }}</div><div class="l">题目总数</div></div>
          <div class="stat"><div class="n">{{ statTotals.seen }}</div><div class="l">已作答</div></div>
          <div class="stat"><div class="n" style="color:var(--bad)">{{ statTotals.wrongOpen }}</div><div class="l">待复习</div></div>
          <div class="stat"><div class="n" style="color:var(--ok)">{{ statTotals.mastered }}</div><div class="l">已掌握</div></div>
        </div>
        <div class="row" style="gap:8px;margin:2px 0 10px;flex-wrap:wrap;align-items:center">
          <span v-if="streakDays>0" class="st-chip hot">🔥 连续学习 {{ streakDays }} 天</span>
          <span v-if="examDaysLeft!==null" class="st-chip" :class="{warn:examDaysLeft<=30&&examDaysLeft>=0}">⏳ {{ examDaysLeft>=0 ? '距考试 '+examDaysLeft+' 天' : '考试已过 '+(-examDaysLeft)+' 天' }}</span>
          <button class="btn subtle xs" @click="printWrong" :disabled="printW.busy"><span v-if="printW.busy" class="spin"></span>🖨 打印错题卷</button>
          <label class="row" style="cursor:pointer;font-size:12px;gap:4px"><input type="checkbox" v-model="printW.withAns" />附参考答案</label>
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
          <template v-if="stats.dur && stats.dur.length">
            <h3 style="margin:22px 0 10px">平均用时 <span class="muted" style="font-weight:400;font-size:13px">近 90 天 · 按题型</span></h3>
            <div class="dur-grid">
              <div v-for="d in stats.dur" :key="d.type" class="dur-cell"><b>{{ fmtDur(d.avg_ms) }}</b><span>{{ typeMap[d.type]||d.type }} · {{ d.n }} 次</span></div>
            </div>
          </template>
          <template v-if="stats.mocks && stats.mocks.length">
            <h3 style="margin:22px 0 12px">近期测试</h3>
            <div v-for="(m,i) in stats.mocks" :key="i" class="subj-row">
              <div class="top"><span>{{ subjName(m.subject) }} · {{ m.score!=null?m.score:m.correct }}/{{ m.total }}<span v-if="m.score!=null&&m.score!==m.correct" class="muted" style="font-size:12px">（含半分）</span></span>
                <span class="muted">{{ fmtTime(m.duration_seconds) }}
                  <button class="btn subtle" style="margin-left:8px;padding:2px 10px;font-size:12px" @click="reviewMock(m)">错题回顾</button>
                </span></div>
              <div class="bar"><span :style="{width:(m.total?Math.round((m.score!=null?m.score:m.correct)/m.total*100):0)+'%', background:(m.total&&(m.score!=null?m.score:m.correct)/m.total>=0.6)?'var(--ok)':'var(--bad)'}"></span></div>
            </div>
          </template>
        </template>
      </template>
      <div v-else class="empty"><span class="spin"></span> 加载中…</div>
    </div>
`;
