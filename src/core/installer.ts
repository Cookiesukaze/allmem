// Skill installer: register AllMem skill into AI tools

import { exists, mkdir, writeTextFile, remove } from "@tauri-apps/plugin-fs";
import { join, homeDir } from "@tauri-apps/api/path";

const ALLMEM_SKILL_MD = `---
name: allmem
description: >
  跨AI工具统一记忆管理。使用此skill可以加载你在所有AI工具(Claude/Codex/Cursor等)
  中积累的项目记忆和用户画像，让AI从第一句话就了解你和你的项目。
  触发词: "加载记忆", "load memory", "allmem", "项目上下文", "project context",
  "你还记得吗", "之前我们讨论过"
license: MIT
metadata:
  author: AllMem
  version: "0.1.0"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# AllMem - 跨AI工具记忆注入

当用户需要项目上下文或个人记忆时，执行以下步骤：

## 步骤

### 1. 读取用户全局信息

\`\`\`bash
cat ~/.allmem/user/instructions.md
cat ~/.allmem/user/latest.md
\`\`\`

### 2. 识别当前项目

根据当前工作目录，在 \`~/.allmem/projects/\` 下找到对应的项目目录。
可以通过读取各项目的 \`meta.json\` 中的 \`path\` 字段来匹配。

\`\`\`bash
# 列出所有项目
ls ~/.allmem/projects/
# 读取某个项目的元信息
cat ~/.allmem/projects/<project>/meta.json
\`\`\`

### 3. 读取项目记忆和项目使用说明

\`\`\`bash
# 项目长期记忆（AI自动整理的稳定信息）
cat ~/.allmem/projects/<project>/latest.md
# 项目近期动态（最近几次同步的对话摘要）
cat ~/.allmem/projects/<project>/recent.md
# 项目使用说明（用户自己维护的，非常重要）
cat ~/.allmem/projects/<project>/instructions.md
\`\`\`

### 4. 注入上下文

将用户画像、项目记忆、项目使用说明整合，写入当前工具的配置文件：

- Claude Code: 写入 \`CLAUDE.md\` 的 \`<!-- allmem-start -->\` 到 \`<!-- allmem-end -->\` 区块
- Codex CLI: 写入 \`AGENTS.md\` 的 \`<!-- allmem-start -->\` 到 \`<!-- allmem-end -->\` 区块

注入格式示例：
\`\`\`markdown
<!-- allmem-start -->
## AllMem 记忆上下文

### 用户全局说明
{用户instructions.md内容}

### 用户画像
{用户latest.md内容}

### 项目使用说明
{项目instructions.md内容 - 用户自己维护的}

### 项目长期记忆
{项目latest.md内容 - AI自动整理的稳定信息}

### 近期动态
{项目recent.md内容 - 最近几次同步的对话摘要，可能为空}

*最后更新: {时间}*
<!-- allmem-end -->
\`\`\`

**重要**: 保留配置文件中已有的其他内容，只更新AllMem区块。如果区块不存在则追加到文件末尾。

### 5. 报告

告诉用户：
- 加载了哪个项目的记忆
- 记忆的最后更新时间
- 简要概括项目当前状态
`;

const ALLMEM_UNDO_SKILL_MD = `---
name: allmem-undo
description: >
  撤销AllMem的上下文注入，删除CLAUDE.md/AGENTS.md中的AllMem区块。
  触发词: "撤销记忆", "undo allmem", "清除注入的上下文"
license: MIT
metadata:
  author: AllMem
  version: "0.1.0"
allowed-tools:
  - Read
  - Edit
---

# AllMem - 撤销上下文注入

删除当前项目配置文件中的AllMem注入区块。

## 步骤

### 1. 检测配置文件

检查当前目录是否有 \`CLAUDE.md\` 或 \`AGENTS.md\`。

### 2. 删除AllMem区块

找到 \`<!-- allmem-start -->\` 和 \`<!-- allmem-end -->\` 之间的内容（含标记本身），删除。

### 3. 确认

告诉用户已撤销注入。
`;

