// 模板分片「TPL_VIEW_SETTINGS」——由 tools/split-template.mjs 从单体 app-template.js 拆出。
// 直接编辑本文件即可；js/app-template.js 按固定顺序装配，勿在分片间搬动结构边界。
const TPL_VIEW_SETTINGS = `
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
          <button class="btn subtle" :disabled="restoring || offline" @click="restorePick"><span v-if="restoring" class="spin"></span>{{ restoring ? '恢复中…' : '恢复备份 (JSON)' }}</button>
          <input ref="restoreFile" type="file" accept=".json,application/json" style="display:none" @change="restoreBackup" />
          <span v-if="offlineSyncing" class="muted">{{ offlineSyncMsg }}</span>
          <span v-else-if="offlineSynced" class="muted">已缓存 {{ offlineSynced.q }} 题 · {{ offlineSynced.m }} 页教材 · {{ new Date(offlineSynced.at).toLocaleString() }}</span>
          <span v-else class="muted">尚未下载离线包</span>
        </div>
        <label class="row" style="margin-top:10px;cursor:pointer;gap:6px;align-items:center"><input type="checkbox" v-model="restoreReplace" /> <span class="muted">覆盖式恢复：先清空现有数据再写入备份（恢复到备份时刻；不勾选则为合并，同 ID 以备份为准）</span></label>
        <div class="hint" style="margin-top:12px">题库更新后想让离线包同步，重新点一次即可覆盖。离线包存在本机浏览器，换设备需各自下载。备份文件可在「恢复备份」里整体导回（题库/进度/教材/模考/答题流水），PDF 书架只恢复目录，文件本体需重新上传。</div>
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
        <div style="font-weight:600;margin:4px 0 10px">学习偏好</div>
        <div class="row" style="gap:14px;flex-wrap:wrap;margin-bottom:12px">
          <div class="field" style="min-width:170px"><label>考试日期（统计页倒计时）</label><input class="inp" type="date" v-model="examDate" /></div>
          <div class="field" style="min-width:190px"><label>每日新题上限（0 = 不限）</label><input class="inp" type="number" min="0" max="500" v-model.number="dailyNewLimit" /></div>
        </div>
        <div class="row" style="gap:10px;flex-wrap:wrap;margin-bottom:16px;align-items:center">
          <button class="btn subtle" :disabled="ankiBusy" @click="exportAnki"><span v-if="ankiBusy" class="spin"></span>🃏 导出 Anki 卡片</button>
          <span class="muted" style="font-size:12px">按练习页当前科目筛选；TSV 文本，Anki「导入文件」即可，公式已转 \(…\)</span>
        </div>
        <div class="row" style="justify-content:space-between;margin-bottom:12px"><span style="font-weight:600">外观</span>
          <select class="bk-mini" v-model="theme"><option value="light">浅色 ☀</option><option value="dark">深色 ☾</option><option value="auto">跟随系统 🌗</option></select>
        </div>
        <label class="row" style="cursor:pointer"><input type="checkbox" v-model="stealth.autoHide" /> <span class="muted">窗口失焦时自动隐藏（返回时恢复）</span></label>
        <div class="hint" style="margin-top:14px">快速隐藏：点击眼睛图标，或按 <code>&#96;</code>（1 左侧的按键）。再次按下或点击即可恢复。隐藏时显示 Vane 品牌页，点击任意位置恢复。</div>
      </div>
      <div class="muted" style="text-align:center;margin-top:28px;font-size:12px;opacity:.4">刷题文档 {{ appVer }}</div>
    </div>

  </div>
`;
