# 刷题系统 — 代码审查与优化记录

> 基于 [Mongovane/shuati](https://github.com/Mongovane/shuati) 仓库的完整代码审查，涵盖 Bug 修复、交互体验改进、桌面端与手机端排版优化。  
> 共 **9 轮审查**，修改 **12 个文件**。

---

## 修改文件清单

| 文件 | 路径 | 改动类型 |
|---|---|---|
| app.js | `js/app.js` | Bug 修复 + 体验改进 |
| api.js | `js/api.js` | Bug 修复 |
| practice.js | `js/views/practice.js` | Bug 修复 + 体验改进 |
| saved.js | `js/views/saved.js` | Bug 修复 + 体验改进 |
| mock-stats.js | `js/views/mock-stats.js` | Bug 修复 |
| bank.js | `js/views/bank.js` | Bug 修复 |
| question-card.js | `js/components/question-card.js` | 体验改进 |
| view-practice.js | `js/tpl/view-practice.js` | 体验改进 + 排版 |
| view-mock.js | `js/tpl/view-mock.js` | 体验改进 |
| view-stats.js | `js/tpl/view-stats.js` | 体验改进 |
| view-bank.js | `js/tpl/view-bank.js` | 体验改进 + 排版 |
| style.css | `css/style.css` | 排版优化 |

---

## 一、Bug 修复（14 个）

### 1. 收藏题恢复时 AI 卡片与解析互斥

**文件**：`js/app.js`（第 202-212 行 `cur` watcher）

**问题**：开启「自动保存解析和卡片」后，知识点卡片存入 `ai_cards` 列，解题解析存入 `analysis` 字段。但 `cur` watcher 恢复 AI 内容时用 `if/else` 互斥分支——有 `ai_cards` 就跳过 `_extractSavedAi()`，导致解析文本恢复为空。用户在 Saved 页打开已保存的题，知识点卡片正常显示，但点「解题解析」时却重新调 AI 生成。

**修复**：改为同时提取两者——先取 `savedCards`，再取 `savedText`，两者共存在同一个 `aiStates` 条目里。

```javascript
// 修复前（互斥）
if (nc.ai_cards && nc.ai_cards.length) {
  this.aiX = { ..., cards: nc.ai_cards, text: '' };  // text 丢失
} else {
  const saved = this._extractSavedAi(nc);
  // ...
}

// 修复后（共存）
const savedCards = nc.ai_cards?.length ? nc.ai_cards.slice() : [];
const savedText = this._extractSavedAi(nc) || '';
if (savedCards.length || savedText) {
  this.aiX = { ..., cards: savedCards, text: savedText };
}
```

---

### 2. Saved「开始刷收藏」忽略勾选

**文件**：`js/views/saved.js`（`favPractice` 方法）

**问题**：`favPractice()` 始终调 `startSession()` 从后端重新拉全部收藏题，用户在清单页勾选了 3 道题点按钮，进入的却是全部收藏的刷题模式。

**修复**：有勾选时直接用选中的题构建 `queue`，不走 `startSession`；无勾选时保持原行为。按钮文案也改为动态区分：「刷选中 N 题」/「刷全部收藏」。

---

### 3. 模考复盘自评后 statsDirty 不标脏

**文件**：`js/views/mock-stats.js`（`onMockAnswer` 方法）

**问题**：交卷后进入复盘阶段，主观题自评调 API 记录，但不重置 `statsDirty`。如果用户自评完直接切到 Reports 页，看到的还是旧统计数据。

**修复**：在 `onMockAnswer` 末尾加 `this.statsDirty = true`。

---

### 4. Bank 跨页批量改科目/章节本地不同步

**文件**：`js/views/bank.js`（`bankBatchSubject`、`bankBatchChapter` 方法）

**问题**：通过「全选全部匹配」跨页选中数百题后批量改科目，后端改了但本地 `bank.items` 只更新了当前页。翻页后看到的还是旧科目。

**修复**：操作成功后调 `await this.loadBank(true)` 重拉列表。

---

### 5. go() 不同步 URL hash，刷新/后退失效

**文件**：`js/app.js`（`go()` 方法）

**问题**：`go(v)` 切换 `this.view` 后没调 `_syncHash(v)`，URL hash 停在上次启动时的值。用户从 Home 点到 Bank 再刷新浏览器 → hash 仍是 `#/practice` → 回到 Home。浏览器前进/后退按钮也完全无效。同时 `zb_view` 从未写入 localStorage，启动 fallback 读取永远为 null。

**修复**：在 `go()` 里加 `this._syncHash(v)` 和 `localStorage.setItem('zb_view', v)`。

---

### 6. 离线模式 tag 筛选被忽略

**文件**：`js/api.js`（`_offSynth` 函数）

**问题**：后端 `questions.js` 支持 `?tag=xxx` 筛选，但离线合成函数只读了 subject/chapter/type/mode/kw，忽略了 tag 参数。离线刷题时标签筛选无效。

**修复**：在过滤逻辑里加 `tag` 参数读取和 `x.tags.includes(tag)` 检查。

---

### 7. autoSaveExplain 跨会话重复追加

**文件**：`js/views/practice.js`（`_autoSaveExplain` 方法）

**问题**：`_aiSaved` 是运行时标志，刷新页面后丢失。用户生成解析 → 自动存入 analysis → 刷新 → 重新生成 → 又追加一段 `**AI 解析**`。反复操作导致 analysis 字段无限膨胀。

**修复**：存之前先检查 analysis 里是否已有 `**AI 解析**` 段，有则替换该段，无则追加。

```javascript
const aiIdx = existing.search(/\*\*AI 解析\*\*/);
if (aiIdx > 0) {
  merged = existing.slice(0, aiIdx).replace(/\n*---\s*$/, '').trim()
         + '\n\n---\n\n' + aiBlock;
} else if (aiIdx === 0) {
  merged = aiBlock;
} else {
  merged = (existing ? existing + '\n\n---\n\n' : '') + aiBlock;
}
```

---

### 8. 模考离开 Test 页计时器不暂停

**文件**：`js/app.js`（`go()` 方法）

**问题**：模考进行中用户点击其它导航标签页，`go()` 不清理 `mock.timer`。setInterval 继续后台倒数，到 0 时自动静默交卷。

**修复**：`go()` 离开 mock 时 `clearInterval(mock.timer); mock.timer = null; mockSnapSave()`；返回 mock 时检测 `mock.started && !mock.timer` 则 `_mockStartTimer()`。

---

### 9. onFav/onMaster/onNote 失败不回滚

**文件**：`js/views/practice.js`

**问题**：乐观更新——先改本地状态再发 API。如果 API 失败（网络错误、5xx），本地状态已改但服务端未保存。刷新后状态消失。

**修复**：在 catch 里回滚本地状态到操作前的值。

```javascript
async onFav(p) {
  const q = this.findQ(p.id);
  const prev = q && q.favorited;     // 记住原值
  if (q) q.favorited = p.value;
  try { await this.api(...); }
  catch (e) {
    if (q) q.favorited = prev;        // 失败回滚
    this.flash('收藏保存失败，已撤回');
  }
}
```

---

### 10. 离线合成缺 due 排序

**文件**：`js/api.js`（`_offSynth` 函数）

**问题**：后端支持 `order=due`（按 `due_at ASC`），离线合成只实现了 random 和 weak。

**修复**：加 `else if (order === 'due') { arr.sort((a, b) => (a.due_at || Infinity) - (b.due_at || Infinity)); }`。

---

### 11. startSession 无并发保护

**文件**：`js/views/practice.js`

**问题**：快速双击「刷新」发两次 API，第二次结果可能被第一次覆盖。

**修复**：入口加 `if (this.loading) return`。

---

### 12. startSession 的 loading 可能永久卡 true

**文件**：`js/views/practice.js`

**问题**：`loading = false` 只在 `view === forView` 时执行。如果 API 调用期间切了页再切回来，loading 不会重置，「刷新」按钮永远点不动。

**修复**：改为无条件 `this.loading = false`（finally 语义）。

---

### 13. Settings AI 中转站输入框在手机端消失（回归 Bug）

**文件**：`css/style.css`

**问题**：折叠筛选 CSS 用了 `.toolbar .field { display: none }`，太宽泛，把 Settings 页 `.toolbar` 里的 Base URL / API Key 输入框也隐藏了。

**修复**：选择器收窄为 `.toolbar.toolbar-filter .field`，只对刷题筛选栏生效。同时给 `.fold-body .toolbar .field` 加 `display: flex !important` 双保险。

---

### 14. 知识点卡片翻转动画坏了（回归 Bug）

**文件**：`css/style.css`

**问题**：把 `.kcard` 设了 `height: auto`，但 `.kcard-face` 是 `position: absolute`，需要固定高度的父容器。翻转动画失效，卡片高度塌缩。

**修复**：移除 height 覆盖，只改 grid 列数。

---

## 二、交互体验改进（12 项）

### 1. 筛选区手机端可折叠

**文件**：`js/tpl/view-practice.js` + `css/style.css` + `js/app.js`

默认收起为一行摘要「筛选 · 高数 · 单选 · 随机」，点击展开全部字段。省出整屏给题目。

---

### 2. 收藏按钮文案动态区分

**文件**：`js/tpl/view-practice.js`

有勾选 → 「刷选中 N 题」；无勾选 → 「刷全部收藏」。

---

### 3. 模考页顶部增加「开始测试」按钮

**文件**：`js/tpl/view-mock.js`

高级组卷区上方增加一个按钮，不用滚到底。底部按钮仅在高级组卷展开后显示（`v-if="mock.bp.on"`），避免桌面端出现两个重复按钮。

---

### 4. Reports 错题回顾按钮更醒目

**文件**：`js/tpl/view-stats.js`

模考记录的「错题回顾」从时间文字旁的 12px 小按钮改为独占一行、带图标的 13px 按钮。

---

### 5. Bank 批量操作区「删除」隔离

**文件**：`js/tpl/view-bank.js`

用 flex spacer 把「删除选中」推到最右端，与编辑类按钮视觉隔离。

---

### 6. 概念卡片下可追问 AI

**文件**：`js/components/question-card.js` + `js/views/practice.js`

追问输入框的 `v-if` 从 `aiText && !aiBusy` 放宽为 `(aiText || (aiKind==='concept' && aiCards.length)) && !aiBusy`。`aiAsk` 的入口守卫同步放开，上下文补发卡片内容序列化。

---

### 7. 揭晓后 E/K 快捷键

**文件**：`js/app.js` + `js/tpl/view-practice.js`

揭晓后按 `E` 触发解题解析，`K` 触发知识点卡片。快捷键提示行同步更新。

---

### 8. 范围下拉加「仅已掌握」

**文件**：`js/tpl/view-practice.js`

补全 `<option value="mastered">仅已掌握</option>`，让已有的空态模板能被触发。

---

### 9. Escape 键关闭弹窗

**文件**：`js/app.js`（`onKey` 方法）

bankEdit / dup / extractPreview / pdfAi / pdfv 五个弹窗支持 Escape 关闭。

---

### 10. 自评四档可取消 + 分档动画

**文件**：`js/components/question-card.js`

再次点击已选中的档位 → 取消自评（`selfGrade = null`），不发 API。动画分档：重来=抖动、困难=无动画、良好/简单=弹跳。

---

### 11. 答题动画反馈

**文件**：`js/components/question-card.js` + `css/style.css`

提交自动判分题后，答对：卡片轻微缩放弹跳（`ansCorrect`），答错：卡片左右快速抖动（`ansWrong`）。通过 `_flashAns(ok)` 临时添加 class，400ms 后移除。

---

### 12. 收藏页取消收藏二次确认

**文件**：`js/views/saved.js`

点 ☆ 取消收藏前弹 `confirm()` 对话框，显示题干前 30 字预览。

---

## 三、桌面端排版优化（9 项）

### 1. 全站容器统一放宽 860 → 960px

**文件**：`css/style.css`

topbar、tabs、wrap、底栏对齐公式全部同步更新至 960px。切换任何导航页零跳跃。

---

### 2. 筛选区字段宽度均衡

```css
.toolbar .field { flex: 1 1 auto; min-width: 120px; max-width: 260px; }
@media (min-width: 700px) {
  .toolbar .field { max-width: 220px; flex: 1 1 160px; }
}
```

章节下拉不再撑满整行。

---

### 3. 底栏桌面端改内联

```css
@media (min-width: 900px) {
  .q-nav-bar { position: relative; background: transparent; border-top: 1px solid var(--line); }
  .wrap.has-bottombar { padding-bottom: 32px; }
}
```

桌面端不再浪费 60px 固定底部空间。

---

### 4. Bank 删除按钮 hover 才显示

```css
@media (pointer: fine) {
  .bank-side .bk-del { opacity: 0; transition: opacity .15s; }
  .bank-row:hover .bank-side .bk-del { opacity: 1; }
}
```

---

### 5. 编辑弹窗放宽 640 → 800px

### 6. 热力图居中对齐

### 7. 深色模式卡片对比度提升

`--surface` 从 `#161B23` 提亮至 `#1C2230`，`--line` 从 `#28303C` 提亮至 `#2E3748`。卡片加 `box-shadow: 0 0 0 1px rgba(255,255,255,.04)` 边界感。

### 8. 选项卡片间距 9 → 12px

### 9. 题干与选项之间加分隔线

```css
.stem { padding-bottom: 16px; border-bottom: 1px solid color-mix(in srgb, var(--line) 60%, transparent); }
```

---

## 四、手机端排版优化（12 项）

### 1. 底栏 padding-bottom 84 → 110px

防止最后一个选项被固定底栏遮住。

### 2. 答题卡格子触屏下 34 → 40px

`@media (pointer: coarse) { .qnav-dot { width: 40px; height: 40px; } }`

### 3. 自评四档窄屏 2×2 grid 排列

`@media (max-width: 420px) { .selfgrade { display: grid; grid-template-columns: 1fr 1fr; } }`

### 4. Toast 位置上移防遮挡

`@media (max-width: 640px) { .toast { bottom: calc(130px + safe-area); } }`

### 5. Bank「全选全部匹配」手机端隐藏

不常用的操作不占首屏空间。

### 6. Saved 标签行横滑不换行

`@media (max-width: 420px) { .q-tags { flex-wrap: nowrap; overflow-x: auto; } }`

### 7. Tab 栏窄屏间距收紧

`@media (max-width: 420px) { .tabs { gap: 2px; } .tab { font-size: 13.5px; } }`

### 8. Settings 工具栏输入框不被隐藏

`.fold-body .toolbar .field { display: flex !important; max-width: 100% !important; }`

### 9. 书架分组间距收紧

shelf margin-bottom 20 → 14px，label margin-bottom 10 → 6px。

### 10. 书名右侧避让进度徽章

`.bk-card .t { padding-right: 52px; }`

### 11. 空状态图标放大 + 透明度提升

`.empty .big { font-size: 52px; opacity: .7; }`

### 12. 手机端按钮触摸反馈

`@media (pointer: coarse) { .btn:active { transform: scale(.97); } }`

---

## 五、用户体验打磨（6 项）

### 1. 底栏进度条

在上一题和下一题按钮之间加入细进度条 + 题号文字（`3/30`），一眼看到刷题进度。

```html
<div class="q-nav-prog">
  <div class="q-nav-prog-fill" :style="{width: (qi+1)/queue.length*100 + '%'}"></div>
  <span class="q-nav-prog-txt">{{ qi+1 }}/{{ queue.length }}</span>
</div>
```

### 2. 自评按钮色彩编码

- 重来：红色边框 + 文字（`--bad`）
- 困难：黄色边框 + 文字（`#d4952a`）
- 良好：绿色边框 + 文字（`--ok`）
- 简单：蓝色边框 + 文字（`--accent`）

不用读文字就知道该点哪个。

### 3. 已作答非对错选项淡化

`.opt.disabled:not(.correct):not(.wrong):not(.sel) { opacity: .55; }`

判分后视线自然聚焦到标绿/标红的选项。

### 4. 选项 hover 微位移

`@media (pointer: fine) { .opt:hover { transform: translateX(3px); } }`

### 5. 公式呼吸空间

`.rich .katex-display { margin: .6em 0; padding: 4px 0; }`

### 6. 桌面端题卡最大宽度限制

`@media (min-width: 960px) { .card-q { max-width: 780px; } }`

超长题干不铺满容器，阅读舒适度更高。

---

## 六、部署注意事项

1. 本次修改只涉及前端文件，后端 `functions/api/*.js` 未改动。
2. 部署后需要 **更新 Service Worker 版本号**：运行 `npm run bump` 或手动修改 `sw.js` 里的 `VERSION` 和 `CORE` 列表中的 `?v=` 参数，否则用户的浏览器仍会使用旧缓存。
3. CSS 变量 `--surface`、`--line` 在深色模式下有微调（提亮），如果你有自定义主题需要同步检查。
4. `question-card.js` 新增了 `_flashAns(ok)` 方法，如果有其他地方自定义了 `.card` 的 `animation` 属性，注意不要冲突。
