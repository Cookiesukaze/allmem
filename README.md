# AllMem

跨 Vibe Coder 又不只是 Vibe Coder 的统一记忆管理。

作者痛恨和 AI 沟通的每一天。
你在 Claude Code 里讨论了半天架构，换到 Codex 又得从头说起；同一个项目开了一亿个对话，之前踩过的坑 AI 全忘了。AllMem 可使用低廉的过去的LLM为你管理记忆，自动提取、整理、归档你在各个 AI 工具中的对话记忆，让 AI 从第一句话就了解你和你的项目。

## 核心功能

- **自动提取** — 扫描 Claude Code / Codex CLI 的本地对话日志，用 LLM 提炼结构化记忆
- **WAL + 压缩** — 轻量追加近期摘要，攒够阈值自动压缩为长期记忆，平衡组织性与 token 开销
- **一键注入** — 安装 Skill 后，在任意项目目录说 `/allmem` 即可将记忆写入 CLAUDE.md / AGENTS.md
- **隐私保护** — 同步前自动替换敏感词（姓名、手机号等），防止泄露到记忆中
- **本地化** — 所有数据存在 `~/.allmem/`，无云端依赖

## 开发者快速开始（暂无release）

```bash
# 依赖：Node.js >= 18, Rust >= 1.75
git clone https://github.com/Cookiesukaze/allmem.git
cd allmem
npm install
npx tauri dev
```

首次编译 Rust 约 2-5 分钟，之后会自动弹出桌面窗口。

## 使用方式

使用我们提供的桌面应用的UI界面，或在 AI 工具中使用：

1. **同步记忆** — 在概览页点击「立即同步」，自动从本地 AI 工具日志中提取记忆
2. **查看/编辑** — 在项目页查看长期记忆、近期动态、版本历史，支持手动编辑和回滚
3. **注入上下文** — 在设置页安装 Skill，然后在 Claude Code 中使用：
   - `/allmem` — 加载项目记忆到当前会话
   - `/allmem-sync` — 保存当前对话到记忆
   - `/allmem-undo` — 撤销注入的上下文
4. **对话问答** — 在对话页基于已有记忆向 AI 提问

## 技术栈

Tauri 2 (Rust) + React + TypeScript + Tailwind CSS + Zustand

LLM 默认使用阿里云 DashScope qwen3.5-plus（OpenAI 兼容接口，可替换）

## 未来方向

- 完善从其它源（在线链接、本地文件）导入记忆
- 支持更多 AI 工具数据源（Cursor、小龙虾 等）
- 基于记忆的数字分身 — 让 AI 成为你的分身，主动为你排忧解难。
- 更省Token、更清晰、更多种记忆存储管理方式。
 
