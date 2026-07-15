// eslint 扁平配置（v9）
// 分两档：
//  · functions/tools/tests —— ES 模块，recommended 全开（no-undef 有效，能抓真实笔误）
//  · js/** 与 sw.js —— 无构建的全局脚本（跨文件 const 共享），no-undef 会误报成海，
//    改由「全文件语法解析 + Vue 模板真编译」两道测试门禁兜底，这里保留其余规则
import js from '@eslint/js';
import globals from 'globals';

const relaxed = {
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-useless-escape': 'off',
  'no-cond-assign': ['error', 'except-parens'],
  'no-useless-assignment': 'off',      // 「初始值必被各分支覆盖」类误报太多（let x=[] 兜底属常见防御式写法）
  'preserve-caught-error': 'off',      // 抛新错必须带 cause 的新规则，对本项目的用户可读报错风格不适用
};

export default [
  { ignores: ['node_modules/**'] },
  {
    files: ['functions/**/*.js', 'tools/**/*.mjs', 'tests/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.worker, ...globals.node },
    },
    rules: { ...js.configs.recommended.rules, ...relaxed },
  },
  {
    files: ['js/**/*.js', 'sw.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: {
      ...js.configs.recommended.rules,
      ...relaxed,
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-control-regex': 'off',
      'no-prototype-builtins': 'off',
      'no-async-promise-executor': 'off',
      'no-misleading-character-class': 'off',
    },
  },
];
