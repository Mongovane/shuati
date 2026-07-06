-- ============================================================
-- Cloudflare D1 完整建表 + 索引脚本
-- 这是唯一需要执行的数据库脚本，跑它就得到全部表和全部索引。
-- 执行（新库或旧库都安全，全部 IF NOT EXISTS，不会动已有数据）：
--   wrangler d1 execute <你的库名> --file=./schema.sql --remote
--
-- 【本文件包含的优化 · 索引】
--   · questions(subject) / (chapter) / (type) / (subject,chapter 复合)
--     —— 按科目、章节筛选取题时走索引，题量上万也不慢
--   · progress(mastered) / (favorited) / (wrong_count)
--     —— 错题本/收藏/掌握越攒越多时，「仅错题/仅收藏/已掌握」筛选不再全表扫
--   · materials(subject) / (source)
--
-- 【不在本文件、属于代码层的优化（SQL 写不了，另在对应文件）】
--   · 随机抽题不再全表 ORDER BY RANDOM()：改用 rowid 阈值窗口
--     —— 见后端 functions/api/questions.js
--   · 抽题预览显示「出自第 N 页」：见前端 public/js/app.js
-- ============================================================

-- 题库主表（覆盖全部科目）
CREATE TABLE IF NOT EXISTS questions (
  id          TEXT PRIMARY KEY,                 -- 题目唯一 ID
  subject     TEXT NOT NULL,                    -- politics | english | math | computer
  chapter     TEXT,                             -- 章节 / 知识点，如「数据结构-线性表」
  type        TEXT NOT NULL,                    -- single_choice | multiple_choice | true_false | fill_blank | short_answer | code
  difficulty  INTEGER DEFAULT 3,                -- 难度 1~5
  source      TEXT,                             -- 来源，如「2023真题」/ 书名
  page        INTEGER,                           -- 来自原书第几页（抽题时记录，可空）
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
CREATE INDEX IF NOT EXISTS idx_q_subject_chapter ON questions(subject, chapter);

-- 每道题的学习进度（错题本 / 收藏 / 掌握状态）
CREATE TABLE IF NOT EXISTS progress (
  question_id  TEXT PRIMARY KEY,
  wrong_count  INTEGER DEFAULT 0,               -- 累计答错次数
  right_count  INTEGER DEFAULT 0,               -- 累计答对次数
  last_correct INTEGER,                         -- 最近一次：1 对 / 0 错 / NULL 未答
  favorited    INTEGER DEFAULT 0,               -- 是否收藏
  mastered     INTEGER DEFAULT 0,               -- 是否标记为「已掌握」（移出错题本）
  note         TEXT,                            -- 个人笔记
  due_at       INTEGER,                         -- SRS：下次到期复习时间（unix 秒）
  interval_days REAL DEFAULT 0,                 -- SRS：当前间隔（天）
  ease         REAL DEFAULT 2.5,                -- SRS：难度系数（1.3~3.0）
  updated_at   INTEGER DEFAULT (unixepoch()),
  FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_pr_mastered  ON progress(mastered);
CREATE INDEX IF NOT EXISTS idx_pr_favorited ON progress(favorited);
CREATE INDEX IF NOT EXISTS idx_pr_wrong     ON progress(wrong_count);
-- 注意：idx_pr_due（ON progress(due_at)）不在本脚本里——老库的 progress 表还没有 due_at 列，
-- 在这里建索引会让整个脚本中断。该索引与 due_at/interval_days/ease 三列均由后端在
-- 首次 API 请求时自动补齐（functions/api/_utils.js 的 ensureSrsSchema），新库老库都无需手动处理。
-- 若想手动补（可选，老库一次性）：
--   ALTER TABLE progress ADD COLUMN due_at INTEGER;
--   ALTER TABLE progress ADD COLUMN interval_days REAL DEFAULT 0;
--   ALTER TABLE progress ADD COLUMN ease REAL DEFAULT 2.5;
--   CREATE INDEX IF NOT EXISTS idx_pr_due ON progress(due_at);

-- 模拟考成绩记录（用于追踪进步曲线）
CREATE TABLE IF NOT EXISTS mock_results (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  subject          TEXT,
  total            INTEGER,
  correct          INTEGER,
  duration_seconds INTEGER,
  taken_at         INTEGER DEFAULT (unixepoch())
);

-- OCR 导入的教材/资料页（动态内置到 Books 教材阅读）
CREATE TABLE IF NOT EXISTS materials (
  id          TEXT PRIMARY KEY,
  subject     TEXT NOT NULL,
  title       TEXT NOT NULL,
  source      TEXT,
  page        INTEGER,
  page_image  TEXT,
  content_md  TEXT,
  summary     TEXT,
  tags        TEXT,
  created_at  INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_m_subject ON materials(subject);
CREATE INDEX IF NOT EXISTS idx_m_source  ON materials(source);

-- 上传的原版 PDF（文件存 R2，元信息存这里；R2 binding 名须为 PDF_BUCKET）
CREATE TABLE IF NOT EXISTS pdfs (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  subject     TEXT,
  size        INTEGER,
  created_at  INTEGER DEFAULT (unixepoch())
);

-- Workers AI OCR 每日用量计数（按 UTC 日，用于免费额度硬上限）
CREATE TABLE IF NOT EXISTS ai_usage (
  day    TEXT PRIMARY KEY,
  pages  INTEGER DEFAULT 0
);

-- 每次答题的流水（统计热力图 / 每日刷题量用）
CREATE TABLE IF NOT EXISTS answer_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id TEXT,
  is_correct  INTEGER,
  ts          INTEGER DEFAULT (unixepoch())
);

-- 模拟考逐题作答明细（错题回顾用；is_correct 为 NULL 表示主观题未判分）
CREATE TABLE IF NOT EXISTS mock_answers (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mock_id     INTEGER,
  question_id TEXT,
  is_correct  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ma_mock ON mock_answers(mock_id);

-- 访问口令失败限速（同 IP 15 分钟 20 次），由后端自动维护
CREATE TABLE IF NOT EXISTS auth_fails (
  ip TEXT PRIMARY KEY,
  n  INTEGER DEFAULT 0,
  ts INTEGER
);
