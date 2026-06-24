# 专插本刷题系统 · 全 Cloudflare 免费方案

一个跑在 Cloudflare 免费额度上的个人刷题工具，面向软件技术/计算机软件方向，覆盖**主要考试科目**（政治理论 / 英语 / 高等数学 / 计算机基础与程序设计），支持单选、多选、判断、填空、简答论述、程序设计六种题型。

题目清洗、存储、刷题、错题本、模拟考、统计**全部在 Cloudflare 内完成**，不需要本地跑脚本，也不需要自建后端或数据库服务器。

---

## 一、相比原方案的优化点

| | 原方案 | 本方案 |
|---|---|---|
| 题库清洗 | 本地跑 Python 脚本调 API | Cloudflare Functions 在线清洗，浏览器里粘贴即可入库 |
| 数据存储 | 静态 JSON 文件 + 浏览器 localStorage | Cloudflare D1（SQLite），**多设备同步**：手机刷的错题电脑也能复习 |
| 科目覆盖 | 偏重专业课 | 软件技术方向科目覆盖，题型自适应（公式 LaTeX、代码高亮、阅读材料） |
| 录题成本 | 每次都要消耗 AI | 已有结构化题库可「直接导入 JSON」**零成本**；只有清洗杂乱原文才用 AI |
| 密钥安全 | Key 容易散落在脚本里 | Key 存 Cloudflare 加密 Secret，前端与代码都看不到 |
| 防滥用 | 无 | 全部接口用访问口令保护，别人拿到网址也用不了、烧不了你的额度 |

**架构**：Cloudflare Pages（托管前端） + Pages Functions（`/api/*` 接口，含 AI 清洗） + D1（数据库）。

---

## 二、免费额度够不够？

够，个人使用绰绰有余：

- **Functions / Workers**：10 万次请求 / 天
- **D1**：5 GB 存储、读 500 万行 / 天、写 10 万行 / 天
- **Pages**：静态访问不限量、构建 500 次 / 月

> 注意：调用大模型清洗题目的**费用走你自己的「API 中转站」**，不是 Cloudflare 收费。所以「直接导入 JSON」这条路完全免费，建议优先用。

---

## 三、目录结构

```
.
├── public/
│   ├── index.html            # 前端单页应用（刷题界面）
│   └── sample-questions.json # 示例题库（覆盖全科目/题型，可零成本导入测试）
├── functions/api/
│   ├── _utils.js             # 公共工具（鉴权、JSON 响应、行转换）
│   ├── process.js            # POST 录题：AI 清洗 或 直接导入 JSON
│   ├── questions.js          # GET 取题（按科目/章节/题型/模式筛选）
│   └── progress.js           # 答题记录 / 错题 / 收藏 / 笔记 / 模拟考成绩 / 统计
├── schema.sql                # D1 建表脚本
└── wrangler.toml             # 仅 CLI 部署时需要
```

---

## 四、部署步骤（推荐：连接 GitHub 自动部署）

