// Skill installer: register AllMem skill into AI tools

import { exists, mkdir, writeTextFile, remove } from "@tauri-apps/plugin-fs";
import { join, homeDir } from "@tauri-apps/api/path";

const ALLMEM_SKILL_MD = `---
name: al-pull
description: >
  跨AI工具统一记忆管理。使用此skill可以加载你在所有AI工具(Claude/Codex/Cursor等)
  中积累的项目记忆和用户画像，让AI从第一句话就了解你和你的项目。
  触发词: "加载记忆", "load memory", "al-pull", "项目上下文", "project context",
  "你还记得吗", "之前我们讨论过"
license: MIT
metadata:
  author: AllMem
  version: "0.2.0"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# AllMem - 跨AI工具记忆注入

当用户需要项目上下文或个人记忆时，执行以下步骤。

**核心原则：原样粘贴，不要缩写、不要总结、不要省略任何内容。**

## 步骤

### 1. 读取注入配置

\`\`\`bash
cat ~/.allmem/config.json
\`\`\`

读取 \`injection\` 字段，它控制注入哪些板块：
- \`injection.workspace\`: { goal, status, focus, nextSteps, risks } — 控制工作台的哪些子字段
- \`injection.memory\`: { rules, resources } — 控制长期记忆的哪些子字段
- \`injection.events\`: boolean — 是否注入事件
- \`injection.manual\`: boolean — 是否注入用户维护内容
- \`injection.userProfile\`: boolean — 是否注入用户画像

只注入配置为 true 的板块。

### 2. 读取用户全局信息

\`\`\`bash
cat ~/.allmem/user/instructions.md 2>/dev/null
\`\`\`
如果 \`injection.userProfile\` 为 true：
\`\`\`bash
cat ~/.allmem/user/latest.md 2>/dev/null
\`\`\`

### 3. 识别当前项目

根据当前工作目录，在 \`~/.allmem/projects/\` 下找到对应的项目目录。
读取各项目的 \`meta.json\` 中的 \`path\` 字段来匹配。

\`\`\`bash
ls ~/.allmem/projects/
cat ~/.allmem/projects/<project>/meta.json
\`\`\`

### 4. 读取项目数据

读取以下文件（按需）：

\`\`\`bash
# 结构化记忆（工作台、规则、资料、事件）
cat ~/.allmem/projects/<project>/objects.json 2>/dev/null
# 近期动态
cat ~/.allmem/projects/<project>/recent.md 2>/dev/null
# 用户维护内容
cat ~/.allmem/projects/<project>/instructions.md 2>/dev/null
\`\`\`

### 5. 组装并注入

将读取到的原始内容**原样**组装成以下 markdown，写入 \`CLAUDE.md\`（或 \`AGENTS.md\`）的 \`<!-- allmem-start -->\` 到 \`<!-- allmem-end -->\` 区块。

**不要缩写、总结或改写任何内容，直接粘贴原文。**

组装格式：

\`\`\`markdown
<!-- allmem-start -->
## AllMem 记忆上下文

### 用户全局说明
{直接粘贴 user/instructions.md 原文}

### 用户画像（仅 injection.userProfile=true 时包含）
{直接粘贴 user/latest.md 原文}

### 项目使用说明（仅 injection.manual=true 时包含）
{直接粘贴项目 instructions.md 原文}

### 工作台（根据 injection.workspace 各字段控制）
从 objects.json 的 state 字段提取，格式化为：
- **核心目标**: {state.goal}
- **当前状态**: {state.currentStatus}
- **当前焦点**: {state.currentFocus}
- **下一步**: {逐条列出 state.nextSteps}
- **风险/阻塞**: {逐条列出 state.risks}

### 长期规则（仅 injection.memory.rules=true 时包含）
从 objects.json 的 rules 数组提取，每条格式化为：
- {rule.content}（{rule.rationale}）

### 关键资料（仅 injection.memory.resources=true 时包含）
从 objects.json 的 resources 数组提取，每条格式化为：
- [{resource.kind}] {resource.label}: {resource.value}（{resource.note}）

### 事件（仅 injection.events=true 时包含）
从 objects.json 的 events 数组提取，每个事件格式化为：
#### {event.title}（{event.time}）
- 背景: {event.background}
- 起因: {event.trigger}
- 动作: {event.actions}
- 结果: {event.result}
- 结论: {event.lesson}

### 近期动态
{直接粘贴 recent.md 原文}

*最后更新: {当前时间}*
<!-- allmem-end -->
\`\`\`

**重要**:
- 保留配置文件中已有的其他内容，只更新 AllMem 区块
- 如果区块不存在则追加到文件末尾
- 空的板块（文件不存在或内容为空）直接跳过，不写空标题

### 6. 报告

告诉用户：
- 加载了哪个项目的记忆
- 注入了哪些板块
- 简要概括项目当前状态（一句话）
`;

