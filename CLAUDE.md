# AllMem

## 项目简介

AllMem 是一个**跨 AI 工具统一记忆管理**桌面应用。它自动从你使用的多个 AI 编程助手（Claude Code、Codex CLI 等）中提取对话记忆，结构化整理后存储在本地，并能在新对话中一键注入项目上下文——让 AI 从第一句话就了解你和你的项目。

**核心痛点**：你在 Claude Code 里和 AI 讨论了半天架构决策，换到 Codex 又得从头说起；同一个项目开了十几个对话，之前踩过的坑 AI 全忘了。AllMem 解决的就是这种**跨工具、跨会话的记忆碎片化**问题。

## 开发环境搭建

### 1. 安装 Node.js (>= 18)

下载安装：https://nodejs.org/

```bash
node -v    # 确认 >= 18
npm -v     # 确认 >= 9
```

### 2. 安装 Rust (>= 1.75)

下载安装：https://rustup.rs/

安装时选择默认选项即可。安装完成后**重启终端**再验证：

```bash
rustc -V   # 确认 >= 1.75
cargo -V
```

> Windows 用户：Rust 安装器会提示需要 [Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)，按提示安装即可（勾选"使用 C++ 的桌面开发"工作负载）。

### 3. 安装 Tauri CLI

```bash
npm install -g @tauri-apps/cli
```

### 环境要求总览

| 依赖 | 版本 | 说明 |
|------|------|------|
| Node.js | >= 18 | 前端构建 |
| npm | >= 9 | 包管理 |
| Rust | >= 1.75 | Tauri 后端编译 |
| Visual Studio C++ Build Tools | 最新 | Windows 编译 Rust 必需 |
| Windows 10/11 | - | 当前仅测试 Windows |

## 快速启动

```bash
# 1. 进入项目目录
cd allmem

# 2. 安装前端依赖
npm install

# 3. 开发模式启动（首次编译 Rust 约 2-5 分钟）
npx tauri dev
```

启动后会自动弹出桌面窗口。

## 功能说明

### 1. 仪表盘（首页）

- 显示已管理的项目数量、最近同步时间等概览信息
- **立即同步**按钮：从本地 AI 工具对话日志中提取记忆
  - 自动扫描 `~/.claude/projects/` 和 `~/.codex/sessions/` 下的对话记录
  - 用 LLM（阿里云 Qwen 3.5 Plus）提炼结构化记忆
  - 支持增量同步（只处理上次同步后的新对话）

### 2. 项目页

- 查看所有已同步的项目列表
- 点击项目查看详情：
  - **元信息卡片**：项目路径、状态、描述（AI 自动生成）、备注（用户自己写）
  - **记忆内容**：AI 整理的项目记忆（latest.md）
  - **版本历史**：每次同步的历史快照，可回滚
- 支持操作：
  - 新建项目（手动创建）
  - 导入记忆（从本地 .md/.txt 文件或 URL）
  - 删除项目 / 删除历史版本
  - 打开项目本地文件夹

### 3. 对话页

- 基于项目记忆的 AI 问答
- 顶部选择要加载的项目记忆（可多选）
- 如果不选，会根据问题内容自动匹配项目
- 示例问题：
  - "帮我总结一下 aipro 项目的当前状态"
  - "给我生成这个项目的初始上下文"
  - "我之前在哪个项目遇到了路径拼接的问题？"

### 4. 用户页

- **全局使用说明**：用户自己维护的全局偏好/指令（会被注入到 AI 上下文中）
- **用户画像**：AI 从所有对话中自动提炼的用户画像（技术栈、偏好等）

### 5. 设置页

- **LLM 配置**：API Key、Base URL、模型名
  - 默认使用阿里云 DashScope 的 qwen3.5-plus
  - 兼容 OpenAI 格式的任意 API
- **同步参数**：
  - 最大轮次（默认 80）：每个项目提取最近多少轮对话
  - 单轮最大字符（默认 800）：防止大段代码撑爆 token
  - 项目选择：勾选需要同步的项目（不勾选 = 全部同步）
- **Skill 安装**：一键安装 AllMem skill 到 Claude Code / Codex CLI

### 6. Skill 使用（核心功能）

安装 skill 后，在 Claude Code / Codex 中直接说自然语言即可触发：

```
# 在任意项目目录下打开 Claude Code，然后说：
/allmem          # 或者说 "加载记忆"、"项目上下文"

# 撤销注入：
/allmem-undo     # 或者说 "撤销记忆"
```

Skill 会自动：
1. 读取 `~/.allmem/` 下的用户画像和项目记忆
2. 根据当前工作目录匹配对应项目
3. 将记忆写入 `CLAUDE.md`（或 `AGENTS.md`）的标记区块
4. 新开的 Claude Code 会话会自动加载这些上下文

## 数据存储结构

所有数据存在 `~/.allmem/` 下，完全本地，无云端依赖：

```
~/.allmem/
├── config.json                  # 全局配置
├── user/
│   ├── latest.md                # 用户画像（AI 自动生成）
│   ├── instructions.md          # 全局使用说明（用户手动编辑）
│   └── history/                 # 画像历史版本
├── projects/
│   ├── <project-alias>/
│   │   ├── meta.json            # 项目元信息
│   │   ├── latest.md            # 最新记忆（AI 自动整理）
│   │   ├── instructions.md      # 项目使用说明（用户手动编辑）
│   │   └── history/             # 记忆历史版本
│   └── ...
├── raw/                         # 原始对话备份
└── logs/                        # 同步日志
```

## 测试前提

要让同步功能正常工作，你的电脑上需要有 AI 工具的对话记录：

- **Claude Code**：使用过 Claude Code 后会在 `~/.claude/projects/` 下生成 `.jsonl` 对话日志
- **Codex CLI**：使用过 Codex 后会在 `~/.codex/sessions/` 下生成 `rollout-*.jsonl`

如果没有对话记录，可以手动新建项目并导入 .md 文件来体验。

## LLM API 配置

默认配置使用阿里云 DashScope（已内置 API Key），如果额度用完可以替换：

1. 去 [阿里云百炼](https://bailian.console.aliyun.com/) 申请 API Key
2. 在设置页修改 API Key
3. 或者替换为其他 OpenAI 兼容 API（如 OpenRouter、DeepSeek 等）

## 已知限制

- 目前仅支持 Claude Code 和 Codex CLI 两个数据源
- 仅测试了 Windows 环境
- Skill 安装后需要重启 Claude Code 才能识别
- 同步大量对话时 LLM 调用较多，需要等待

## 技术栈

- 前端：React 18 + TypeScript + Tailwind CSS + Zustand
- 后端：Tauri 2（Rust）
- LLM：阿里云 DashScope qwen3.5-plus（OpenAI 兼容接口）
- 存储：本地文件系统（~/.allmem/）
