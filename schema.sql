-- ============================================================
-- 广东专插本刷题系统  ·  Cloudflare D1 建表脚本
-- 在 Cloudflare 后台或本地执行：
--   wrangler d1 execute zhuanben --file=./schema.sql --remote
-- ============================================================

-- 题库主表（覆盖全部科目）
CREATE TABLE IF NOT EXISTS questions (
  id          TEXT PRIMARY KEY,                 -- 题目唯一 ID
  subject     TEXT NOT NULL,                    -- politics | english | math | chinese | computer
  chapter     TEXT,                             -- 章节 / 知识点，如「数据结构-线性表」
  type        TEXT NOT NULL,                    -- single_choice | multiple_choice | true_false | fill_blank | short_answer | code
  difficulty  INTEGER DEFAULT 3,                -- 难度 1~5
  source      TEXT,                             -- 来源，如「2023真题」
  passage     TEXT,                             -- 阅读理解 / 完形填空的公共材料（可空）
  stem        TEXT NOT NULL,                    -- 题干（支持 Markdown / LaTeX / 代码块）
  options     TEXT,                             -- JSON 字符串：[{"key":"A","text":"..."}]
  answer      TEXT NOT NULL,                    -- JSON 字符串：见 README 的字段说明
  analysis    TEXT,                             -- 解析
  tags        TEXT,                             -- JSON 字符串：["指针","链表"]
  created_at  INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_q_subject ON questions(subject);
CREATE INDEX IF NOT EXISTS idx_q_chapter ON questions(chapter);
CREATE INDEX IF NOT EXISTS idx_q_type    ON questions(type);

-- 每道题的学习进度（错题本 / 收藏 / 掌握状态）
CREATE TABLE IF NOT EXISTS progress (
  question_id  TEXT PRIMARY KEY,
  wrong_count  INTEGER DEFAULT 0,               -- 累计答错次数
  right_count  INTEGER DEFAULT 0,               -- 累计答对次数
  last_correct INTEGER,                         -- 最近一次：1 对 / 0 错 / NULL 未答
  favorited    INTEGER DEFAULT 0,               -- 是否收藏
  mastered     INTEGER DEFAULT 0,               -- 是否标记为「已掌握」（移出错题本）
  note         TEXT,                            -- 个人笔记
  updated_at   INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

-- 模拟考成绩记录（用于追踪进步曲线）
CREATE TABLE IF NOT EXISTS mock_results (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  subject          TEXT,
  total            INTEGER,
  correct          INTEGER,
  duration_seconds INTEGER,
  taken_at         INTEGER DEFAULT (unixepoch())
);