const ALLMEM_SYNC_SKILL_MD = `---
name: al-push
description: >
  将当前对话或项目的内容同步保存到AllMem记忆中。
  默认保存当前对话摘要；也可以同步当前项目所有对话或全量同步。
  触发词: "保存记忆", "记住这次对话", "同步记忆", "al-push",
  "save memory", "sync memory", "同步项目记忆", "全量同步"
license: MIT
metadata:
  author: AllMem
  version: "0.2.0"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

# AllMem - 同步记忆

根据用户意图，将对话内容保存到 AllMem 记忆系统中。

## 判断同步范围

根据用户的描述判断同步范围：
- **默认/保存当前对话**（"保存记忆"、"记住这次对话"、无额外说明）→ 执行「当前对话同步」
- **同步当前项目**（"同步项目记忆"、"同步项目"）→ 执行「项目同步」
- **全量同步**（"全量同步"、"同步所有"）→ 提示用户去桌面端执行（涉及多项目批量处理）

---

## 当前对话同步（默认，最常用）

### 1. 识别当前项目

根据当前工作目录匹配 \`~/.allmem/projects/\` 下的项目：

\`\`\`bash
ls ~/.allmem/projects/
cat ~/.allmem/projects/<project>/meta.json
\`\`\`

如果没有匹配到项目，创建一个新的 meta.json。

### 2. 总结当前对话

根据当前对话上下文，生成 3-5 条要点摘要：
- 做了什么、解决了什么问题
- 做了什么决策
- 遇到了什么坑
- 下一步计划

### 3. 追加到近期动态

将摘要追加到 \`~/.allmem/projects/<project>/recent.md\`：

\`\`\`markdown
### {当前日期时间} (claude)
- 要点1
- 要点2
- 要点3
\`\`\`

### 4. 检查是否需要压缩

读取 \`~/.allmem/config.json\` 中的 \`sync.compactionThreshold\`（默认 10）。
统计 recent.md 中 \`### \` 开头的条目数量。

如果条目数 >= 阈值：
1. 读取 \`latest.md\`（长期记忆）和 \`recent.md\`（近期动态）
2. 将两者合并整理为新的 \`latest.md\`，格式：
   - 「项目概况」：稳定信息（简介、技术栈、关键决策、经验教训）
   - 「最近动态」：近期进展、进行中的工作、待办
3. 覆盖写入 \`latest.md\`
4. 清空 \`recent.md\`（只保留 \`# 近期动态\` 标题）

### 5. 读取隐私配置并过滤

读取 \`~/.allmem/config.json\` 中的 \`privacy\` 配置。
如果 \`privacy.enabled\` 为 true，在写入前将 \`privacy.sensitiveWords\` 中的词替换为 \`privacy.replacement\`。

### 6. 报告

告诉用户：
- 保存了当前对话到哪个项目
- 当前 recent.md 已累积多少条记录
- 是否触发了压缩

---

## 项目同步

### 1. 扫描当前项目的对话日志

\`\`\`bash
# Claude Code 对话日志
ls ~/.claude/projects/*/
# 找到与当前工作目录匹配的项目文件夹，读取其中的 .jsonl 文件
\`\`\`

### 2. 提取并总结

读取 .jsonl 文件中的对话内容，提取用户和助手的消息，总结为 3-5 条要点。

### 3. 追加到 recent.md

同「当前对话同步」的步骤 3-6。
`;