const ALLMEM_SYNC_SKILL_MD = `---
name: allmem-sync
description: >
  将当前对话或项目的内容同步保存到AllMem记忆中。
  默认保存当前对话摘要；也可以同步当前项目所有对话或全量同步。
  触发词: "保存记忆", "记住这次对话", "同步记忆", "allmem sync",
  "save memory", "sync memory", "同步项目记忆", "全量同步"
license: MIT
metadata:
  author: AllMem
  version: "0.1.0"
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

const ALLMEM_EXP_SKILL_MD = `---
name: allmem-exp
description: >
  加载AllMem经验库中的可复用经验。可以按关键词搜索，也可以自动匹配当前项目。
  触发词: "加载经验", "load experience", "allmem-exp", "经验库", "experience",
  "有没有类似的经验", "之前遇到过类似的问题吗"
license: MIT
metadata:
  author: AllMem
  version: "0.1.0"
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
---

# AllMem - 经验库加载

当用户需要查阅或加载可复用经验时，执行以下步骤：

## 步骤

### 1. 读取经验库

\`\`\`bash
cat ~/.allmem/experiences/latest.json
\`\`\`

### 2. 匹配经验

**有参数时**（用户指定了关键词/标签）：
- 在经验的 title、content、tags 中搜索匹配项
- 按 confidence 降序排列
- 返回前 10 条匹配结果

**无参数时**：
- 读取当前工作目录，匹配 \`~/.allmem/projects/\` 下的项目
- 优先返回 sources 中包含当前项目的经验
- 其次返回 scope=global 的高 confidence 经验
- 返回前 10 条

### 3. 注入到上下文

将匹配的经验写入 CLAUDE.md（或 AGENTS.md）的标记区块：

\`\`\`markdown
<!-- allmem-exp-start -->
## AllMem 经验库

{每条经验格式如下}

### [标题] (confidence: N)
[内容描述]
> 背景: [context]
> 标签: tag1, tag2 | 来源: project1(3次), project2(1次)

---

*已加载 N 条经验 | {时间}*
<!-- allmem-exp-end -->
\`\`\`

**重要**: 保留配置文件中已有的其他内容，只更新 AllMem 经验区块。如果区块不存在则追加到文件末尾。

### 4. 报告

告诉用户：
- 加载了多少条经验
- 列出前 3 条最相关的经验标题
- 如果有搜索词，说明匹配了什么
`;

export async function installSkillToClaude(): Promise<boolean> {
  const home = await homeDir();
  const skillDir = await join(home, ".claude", "skills", "allmem");
  const undoSkillDir = await join(home, ".claude", "skills", "allmem-undo");
  const syncSkillDir = await join(home, ".claude", "skills", "allmem-sync");
  const expSkillDir = await join(home, ".claude", "skills", "allmem-exp");

  try {
    for (const dir of [skillDir, undoSkillDir, syncSkillDir, expSkillDir]) {
      if (!(await exists(dir))) {
        await mkdir(dir, { recursive: true });
      }
    }

    await writeTextFile(await join(skillDir, "SKILL.md"), ALLMEM_SKILL_MD);
    await writeTextFile(await join(undoSkillDir, "SKILL.md"), ALLMEM_UNDO_SKILL_MD);
    await writeTextFile(await join(syncSkillDir, "SKILL.md"), ALLMEM_SYNC_SKILL_MD);
    await writeTextFile(await join(expSkillDir, "SKILL.md"), ALLMEM_EXP_SKILL_MD);

    return true;
  } catch (err) {
    console.error("Failed to install skill to Claude:", err);
    return false;
  }
}

