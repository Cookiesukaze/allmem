# AllMem

跨 AI 工具的统一记忆管理。作者痛恨和 AI 沟通的每一天。

你在 Claude Code 里讨论了半天架构，换到 Codex 又得从头说起；同一个项目开了无数对话，之前踩过的坑 AI 全忘了。AllMem 自动提取、整理、归档你在各个 AI 工具中的对话记忆，让 AI 从第一句话就了解你和你的项目。

## 如何使用：
**使用桌面应用即可体验下述功能**，在设置中为Claude、Codex**安装skill**，就可以额外在Claude、Codex中使用：

1. **同步记忆**
   - UI界面内： 在概览页点击“立即同步”，从本地AI工具日志中提取记忆并结构化
   - AI工具内： `/al-push` 保存当前对话到当前项目记忆
2. **查看/编辑**
   - UI界面内： 在桌面应用的项目页，可查看长期记忆、近期动态、版本历史等等，支持手动编辑和回滚
3. **注入记忆**
   - UI界面内： 在UI界面项目中点击注入，即可在项目界面生成一个CLAUDE.md / AGENTS.md
   - AI工具内：  `/al-pull` — 加载项目记忆到当前会话
4. **对话或搜索**
   - UI界面内： 在对话页基于已有记忆向 AI 提问
   - AI工具内：  `/al-search` — 在记忆中搜索相关内容

## 快速开始

前往 [Releases](https://github.com/Cookiesukaze/allmem/releases) 下载最新版本，双击运行即可。

## 开发者快速开始

```bash
# 依赖：Node.js >= 18, Rust >= 1.75
git clone https://github.com/Cookiesukaze/allmem.git
cd allmem
npm install
npx tauri dev
```

首次编译 Rust 约 2-5 分钟，之后会自动弹出桌面窗口。


## 技术栈

Tauri 2 (Rust) + React + TypeScript + Tailwind CSS + Zustand

LLM 使用 OpenAI 兼容接口（可自行配置 API Key 和模型）

## 未来方向

- 修复bug
- 完善从其它源（在线链接、本地文件）导入记忆
- 支持更多 AI 工具数据源（Cursor、小龙虾 等）
- 更省Token、更清晰、更多种记忆存储管理方式
- 上层应用

## License

[MIT](./LICENSE)