const ALLMEM_SEARCH_SKILL_MD = `---
name: al-search
description: >
  在AllMem记忆库中查找相关记忆。默认只搜索当前项目，用户可指定搜索全部或特定项目。
  触发词: "查找记忆", "search memory", "al-search", "之前有没有", "记得吗"
license: MIT
metadata:
  author: AllMem
  version: "0.2.0"
allowed-tools:
  - Bash
  - Read
  - Grep
---

# AllMem - 记忆查找

根据用户查询在记忆库中查找相关内容。

## 步骤

### 1. 确定查询内容

- 如果用户提供了具体描述（如 "/al-search FFGO方法"），使用用户描述作为关键词
- 如果用户没有提供描述（只说"查找记忆"），总结最近 3-5 轮对话内容，提取核心关键词

### 2. 确定搜索范围

- **默认**：只搜索当前项目（根据当前工作目录匹配 \`~/.allmem/projects/\` 下的项目）
- 如果用户明确说"所有项目"、"全部搜索"、"跨项目"等，则搜索所有项目
- 如果用户指定了项目名（如"在 aipro 里搜索"），则只搜索指定项目

\`\`\`bash
# 列出所有项目，读取 meta.json 匹配当前目录
ls ~/.allmem/projects/
cat ~/.allmem/projects/<project>/meta.json
\`\`\`

### 3. 搜索项目的结构化记忆

对目标项目，读取 objects.json（结构化记忆）和 instructions.md（用户维护）：

\`\`\`bash
# 读取结构化记忆
cat ~/.allmem/projects/<project>/objects.json 2>/dev/null
# 读取用户维护
cat ~/.allmem/projects/<project>/instructions.md 2>/dev/null
# 读取近期动态
cat ~/.allmem/projects/<project>/recent.md 2>/dev/null
\`\`\`

在以下字段中搜索匹配：
- **state**（工作台）：goal、currentStatus、currentFocus、nextSteps、risks
- **rules**（长期规则）：content、rationale
- **resources**（关键资料）：label、value、note
- **events**（事件）：title、trigger、actions、result、lesson
- **instructions**（用户维护）：全文

### 4. 整理结果

按相关性排序，展示最相关的 3-5 条，格式：

\`\`\`markdown
## 查找结果（项目: <project-name>）

**[类别]** 内容摘要
- 详细内容...
\`\`\`

如果是跨项目搜索，按项目分组展示。

### 5. 报告

告诉用户：
- 在哪个项目中搜索的（或搜索了多少个项目）
- 找到了多少条相关记忆
- 展示最相关的内容，标注所属类别（工作台/规则/资料/事件/用户维护）
`;

export async function installSkillToClaude(): Promise<boolean> {
  const home = await homeDir();
  const skillDir = await join(home, ".claude", "skills", "al-pull");
  const syncSkillDir = await join(home, ".claude", "skills", "al-push");
  const searchSkillDir = await join(home, ".claude", "skills", "al-search");

  try {
    for (const dir of [skillDir, syncSkillDir, searchSkillDir]) {
      if (!(await exists(dir))) {
        await mkdir(dir, { recursive: true });
      }
    }

    await writeTextFile(await join(skillDir, "SKILL.md"), ALLMEM_SKILL_MD);
    await writeTextFile(await join(syncSkillDir, "SKILL.md"), ALLMEM_SYNC_SKILL_MD);
    await writeTextFile(await join(searchSkillDir, "SKILL.md"), ALLMEM_SEARCH_SKILL_MD);

    // 清理旧的 skill 目录
    const legacyDirs = ["allmem", "allmem-undo", "allmem-sync", "allmem-exp", "al-undo"];
    for (const name of legacyDirs) {
      const dir = await join(home, ".claude", "skills", name);
      if (await exists(dir)) {
        await remove(dir, { recursive: true });
      }
    }

    return true;
  } catch (err) {
    console.error("Failed to install skill to Claude:", err);
    return false;
  }
}