export async function installSkillToCodex(): Promise<boolean> {
  const home = await homeDir();
  // Codex CLI uses ~/.codex/instructions.md as global instructions
  // We install our skill instructions there
  const codexDir = await join(home, ".codex");

  try {
    if (!(await exists(codexDir))) {
      await mkdir(codexDir, { recursive: true });
    }

    const instructionsPath = await join(codexDir, "instructions.md");
    // NOTE: Keep this content stable and identifiable so we can upsert it safely.
    const skillContent = `
# AllMem 记忆管理

## 加载记忆
当用户说"加载记忆"、"allmem"、"项目上下文"时：
1. 读取 ~/.allmem/user/instructions.md（用户全局说明）和 ~/.allmem/user/latest.md（用户画像）
2. 根据当前工作目录匹配 ~/.allmem/projects/ 下的项目（读取各项目 meta.json 的 path 字段）
3. 读取匹配项目的 latest.md（长期记忆）、recent.md（近期动态）和 instructions.md（项目使用说明）
4. 将这些信息写入当前目录的 AGENTS.md 的 <!-- allmem-start --> 到 <!-- allmem-end --> 区块
5. 报告加载了什么

## 保存记忆
当用户说"保存记忆"、"记住这次对话"、"同步记忆"时：
1. 根据当前工作目录匹配 ~/.allmem/projects/ 下的项目
2. 总结当前对话为 3-5 条要点
3. 追加到项目的 recent.md
4. 读取 ~/.allmem/config.json 的 privacy 配置，过滤敏感词
5. 报告保存了什么

## 撤销记忆
当用户说"撤销记忆"、"undo allmem"时，删除 AGENTS.md 中的 <!-- allmem-start/end --> 区块。
`;

    // Upsert into existing instructions if present, or create new.
    // Older versions used '# AllMem 记忆加载' as the header; new version uses '# AllMem 记忆管理'.
    try {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const existing = await readTextFile(instructionsPath);
      const upserted = upsertCodexAllMemBlock(existing, skillContent);
      await writeTextFile(instructionsPath, upserted);
    } catch {
      await writeTextFile(instructionsPath, skillContent);
    }

    return true;
  } catch (err) {
    console.error("Failed to install skill to Codex:", err);
    return false;
  }
}

export async function isSkillInstalled(tool: "claude" | "codex"): Promise<boolean> {
  const home = await homeDir();
  if (tool === "claude") {
    return exists(await join(home, ".claude", "skills", "allmem", "SKILL.md"));
  }
  if (tool === "codex") {
    try {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const content = await readTextFile(await join(home, ".codex", "instructions.md"));
      // Accept both legacy and new headers.
      return (
        content.includes("# AllMem 记忆管理") ||
        content.includes("# AllMem 记忆加载")
      );
    } catch {
      return false;
    }
  }
  return false;
}

export async function uninstallSkillFromClaude(): Promise<boolean> {
  const home = await homeDir();
  const skillDirs = [
    await join(home, ".claude", "skills", "allmem"),
    await join(home, ".claude", "skills", "allmem-undo"),
    await join(home, ".claude", "skills", "allmem-sync"),
    await join(home, ".claude", "skills", "allmem-exp"),
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
  const instructionsPath = await join(home, ".codex", "instructions.md");

  try {
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const content = await readTextFile(instructionsPath);
    // Remove the AllMem section (both legacy and new headers). Use global replace to handle duplicates.
    const cleaned = content
      .replace(/\n?# AllMem 记忆管理[\s\S]*?(?=\n# |\r?\n# |$)/g, "")
      .replace(/\n?# AllMem 记忆加载[\s\S]*?(?=\n# |\r?\n# |$)/g, "")
      .trim();
    if (cleaned) {
      await writeTextFile(instructionsPath, cleaned);
    } else {
      await remove(instructionsPath);
    }
    return true;
  } catch (err) {
    console.error("Failed to uninstall skill from Codex:", err);
    return false;
  }
}

function upsertCodexAllMemBlock(existing: string, block: string): string {
  const normalized = existing ?? "";
  const hasNew = normalized.includes("# AllMem 记忆管理");
  const hasLegacy = normalized.includes("# AllMem 记忆加载");

  // If neither exists, append.
  if (!hasNew && !hasLegacy) {
    const sep = normalized.trim().length ? "\n\n" : "";
    return normalized.replace(/\s*$/, "") + sep + block.trimStart();
  }

  // If either exists, remove all occurrences (dedupe), then append the latest block.
  const removed = normalized
    .replace(/\n?# AllMem 记忆管理[\s\S]*?(?=\n# |\r?\n# |$)/g, "")
    .replace(/\n?# AllMem 记忆加载[\s\S]*?(?=\n# |\r?\n# |$)/g, "")
    .trim();

  const sep = removed.length ? "\n\n" : "";
  return removed + sep + block.trimStart();
}
