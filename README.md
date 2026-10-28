<div align="center">

# 🤖 MazMaz Telegram Bot

**A High-Performance, Multimodal AI Agent for Telegram powered by Google Gemini and Bun Runtime**

---

🌐 **Language Selector / انتخاب زبان / 语言选择**  
[🇬🇧 **English (Default)**](README.md) &nbsp; | &nbsp; [🇮🇷 **فارسی (Persian)**](README_FA.md) &nbsp; | &nbsp; [🇨🇳 **简体中文 (Chinese)**](README_ZH.md)

---

[![Runtime](https://img.shields.io/badge/Runtime-Bun%20v1.4+-black?logo=bun)](https://bun.sh/)
[![Language](https://img.shields.io/badge/Language-TypeScript%205+-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Framework](https://img.shields.io/badge/Framework-grammY%20v1.34+-2ea44f?logo=telegram)](https://grammy.dev/)
[![Database](https://img.shields.io/badge/Database-SQLite%20(bun:sqlite)-003B57?logo=sqlite)](https://bun.sh/docs/api/sqlite)
[![AI Engine](https://img.shields.io/badge/AI%20Engine-Google%20Gemini%20API-4285F4?logo=google)](https://ai.google.dev/)
[![Tests](https://img.shields.io/badge/Tests-155+%20Passed-brightgreen)](https://bun.sh/docs/cli/test)

</div>

---

## 📖 Overview

**MazMaz** is a modular, agile, and resilient Telegram bot agent engineered for everyday smart conversations, technical computations, live web searches, community management, and rich multimedia streaming. Developed using the modern **Bun** runtime and **TypeScript**, it is architected for maximum fault tolerance, rapid startup, and high-throughput stability.

---

## ✨ Key Features

### 🧠 1. Multimodal Conversational AI & Vision
- **High-Speed Gemini Integration:** Powered by default by Google's latest Flash series models for ultra-low latency and natural multilingual understanding (Persian, English, etc.).
- **Live Streaming Responses:** Real-time token streaming in private chats for an immediate, fluid response experience with automatic Markdown formatting.
- **Multimodal Visual Intelligence (Vision):** Direct photo uploads and reply-to-photo analysis, supporting OCR text extraction, visual reasoning, chart understanding, and scene explanation.
- **Deep Telegram Context Awareness:** Seamlessly digests replied messages, native Telegram quotes (API 7.0+), channel/group forward headers, and sticker emojis.
- **Smart Wake-Word & Group Mentions:** Reacts when directly invoked ("مزمز", @bot username, or direct reply), maintaining respectful silence during unrelated group conversations.

---

### 🛠️ 2. Integrated AI Function Calling Tools
The model dynamically decides when to invoke built-in real-time tools:

| Icon | Tool Name | Description |
| :---: | :--- | :--- |
| 🔍 | **Live Web Search** | Real-time web retrieval for current events, news, and technical documentation with cited sources |
| 🌤️ | **Weather Forecast** | Precise temperature, weather conditions, wind, humidity, and multi-day forecasts worldwide |
| 💰 | **Financial & Gold Rates** | Real-time tracking of currency exchange rates, gold benchmarks, and fiat indicators |
| 🪙 | **Cryptocurrency Market** | Live prices for Bitcoin (BTC), Ethereum (ETH), USDT, TON, and altcoins with 24h change percentages |
| 🧮 | **Sandboxed Math Evaluator** | Safe mathematical evaluation of complex formulas, trigonometry, and engineering calculations |
| 🌐 | **Web Link Reader** | Extracts and synthesizes concise summaries from arbitrary web links shared by users |

---

### 📥 3. Media Downloader & Music Streaming
- **Social Media Downloader:**
  - Auto-detects media links from YouTube, Instagram, Pinterest, Twitter/X, and TikTok.
  - Interactive inline buttons to choose between **Video (MP4)** or **Audio extraction (MP3)**.
- **Music Search & Streaming:**
  - Fast search by track title or artist name.
  - Direct delivery of audio files (up to 50MB) complete with metadata and cover art in chat.

---

### 👥 4. Group Management & Moderation
- **Speaker Attribution & Identity Disambiguation:** Resolves user display names (`first_name` > `username` > fallback "کاربر"), tags current senders, formats reply quotes, and isolates message history turns to prevent speaker identity confusion in group conversations.
- **Group Digest:** AI-generated summary synthesizing the last 50 group messages into topics, questions, and action items.
- **Admin Moderation Commands:**
  - Permanent ban (`/ban` or natural language command).
  - Timed mute (`/mute` with duration support, e.g., 1h, 1d).
  - Unmute (`/unmute`).
  - Quick delete on reply (`/del`).
- **Group Command Isolation:** Automatically ignores slash commands addressed to other bots (e.g. `/cmd@OtherBot`) in group chats.
- **Profanity Filtering:** Detects abusive language, issues a humorous deterrent response, and alerts administrators.
- **Daily Rate Limiting:** Enforces configurable daily quotas per user in groups to prevent resource exhaustion.

---

### 📝 5. Personal Task & To-Do Management
- Add tasks quickly via commands (e.g. `/add Learn TypeScript` or natural language).
- Interactive inline keyboard to toggle completion status, inspect, or delete tasks.

---

## 🏗️ Architecture & Resilience

1. **API Key Rotation & Dynamic Cooldown:**
   - Automatic round-robin rotation across an array of Gemini API keys.
   - When encountering rate limits (HTTP 429) or transient server errors (HTTP 503), the key/model enters a temporary cooldown, immediately falling back to the next available credential.
2. **Two-Stage Tool Decoupling (Call 1 / Call 2):**
   - Stage 1 uses function-calling models to execute tools and gather context; Stage 2 formats the final conversational response, eliminating parameter validation errors.
3. **Safe Message Chunker:**
   - Automatically splits lengthy responses to comply with Telegram's 4096-character limit (chunking at ~3800 chars) while preserving unclosed Markdown code blocks (` ``` `) and HTML tags.
4. **Embedded SQLite Database:**
   - Zero-dependency local persistence using native `bun:sqlite` for users, groups, quotas, tasks, and customizable bot settings.

---

## 🚀 Getting Started

### Prerequisites
- [Bun](https://bun.sh/) (v1.1 or higher recommended)
- A Telegram Bot Token from [@BotFather](https://t.me/BotFather)
- At least one Google Gemini API key from [Google AI Studio](https://ai.google.dev/)

### 1. Clone the Repository
```bash
git clone https://github.com/MahdiMiex/mazmaz_bot_ts.git
cd mazmaz_bot_ts
```

### 2. Install Dependencies
```bash
bun install
```

### 3. Configure Environment Variables
Create a `.env` file based on the following template:

```env
# Telegram Bot Token from @BotFather
BOT_TOKEN=123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ

# Numerical Telegram IDs of administrators (comma-separated)
ADMIN_IDS=123456789

# Google Gemini API keys (comma-separated for auto-rotation)
GEMINI_API_KEYS=AIzaSyExampleKey1,AIzaSyExampleKey2
AI_MODEL=gemini-3.5-flash-lite

# Optional search provider keys
TAVILY_API_KEY=
BRAVE_API_KEY=
SEARXNG_URL=

# Proxy configuration (if needed)
USE_PROXY=true
PROXY_URL=http://127.0.0.1:10808

# Default daily message quota for non-admin group members
DEFAULT_DAILY_QUOTA=24
```

### 4. Run Test Suite
```bash
bun test
```

### 5. Start the Bot
- **Development Mode (with Hot Reload):**
```bash
bun run dev
```
- **Production Mode:**
```bash
bun run start
```

---

## 🕹️ Bot Commands

| Command | Description |
| :--- | :--- |
| `/start` | Launch the bot and display the main interactive menu |
| `/help` | Detailed command manual and usage instructions |
| `/clear` | Clear conversation memory and reset AI context |
| `/history` | View recent dialogue history or generate group digest |
| `/tasks` | Manage personal to-do list |
| `/stats` | View operational statistics and bot performance |
| `/changelog` | View the latest updates and release notes |
| `/ban [user]` | Permanently ban a user from the group (Admin only) |
| `/mute [duration]` | Mute a user for a specified duration (Admin only) |
| `/unmute` | Lift mute restrictions for a user (Admin only) |
| `/del` | Delete the replied message in a group (Admin only) |

---

## 🔒 Security & Privacy

- **Sandboxed Execution:** Mathematical evaluations run in a strictly isolated context without access to file systems or OS APIs.
- **Credential Hygiene:** No secrets, tokens, private endpoints, or admin identifiers are embedded in the codebase. All sensitive data is injected via environment variables.
- **Role-Based Access Control:** Administrative features and moderation tools are restricted exclusively to IDs defined in `ADMIN_IDS`.

---

## 💬 Support & Community

If you have questions, encounter any issues, or want to contribute to the project, feel free to reach out through any of our official channels:

| Channel | Contact / Link |
| :--- | :--- |
| 📧 **Support Email** | [mazmaz.miex@gmail.com](mailto:mazmaz.miex@gmail.com) |
| 🤖 **Telegram Bot** | [@mazmazAgentBot](https://t.me/mazmazAgentBot) |
| 💬 **Telegram Contact** | [@mmahdiz44](https://t.me/mmahdiz44) |
| 🐦 **Twitter / X** | [@MahdiMiex](https://x.com/MahdiMiex) |
| 🐙 **GitHub Issues** | [Submit an Issue](https://github.com/MahdiMiex/mazmaz_bot_ts/issues) |

---

## 📄 License

This project is licensed under the **MIT License**. You are free to use, modify, and distribute it in accordance with the license terms.
