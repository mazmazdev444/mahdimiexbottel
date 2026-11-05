<div align="center">

# 🤖 MazMaz Telegram Bot (智能全能代理机器人)

**基于 Google Gemini AI 与 Bun 现代运行时构建的高性能、多模态全功能 Telegram 智能助理**

---

🌐 **Language Selector / انتخاب زبان / 语言选择**  
[🇬🇧 **English (Default)**](README.md) &nbsp; | &nbsp; [🇮🇷 **فارسی (Persian)**](README_FA.md) &nbsp; | &nbsp; [🇨🇳 **简体中文 (Chinese)**](README_ZH.md)

---

[![Runtime](https://img.shields.io/badge/Runtime-Bun%20v1.4+-black?logo=bun)](https://bun.sh/)
[![Language](https://img.shields.io/badge/Language-TypeScript%205+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Framework](https://img.shields.io/badge/Framework-grammY%20v1.34+-2ea44f?logo=telegram)](https://grammy.dev/)
[![Database](https://img.shields.io/badge/Database-SQLite%20(bun:sqlite)-003B57?logo=sqlite)](https://bun.sh/docs/api/sqlite)
[![AI Engine](https://img.shields.io/badge/AI%20Engine-Google%20Gemini%20API-4285F4?logo=google)](https://ai.google.dev/)
[![Tests](https://img.shields.io/badge/Tests-270+%20Passed-brightgreen)](https://bun.sh/docs/cli/test)

</div>

---

## 📖 项目简介 (Overview)

**MazMaz** 是一款模块化、高敏捷性、工业级强度的 Telegram 智能机器人，专为日常多轮对话、技术计算、实时网络检索、社群管理以及流媒体下载而构建。项目采用现代化的 **Bun** 运行时与 **TypeScript** 开发，针对高并发及网络故障进行了深度的容错与高可用设计。

---

## ✨ 核心特性与功能 (Key Features)

### 🧠 1. 多模态对话与计算机视觉 (Multimodal AI & Vision)
- **Gemini 高速模型集成：** 默认采用 Google Flash 系列模型，实现极低延迟的高质量多语言问答。
- **私聊实时流式输出 (Live Streaming)：** 在私聊中支持逐字流式打印，带来流畅自然的即时打字机交互体验。
- **图像多模态视觉分析 (Vision)：** 支持直接发送图片或回复消息中的图片，进行 OCR 文字提取、图表解析及场景分析。
- **Telegram 上下文深度解析：** 智能识别回复（Reply）、引用（Quote）、频道/社群转发来源及表情包含义。
- **唤醒词机制 (Wake-Word)：** 在群聊中仅在被唤醒（“مزمز”、@用户名或直接回复）时响应，避免无谓刷屏。

---

### 🛠️ 2. 内置 AI 工具箱 (AI Function Calling Tools)
模型支持自主判定并调用以下实时扩展工具：

| 图标 | 工具名称 | 功能描述 |
| :---: | :--- | :--- |
| 🔍 | **网页搜索 (Web Search)** | 实时检索互联网最新资讯、技术文档，并在回答中附带可溯源引用链接 |
| 🌤️ | **实时气象 (Weather)** | 全球主要城市的气温、气象预报、湿度与风速查询 |
| 💰 | **金融与汇率 (Financial Rates)** | 实时外汇汇率、黄金价格及法币基准汇率查询 |
| 🪙 | **加密货币行情 (Crypto Market)** | 比特币 (BTC)、以太坊 (ETH)、USDT、TON 等主流代币价格与 24h 涨跌幅 |
| 🧮 | **安全数学计算 (Math Evaluator)** | 在隔离沙箱中执行精准数学计算、三角函数与工程表达式求值 |
| 🌐 | **网页深度阅读 (Link Reader)** | 自动提取用户发送的网页主体内容并输出精炼摘要 |

---

### 📥 3. 多媒体下载与音乐流媒体 (Media & Music Downloader)
- **社交网络视频/音频解析：**
  - 自动识别来自 YouTube、Instagram、Pinterest、Twitter/X 和 TikTok 的链接。
  - 内联交互键盘选择下载格式：**MP4 视频** 或 **提取 MP3 音频**。
- **音乐点播与推送：**
  - 支持按曲名、歌手搜索歌曲，直接向 Telegram 推送带封面和元数据的音频文件。

---

### 👥 4. 群组智能管理与审核 (Group Management & Moderation)
- **发言人精准识别与身份消歧 (Speaker Attribution)：** 智能优先使用用户自然显示名（`first_name` > `username` > “کاربر”），精准标注发言者元数据与回复引用，杜绝群成员身份混淆。
- **群聊摘要生成 (Group Digest)：** 一键提炼社群最近 50 条消息的主题、提问与决策要点。
- **管理员便捷指令：**
  - 封禁成员 (`/ban` 或自然语言指令)。
  - 定时禁言 (`/mute` 支持指定时长如 1h、1d 等)。
  - 解除禁言 (`/unmute`)。
  - 引用快速删帖 (`/del`)。
- **群组指令智能隔离：** 自动忽略群聊中发给其他机器人的指令（如 `/cmd@OtherBot`），互不干扰。
- **敏感词过滤与风控：** 识别不良言论并自动向管理员告警。
- **每日限额配额 (Rate Limiting)：** 支持按群组或用户分配每日可用额度，防止 API 滥用。

---

### 📝 5. 待办事项管理 (To-Do & Tasks)
- 快速添加个人任务（如 `/add 学习 Python` 或自然语言文本）。
- 内联按钮交互管理，支持标记已完成、删除任务及查看列表。

---

## 🏗️ 技术架构与高可用设计 (Architecture & Resilience)

1. **API 密钥轮询与动态冷却 (Key Rotation & Cooldown)：**
   - 多密钥并发轮询机制。
   - 遭遇速率限制 (HTTP 429) 或服务瞬态故障 (HTTP 503) 时自动触发模型/密钥冷却，并无缝重试下一个可用密钥。
2. **两阶段工具调用解耦 (Call 1 / Call 2 Decoupling)：**
   - 阶段一针对 Function Calling 精准执行工具并获取上下文，阶段二由对话模型整合输出最终排版，杜绝格式异常。
3. **安全消息分块器 (Safe Message Chunker)：**
   - 超长文本自动按 Telegram 限制（3800 字符以内）分片发送，完整保留 Markdown 代码块和 HTML 标签开闭状态。
4. **嵌入式 SQLite 存储：**
   - 利用 `bun:sqlite` 原生高性能接口持久化用户设置、群组状态、历史配额与待办事项。

---

## 🚀 本地快速启动 (Getting Started)

### 前置条件
- 已安装 [Bun](https://bun.sh/) (推荐 v1.1+)
- 从 [BotFather@](https://t.me/BotFather) 获取的 Telegram Bot Token
- 从 [Google AI Studio](https://ai.google.dev/) 获取的 Gemini API 密钥

### 1. 克隆代码仓库
```bash
git clone https://github.com/MahdiMiex/mazmaz_bot_ts.git
cd mazmaz_bot_ts
```

### 2. 安装依赖
```bash
bun install
```

### 3. 配置环境变量
参考以下模板创建 `.env` 文件：

```env
# 从 BotFather 获取的 Telegram 机器人 Token
BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ

# 管理员数字 ID（多个 ID 用逗号隔开）
ADMIN_IDS=123456789

# Google Gemini API 密钥（支持多个密钥逗号分隔轮询）
GEMINI_API_KEYS=AIzaSyExampleKey1,AIzaSyExampleKey2
AI_MODEL=gemini-3.5-flash-lite

# 可选搜索引擎扩展配置
TAVILY_API_KEY=
BRAVE_API_KEY=
SEARXNG_URL=

# 网络代理配置（如需科学上网）
USE_PROXY=true
PROXY_URL=http://127.0.0.1:10808

# 普通群成员每日可用消息配额
DEFAULT_DAILY_QUOTA=24
```

### 4. 运行单元测试
```bash
bun test
```

### 5. 启动服务
- **开发模式（热重载）：**
```bash
bun run dev
```
- **生产模式：**
```bash
bun run start
```

---

## 🕹️ 常用指令列表 (Bot Commands)

| 指令 | 描述 |
| :--- | :--- |
| `/start` | 启动机器人并显示主菜单 |
| `/help` | 查看详细功能介绍与指令手册 |
| `/clear` | 清理当前对话的记忆与上下文 (Reset Context) |
| `/history` | 查看近期对话历史记录或生成群聊摘要 |
| `/tasks` | 管理个人待办事项列表 |
| `/stats` | 查看机器人运行统计与数据分析 |
| `/changelog` | 查看最新版本更新日志 |
| `/ban [用户]` | 封禁群成员（仅限管理员） |
| `/mute [时长]` | 禁言群成员（仅限管理员） |
| `/unmute` | 解除群成员禁言（仅限管理员） |
| `/del` | 删除所回复的消息（仅限管理员） |

---

## 🔒 安全性与隐私合规 (Security & Privacy)

- **计算沙箱隔离：** 数学公式计算在受限环境中执行，禁止访问文件系统或网络系统调用。
- **凭证脱敏与保护：** 生产环境敏感凭证严禁硬编码至仓库，全部通过环境变量动态注入。
- **细粒度权限控制：** 社群管理及系统配置指令严格受限至 `ADMIN_IDS` 所包含的用户。

---

## 💬 技术支持与社区交流 (Support & Contact)

如果您在使用 MazMaz 过程中遇到任何问题、有任何疑问或希望参与贡献，欢迎通过以下渠道与我们联系：

| 渠道 | 链接 / 联系方式 |
| :--- | :--- |
| 📧 **技术支持邮箱** | [mazmaz.miex@gmail.com](mailto:mazmaz.miex@gmail.com) |
| 🤖 **Telegram 机器人** | [@mazmazAgentBot](https://t.me/mazmazAgentBot) |
| 💬 **Telegram 开发者** | [@mmahdiz44](https://t.me/mmahdiz44) |
| 🐦 **Twitter / X 主页** | [@MahdiMiex](https://x.com/MahdiMiex) |
| 🐙 **GitHub Issues** | [提交反馈与建议](https://github.com/MahdiMiex/mazmaz_bot_ts/issues) |

---

## 📄 开源许可证 (License)

本项目基于 **MIT** 许可证开源。遵循许可证条款即可自由使用、修改与二次分发。
