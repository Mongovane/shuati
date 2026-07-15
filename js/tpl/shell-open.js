// 模板分片「TPL_SHELL_OPEN」——由 tools/split-template.mjs 从单体 app-template.js 拆出。
// 直接编辑本文件即可；js/app-template.js 按固定顺序装配，勿在分片间搬动结构边界。
const TPL_SHELL_OPEN = `
  <div class="topbar"><div class="topbar-in">
    <div class="brand"><span class="dot"></span>{{ appName }}</div>
    <div class="spacer"></div>
    <button class="icon-btn" @click="stealthHide" title="快速隐藏（按 &#96; 切换）"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M9.4 5.2A9 9 0 0 1 21 12a9.4 9.4 0 0 1-1.3 1.9"/><path d="M6.1 6.1A9.4 9.4 0 0 0 3 12a9 9 0 0 0 11 6.6"/></svg></button>
    <button class="icon-btn" @click="cycleTheme" :title="'主题：'+({light:'浅色',dark:'深色',auto:'跟随系统'}[theme]||'浅色')+'（点按切换）'">{{ themeIcon }}</button>
  </div>
  <div class="tabs">
    <button class="tab" :class="{active:view==='practice'}" @click="go('practice')">Home</button>
    <button class="tab" :class="{active:view==='books'}" @click=\"go('books')\">Books</button>
    <button class="tab" :class="{active:view==='wrong'}" @click="go('wrong')">Review<span v-if="wrongTotal" class="badge">{{ wrongTotal }}</span></button>
    <button class="tab" :class="{active:view==='favorite'}" @click="go('favorite')">Saved</button>
    <button class="tab" :class="{active:view==='mock'}" @click=\"go('mock')\">Test</button>
    <button class="tab" :class="{active:view==='stats'}" @click="go('stats')">Reports</button>
    <button class="tab" :class="{active:view==='bank'}" @click="go('bank')">Bank</button>
    <button class="tab" :class="{active:view==='ingest'}" @click=\"go('ingest')\">Import</button>
    <button class="tab" :class="{active:view==='settings'}" @click=\"go('settings')\">Settings <span class="muted" style="font-size:10px">v46</span></button>
  </div></div>

  <div v-if="offline" class="offline-bar">离线模式 · 显示已缓存内容，作答将在联网后自动同步<span v-if="offlineQueued>0">（待同步 {{ offlineQueued }} 条）</span></div>

  <div class="wrap">
`;