export async function installSkillToCodex(): Promise<boolean> {
  const home = await homeDir();
  const skillDir = await join(home, ".codex", "skills", "al-pull");
  const syncSkillDir = await join(home, ".codex", "skills", "al-push");
  const searchSkillDir = await join(home, ".codex", "skills", "al-search");

  try {
    for (const dir of [skillDir, syncSkillDir, searchSkillDir]) {
      if (!(await exists(dir))) {
        await mkdir(dir, { recursive: true });
      }
    }

    const pullSkillMd = `---
name: al-pull
description: >
  Load AllMem memory context for current project.
  IMPORTANT: Before executing, request sandbox permission to read ~/.codex/skills/ and ~/.allmem/ directories.
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
---

# AllMem Memory Loading

When user says "al-pull", "load memory", or "project context":

1. Read ~/.allmem/config.json for injection settings
2. Read ~/.allmem/user/instructions.md and latest.md
3. List ~/.allmem/projects/, read each meta.json to match current directory
4. Read matched project's objects.json, recent.md, instructions.md
5. Write to AGENTS.md between <!-- allmem-start --> and <!-- allmem-end -->

Format:
\`\`\`
<!-- allmem-start -->
## AllMem Memory Context

### User Instructions
{paste user/instructions.md}

### User Profile
{paste user/latest.md}

### Workspace
- **Next Steps**: {list objects.json > state.nextSteps}
- **Risks**: {list objects.json > state.risks}

### Rules
{list rules with rationale}

### Resources
{list resources}

### Events
{list events with details}

### Recent Activity
{paste recent.md}

*Updated: {timestamp}*
<!-- allmem-end -->
\`\`\`

Report: which project loaded, what sections injected.
`;

    const pushSkillMd = `---
name: al-push
description: Save current conversation to AllMem memory
allowed-tools:
  - Read
  - Edit
  - Bash
---

# AllMem Memory Saving

When user says "al-push", "save memory", or "remember this":

1. Match current directory to ~/.allmem/projects/<project>/
2. Summarize current conversation as 3-5 bullet points
3. Append to project's recent.md: \`### {datetime} (codex)\\n- point1\\n- point2\`
4. Read ~/.allmem/config.json privacy settings and filter sensitive words
5. Report: saved to which project, how many entries accumulated
`;

    const searchSkillMd = `---
name: al-search
description: Search AllMem memory for relevant information
allowed-tools:
  - Read
  - Bash
---

# AllMem Memory Search

When user says "al-search", "find memory", or "do you remember":

1. Default: search current project's objects.json + instructions.md + recent.md only
2. If user says "all projects" or specifies project name, search across projects
3. Show top 3-5 most relevant results with category labels
`;

    await writeTextFile(await join(skillDir, "SKILL.md"), pullSkillMd);
    await writeTextFile(await join(syncSkillDir, "SKILL.md"), pushSkillMd);
    await writeTextFile(await join(searchSkillDir, "SKILL.md"), searchSkillMd);

    return true;
  } catch (err) {
    console.error("Failed to install skill to Codex:", err);
    return false;
  }
}

export async function isSkillInstalled(tool: "claude" | "codex"): Promise<boolean> {
  const home = await homeDir();
  if (tool === "claude") {
    return exists(await join(home, ".claude", "skills", "al-pull", "SKILL.md"));
  }
  if (tool === "codex") {
    return exists(await join(home, ".codex", "skills", "al-pull", "SKILL.md"));
  }
  return false;
}

export async function uninstallSkillFromClaude(): Promise<boolean> {
  const home = await homeDir();
  const skillDirs = [
    await join(home, ".claude", "skills", "al-pull"),
    await join(home, ".claude", "skills", "al-push"),
    await join(home, ".claude", "skills", "al-search"),
    // 旧名称也清理
    await join(home, ".claude", "skills", "allmem"),
    await join(home, ".claude", "skills", "allmem-undo"),
    await join(home, ".claude", "skills", "allmem-sync"),
    await join(home, ".claude", "skills", "allmem-exp"),
    await join(home, ".claude", "skills", "al-undo"),
  ];

  try {
    for (const dir of skillDirs) {
      if (await exists(dir)) {
        await remove(dir, { recursive: true });
      }
    }
    return true;
  } catch (err) {
    console.error("Failed to uninstall skill from Claude:", err);
    return false;
  }
}

export async function uninstallSkillFromCodex(): Promise<boolean> {
  const home = await homeDir();
  const skillDirs = [
    await join(home, ".codex", "skills", "al-pull"),
    await join(home, ".codex", "skills", "al-push"),
    await join(home, ".codex", "skills", "al-search"),
  ];

  try {
    for (const dir of skillDirs) {
      if (await exists(dir)) {
        await remove(dir, { recursive: true });
      }
    }
    return true;
  } catch (err) {
    console.error("Failed to uninstall skill from Codex:", err);
    return false;
  }
}
