// 主应用模板：由 js/tpl/*.js 分片装配（tools/split-template.mjs 一次性拆分生成）。
// 各分片是同一棵 Vue 模板树按视图切开的连续片段，join 顺序即 DOM 顺序，不能调换、不能漏。
// index.html 与 sw.js 的预缓存清单需与分片文件保持同步（bump 脚本只管版本号，不管清单增删）。
const APP_TEMPLATE = [
  TPL_SHELL_OPEN,
  TPL_VIEW_PRACTICE,
  TPL_VIEW_BOOKS,
  TPL_VIEW_MOCK,
  TPL_VIEW_BANK,
  TPL_VIEW_STATS,
  TPL_VIEW_INGEST,
  TPL_VIEW_SETTINGS,
  TPL_SHELL_CLOSE,
].join('');