### 1. 准备
- 注册 [Cloudflare](https://dash.cloudflare.com)（免费）。
- 把本项目推到你自己的 GitHub 仓库（建议设为私有）。

### 2. 创建 D1 数据库
后台 → **Storage & Databases → D1 → Create database**，命名 `zhuanben`。

### 3. 建表
进入该数据库 → **Console** 标签 → 把 `schema.sql` 全部内容粘进去执行。
（命令行用户可改用：`wrangler d1 execute zhuanben --remote --file=./schema.sql`）

### 4. 创建 Pages 项目
后台 → **Workers & Pages → Create → Pages → Connect to Git** → 选你的仓库。
构建设置：
- Framework preset：**None**
- Build command：**留空**
- Build output directory：**`public`**

点 **Save and Deploy**。

### 5. 绑定 D1 到 Pages（关键）
项目 → **Settings → Bindings（或 Functions）→ D1 database bindings → Add**：
- Variable name 填 **`DB`**（务必是 DB，代码按这个名字找数据库）
- Database 选 `zhuanben`

### 6. 设置环境变量
项目 → **Settings → Variables and Secrets**，添加四个：

| 变量名 | 类型 | 值（示例） |
|---|---|---|
| `AI_BASE_URL` | Plaintext | 你的中转站地址，写到 `/v1`，如 `https://api.xxx.com/v1` |
| `AI_MODEL` | Plaintext | 模型名，如 `gpt-4o`、`claude-3-5-sonnet`、`grok-2` |
| `AI_API_KEY` | **Secret（加密）** | 你中转站的密钥 |
| `APP_TOKEN` | **Secret（加密）** | 你自己随便定一串访问口令，用于登录这个 App |

> **把 `AI_API_KEY` 设为 Secret，绝不要写进代码或提交到 Git。** 你不需要把密钥发给任何人，它只在 Cloudflare 服务端被读取。

### 7. 重新部署并使用
改完绑定/变量后，到 **Deployments → 最新一次 → Retry deployment**（让配置生效）。
打开分配给你的 `https://你的项目.pages.dev`：
1. 进「**设置**」，填入你刚设的 `APP_TOKEN`，保存；
2. 进「**录题**」→ 点「**载入示例题库**」→「**导入入库**」；
3. 回「**刷题**」开始做题。一切正常后，再去录入你自己的真题。

---

## 五、三种录题方式

### 方式 A：AI 清洗杂乱原文（消耗中转站额度）
从 PDF、文库、论坛复制来的乱七八糟的题目，整段贴进「录题 → AI 清洗原文」，选好默认科目，点按钮。AI 会自动识别题型、拆分选项、对应答案与解析、保留公式和代码，然后入库。建议每次 5~20 题，太多容易超模型上下文。

### 方式 B：直接导入 JSON（零成本，优先）
已经有结构化题库（比如网上开源的计算机二级题库、自己整理好的），按下面的字段拼成 JSON 数组，贴进「直接导入 JSON」即可，不花一分钱 AI 费用。

#### 题目字段说明
```jsonc
{
  "id": "可选，留空自动生成",
  "subject": "politics | english | math | computer",
  "chapter": "章节，如 数据结构-线性表（可空）",
  "type": "single_choice | multiple_choice | true_false | fill_blank | short_answer | code",
  "difficulty": 3,                          // 1~5
  "source": "2023真题（可空）",
  "passage": "阅读理解/完形填空的公共材料；无则空字符串。同篇多题各自重复 passage",
  "stem": "题干，数学用 $...$ 包公式，代码用 ```c ... ``` 包代码块",
  "options": [{"key":"A","text":"..."}],    // 仅选择题，其他题型为 []
  "answer": ["..."],                         // 见下表
  "analysis": "解析（可空，建议有）",
  "tags": ["关键词"]
}
```

#### answer 字段格式（按题型）
| 题型 | answer 写法 | 判分方式 |
|---|---|---|
| single_choice | `["B"]` | 自动 |
| multiple_choice | `["A","C"]` | 自动（需完全一致） |
| true_false | `["T"]` 正确 / `["F"]` 错误 | 自动 |
| fill_blank | `["标准答案","可接受的另一种写法"]` | 自动比对 + 可手动自评修正 |
| short_answer | `["参考答案文本（可含 Markdown/LaTeX）"]` | 对照参考答案自评 |
| code | `["```c\n参考代码\n```"]` | 对照参考答案自评 |

完整示例见 `public/sample-questions.json`。

### 方式 C：上传 PDF（在浏览器解析，全程在 Cloudflare 内完成）
「录题 → 上传 PDF」选一个 PDF，**解析在你浏览器里完成**（站点会按需从 CDN 加载 pdf.js），随后分块发给 Cloudflare 上的 `/api/process` 做 AI 结构化并入库 D1。不需要本地脚本，也没有外部服务。

- **文字版 PDF**：直接抽取文字 → 分块 → 走文本路径（便宜，等同方式 A 的自动批处理），带逐块进度。
- **扫描版 PDF**：每页渲染成图片 → 交给你中转站的**视觉模型**识别并结构化。**需所选模型支持图片输入**（如 `gpt-4o`、`claude-3-5-sonnet`），花费更高、速度更慢。

> 仓库里另附的本地脚本 `pdf_to_json.py` 现在是**可选**的：若你想在本机批量预处理、人工校对后再导入，可以用它；只想在网页里一键搞定，用方式 C 即可。

---

## 六、功能一览

- **刷题**：按科目 / 章节 / 题型 / 范围（全部、未做、错题、收藏）筛选，随机或顺序出题。
- **错题本**：答错自动收录，复习时若已弄懂可「标记已掌握」移出。
- **收藏**：题目右上角 ★ 收藏，单独成册。
- **模拟考**：选科目、题量、时长，限时作答，倒计时结束自动交卷；客观题自动判分并给出分数图章，错题自动进错题本；可勾选「仅客观题」获得完全自动判分的模拟卷。
- **统计**：各科正确率、已做 / 待复习 / 已掌握数量、最近模拟考成绩曲线。
- **暗黑模式**：右上角切换，适合晚上刷题；偏好记在本机。
- **笔记**：每题可写易错点 / 记忆口诀，跟随题目同步。

---

## 七、安全须知

- 所有 `/api/*` 接口都要求 `APP_TOKEN`，别人即使拿到你的网址也无法读题或触发 AI 花钱。
- `AI_API_KEY` 只作为 Cloudflare 加密 Secret 存在，前端、浏览器、Git 仓库里都没有它。
- `APP_TOKEN` 只保存在你本机浏览器的 localStorage，不会上传。
- 建议 GitHub 仓库设为私有；`wrangler.toml` 里不要填真实密钥（密钥一律用 `wrangler pages secret put`）。

---

## 八、国内访问与可选增强

- **CDN**：前端依赖（Vue / KaTeX / highlight.js / marked / 以及上传 PDF 时按需加载的 pdf.js）走 `cdnjs.cloudflare.com`（Cloudflare 自家 CDN，国内多数网络可达）；字体用系统字体，无需谷歌字体。若某些网络下加载偏慢，可把这几个库文件下载进 `public/`，再把 `index.html` 顶部的 `<script>`/`<link>`（及 `ensurePdfjs` 里的 pdf.js 地址）改成本地相对路径自托管。
- **AI Gateway（可选）**：可在中转站之前再套一层 [Cloudflare AI Gateway](https://developers.cloudflare.com/ai-gateway/)，获得调用缓存（相同原文不重复花钱）和用量分析，把 `AI_BASE_URL` 换成 Gateway 给的地址即可。
- **命令行部署（替代方案）**：填好 `wrangler.toml` 里的 `database_id`，执行 `wrangler pages secret put AI_API_KEY`、`wrangler pages secret put APP_TOKEN`，再 `wrangler pages deploy public`。

---

## 九、9 个月备考与开发计划（2026.06 → 2027.03）

> 你是软件技术专业，这个工具本身就是个能写进简历的小项目（Vue + Serverless + D1 + LLM 应用）。一边备考一边迭代，两不耽误。

**阶段一 · 基建与资料收集（6 月 – 7 月）**
- 开发：按本仓库部署上线，跑通示例题库；熟悉「直接导入 JSON」和「AI 清洗」两条录题路径。
- 备考：收集近 5 年五科真题（政治、英语、高等数学、计算机基础与程序设计），每天用 AI 清洗 1~2 套入库。
- 专业课：先把 C 语言基本语法、选择 / 循环结构过一遍。

**阶段二 · 基础巩固（8 月 – 10 月）**
- 开发：题库录入到 500~1000 题；体验暗黑模式做夜间复习。
- 备考：通读教材（谭浩强《C 程序设计》＋ 严蔚敏《数据结构》、高数基础、英语词汇）。
- 日常：早上用 App 刷 30 道英语词汇 / 语法；每学完一章，用「章节」筛选定点刷该章题目；政治当睡前读物。

**阶段三 · 强化刷题与迭代（11 月 – 次年 1 月）**
- 开发：常用「模拟考」功能，限时 120 分钟 / 100 题。
- 备考：题海 + 错题本攻坚，盯着「统计」里正确率最低的科目补。
- 日常：晚上整块时间做一套模拟卷；高数狂刷计算题（极限、导数、积分）；定期清「错题本」，弄懂后标记已掌握。

**阶段四 · 冲刺与背诵（2 月 – 3 月）**
- 开发：封板，只当生产力工具用。
- 备考：政治大题狂背，英语作文模板狂背，专业课**离开键盘手写代码**（冒泡排序、链表逆置、文件读写等）。
- 日常：反复刷「错题本」直到清零；政治配合预测卷背大题。

加油，9 个月足够把这件事做扎实。
