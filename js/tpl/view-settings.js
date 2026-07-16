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
        <div class="hint" style="margin-top:16px">就是部署时设置的 <code>APP_TOKEN</code>，防止别人动你的数据和 AI 额度。只存在本机浏览器。</div>
      </div>
      <div class="card" style="max-width:680px;margin-top:14px">
        <div class="fold-head" @click="settFold.mineru=!settFold.mineru"><span style="font-weight:700;font-size:15px">MinerU 用量护栏</span><span class="fold-arrow" :class="{open:!settFold.mineru}">▾</span></div>
        <div v-show="!settFold.mineru" class="fold-body" style="margin-top:10px">
        <div class="hint" style="margin-bottom:14px">给 MinerU 设每日用量上限、Token 临期提醒。可填自己的 Token（只存本机、只发官方接口），留空用服务端配置。用量为本机估算，以 MinerU 后台为准，每天 0 点归零。</div>
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
        <div class="hint" style="margin-top:12px">上限 0 = 不限。Token 到期不能续期，只能在 MinerU 控制台重建，再更新 Cloudflare 的 <code>MINERU_API_KEY</code> 并重新部署。</div>
        </div>
      </div>
      <div class="card" style="max-width:680px;margin-top:14px">
        <div class="fold-head" @click="settFold.aicfg=!settFold.aicfg"><span style="font-weight:700;font-size:15px">AI 中转站（全局）</span><span class="fold-arrow" :class="{open:!settFold.aicfg}">▾</span></div>
        <div v-show="!settFold.aicfg" class="fold-body" style="margin-top:10px">
        <div class="hint" style="margin-bottom:14px">全站 AI 功能统一走这里；拍照/看图用的视觉模型另在「导入 → OCR 设置」。留空用服务端配置。</div>
        <div class="toolbar">
          <div class="field" style="margin:0;min-width:280px"><label>Base URL（留空用服务端）</label><input class="inp" v-model="explainCfg.base" @change="saveExplainCfg" placeholder="https://你的中转站/v1" /></div>
          <div class="field" style="margin:0;min-width:280px"><label>API Key（自定义 Base 时必填）</label><input class="inp" type="password" v-model="explainCfg.key" @change="saveExplainCfg" placeholder="sk-..." /></div>
          <div class="field" style="margin:0;min-width:220px"><label>模型（留空用服务端 AI_MODEL）</label><input class="inp" v-model="explainCfg.model" @change="saveExplainCfg" placeholder="gpt-4o / deepseek-v3 …" /></div>
        </div>
        <div class="row" style="gap:10px;margin-top:10px;align-items:center;flex-wrap:wrap">
          <button class="btn subtle xs" :disabled="modelPick.busy" @click="fetchModels" title="向中转站 /v1/models 拉取可用模型列表"><span v-if="modelPick.busy" class="spin"></span>⬇ 从端点拉取</button>
          <span class="muted" style="font-size:12px">填好上面的 Base URL 与 Key 后点这里，自动列出该站支持的模型</span>
        </div>
        <div v-if="modelPick.list.length" class="model-pick">
          <span v-for="m in modelPick.list" :key="m" class="model-chip" :class="{on:explainCfg.model===m}" @click="pickModel(m)" :title="m">{{ m }}</span>
        </div>
        <label style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:13px;cursor:pointer"><input type="checkbox" v-model="explainStable" @change="saveExplainStable" style="width:auto;flex:none" /> 稳定模式（关闭流式）：某些模型或网络下流式易断（如 HTTP2 报错），开启后改用一次性返回，更稳但无逐字效果、需等全部生成</label>
        <div class="hint" style="margin-top:10px">⚠ Key 只存本机浏览器；自定义 Base 必须配它自己的 Key。公用电脑别填，建议用限额子 Key。</div>
        </div>
      </div>
      <div class="card" style="max-width:680px;margin-top:14px">
        <div class="fold-head" @click="settFold.offline=!settFold.offline"><span style="font-weight:700;font-size:15px">离线与数据备份</span><span class="fold-arrow" :class="{open:!settFold.offline}">▾</span></div>
        <div v-show="!settFold.offline" class="fold-body" style="margin-top:10px">
        <div class="hint" style="margin-bottom:14px">一键把全部题目和教材下载到本机，断网也能照常刷题、翻书、筛选；离线作答联网后自动补传。建议先「添加到主屏幕」。</div>
        <div class="row" style="gap:12px;align-items:center">
          <button class="btn" :disabled="offlineSyncing || offline" @click="offlineSync"><span v-if="offlineSyncing" class="spin"></span>{{ offlineSyncing ? '下载中…' : '下载全部供离线使用' }}</button>
          <button class="btn subtle" :disabled="exporting || offline" @click="exportBackup"><span v-if="exporting" class="spin"></span>{{ exporting ? '导出中…' : '导出数据备份 (JSON)' }}</button>
          <button class="btn subtle" :disabled="restoring || offline" @click="restorePick"><span v-if="restoring" class="spin"></span>{{ restoring ? '恢复中…' : '恢复备份 (JSON)' }}</button>
          <input ref="restoreFile" type="file" accept=".json,application/json" style="display:none" @change="restoreBackup" />
          <span v-if="offlineSyncing" class="muted">{{ offlineSyncMsg }}</span>
          <span v-else-if="offlineSynced" class="muted">已缓存 {{ offlineSynced.q }} 题 · {{ offlineSynced.m }} 页教材 · {{ new Date(offlineSynced.at).toLocaleString() }}</span>
          <span v-else class="muted">尚未下载离线包</span>
        </div>
        <div class="row" style="gap:10px;flex-wrap:wrap;margin-top:12px;align-items:center">
          <button class="btn subtle" :disabled="ankiBusy" @click="exportAnki"><span v-if="ankiBusy" class="spin"></span>🃏 导出 Anki 卡片</button>
          <span class="muted" style="font-size:12px">按练习页当前科目导出 TSV，公式已转 \\(…\\)，Anki「导入文件」即用</span>
        </div>
        <label class="row" style="margin-top:10px;cursor:pointer;gap:6px;align-items:center"><input type="checkbox" v-model="restoreReplace" /> <span class="muted">覆盖式恢复：先清空现有数据再写入备份（恢复到备份时刻；不勾选则为合并，同 ID 以备份为准）</span></label>
        <div class="hint" style="margin-top:12px">题库更新后再点一次即覆盖离线包（只存本机，换设备各自下载）。备份 JSON 可整体导回；PDF 书架只恢复目录，文件需重传。</div>
        </div>
      </div>
      <div class="card" style="max-width:680px;margin-top:14px">
        <div class="fold-head" @click="settFold.subjects=!settFold.subjects"><span style="font-weight:700;font-size:15px">科目管理</span><span class="fold-arrow" :class="{open:!settFold.subjects}">▾</span></div>
        <div v-show="!settFold.subjects" class="fold-body" style="margin-top:10px">
        <div class="hint" style="margin-bottom:14px">增删改科目，全站下拉自动同步。「关键词」帮导入时自动归类（逗号分隔）；代码、公式、英文等特征已内置，不用填。</div>
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
        <div style="font-weight:600;margin:2px 0 12px">个性化</div>
        <div class="field" style="margin-bottom:14px"><label>显示名称（浏览器标签页 + 页头）</label>
          <input class="inp" style="width:100%" v-model="appName" placeholder="例如：刷题 / 资料库 / 仪表盘 / 笔记" />
        </div>
        <div style="font-weight:600;margin:4px 0 10px">学习偏好</div>
        <div class="row" style="gap:14px;flex-wrap:wrap;margin-bottom:12px">
          <div class="field" style="min-width:170px"><label>考试日期（统计页倒计时）</label><input class="inp" type="date" v-model="examDate" /></div>
          <div class="field" style="min-width:190px"><label>每日新题上限（0 = 不限）</label><input class="inp" type="number" min="0" max="500" v-model.number="dailyNewLimit" /></div>
        </div>
        <div class="row" style="justify-content:space-between;margin-bottom:12px"><span style="font-weight:600">外观</span>
          <select class="bk-mini" v-model="theme"><option value="light">浅色 ☀</option><option value="dark">深色 ☾</option><option value="auto">跟随系统 🌗</option></select>
        </div>
        <label class="row" style="cursor:pointer"><input type="checkbox" v-model="stealth.autoHide" /> <span class="muted">窗口失焦时自动隐藏（返回时恢复）</span></label>
        <div class="hint" style="margin-top:14px">按 <code>&#96;</code>（1 左侧）或点眼睛图标，立即伪装成 Vane 品牌页；再按一次或点击任意处恢复。</div>
      </div>
      <div class="muted" style="text-align:center;margin-top:28px;font-size:12px;opacity:.4">刷题文档 {{ appVer }}</div>
    </div>

  </div>
`;
