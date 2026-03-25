import type { Experience, ProjectMeta } from "./types";
import {
  appendProjectRecent,
  clearProjectRecent,
  deleteProject,
  loadExperiences,
  saveExperiences,
  saveProjectInstructions,
  saveProjectMemory,
  saveProjectMeta,
} from "./storage";

const DEMO_ALIAS = "allmem_demo";
const DEMO_PREFIX = "demo_";

const DEMO_META: ProjectMeta = {
  alias: DEMO_ALIAS,
  path: "E:/Demo/allmem-demo",
  description: "用于演示 AllMem 的跨会话编程记忆、经验蒸馏与技能候选流转。",
  notes: "这是一套示例数据，不依赖真实私人日志。",
  created: new Date("2026-03-22T09:00:00.000Z").toISOString(),
  lastSync: new Date().toISOString(),
  currentVersion: 1,
  status: "active",
};

const DEMO_MEMORY = `# AllMem Demo 项目记忆

## 当前状态
- 当前优先级：先做可以发帖传播的 P0/P1 版本。
- 核心场景：跨 Claude Code / Codex CLI 的编程经验复用。
- 展示重点：因果链记忆、经验蒸馏、技能候选、可视化时间线。

## 关键事实
- 技术栈：Tauri 2 + React 18 + TypeScript + Tailwind + Zustand。
- 存储位置：\/.allmem/，默认纯本地。
- 当前已支持的工具：Claude Code、Codex CLI。

## 关键决策
- 先不大改核心同步管线，优先把现有能力做成可传播的展示版本。
- 先支持“经验 -> 技能候选”的手工提升，而不是直接强做自动 skill 生成。
- 为了方便别人体验，提供一键加载演示数据，而不是要求先准备私人日志。

## 当前风险
- 没有真实日志时，很多页面会显得偏空。
- 经验卡已有，但技能卡表达还不够直观。
- GH 传播前还需要更适合截图的展示层。

## 下一步
- 用项目页展示 timeline + 长期记忆 + 相关经验。
- 用经验页展示经验卡和技能候选卡的区别。
- 用概览页说明三智能体管线和演示入口。`;

const DEMO_INSTRUCTIONS = `- 如果是展示模式，优先解释对象流转：原始对话 -> 因果链 -> 长期记忆 -> 经验卡 -> 技能候选。
- 回答时尽量引用具体项目事实和最近动态。
- 如果用户问“为什么要做这个”，优先从跨工具记忆碎片化的痛点回答。`;

const DEMO_RECENT_ENTRIES = [
  {
    source: "claude",
    entry: "发现论坛传播阶段最缺的是可直接体验的内容。\n决定不等待真实日志，而是先补演示数据和截图友好的界面。",
  },
  {
    source: "codex",
    entry: "复盘项目对象模型后，决定暂时保留现有 experience 管线。\n不重写同步，只补传播层和 skill candidate 展示。",
  },
  {
    source: "claude",
    entry: "确认一键加载 demo workspace 可以显著降低体验门槛。\n这样别人 clone 仓库后，即使没有私人 AI 日志也能立刻看到完整界面。",
  },
];

const now = new Date().toISOString();

const DEMO_EXPERIENCES: Experience[] = [
  {
    id: `${DEMO_PREFIX}exp_windows_reading`,
    title: "Windows 上优先排查编码和沙箱，而不是先怀疑文件损坏",
    content: "读取本地中文文本失败时，先检查编码和沙箱权限。很多时候不是文件坏了，而是默认编码错了，或者沙箱初始化失败。",
    context: "适用于本地桌面工具、脚本代理、Windows 文件读写。",
    kind: "experience",
    tags: ["windows", "编码", "排错"],
    scope: "global",
    sources: [{ project: DEMO_ALIAS, count: 2, lastSeen: now }],
    confidence: 0.84,
    whyItWorks: "先排查编码和权限，能避免无效重试，把问题快速缩到 I/O 边界。",
    created: now,
    updated: now,
  },
  {
    id: `${DEMO_PREFIX}skill_demo_seed`,
    title: "为没有私人日志的用户加载一套可截图的演示工作区",
    content: "当仓库第一次被体验时，先提供完整的项目记忆、近期动态和技能卡，降低上手门槛。",
    context: "适用于 GH 项目早期传播、课程答辩、截图录屏准备。",
    kind: "skill",
    tags: ["demo", "onboarding", "传播"],
    scope: "global",
    sources: [{ project: DEMO_ALIAS, count: 3, lastSeen: now }],
    confidence: 0.93,
    trigger: "仓库初次体验、没有本地日志、需要立刻展示系统特色时。",
    steps: [
      "创建一个示例项目元信息和长期记忆。",
      "补三条近期动态，形成 timeline 视觉反馈。",
      "写入两类资产：经验卡和技能候选卡。",
      "在概览页暴露一键加载入口，避免用户先配置日志。"
    ],
    verification: "加载后能在概览页看到项目数、经验数、技能候选；项目页能看到长期记忆与近期动态。",
    whyItWorks: "早期传播最大的阻力是体验门槛，而不是算法本身。演示工作区可以把'空系统'变成'可理解产品'。",
    created: now,
    updated: now,
  },
  {
    id: `${DEMO_PREFIX}skill_promote_experience`,
    title: "把高置信经验提升为技能候选，而不是永远停留在说明文",
    content: "当一条经验已经明确触发条件和动作模式时，应把它升级成 skill candidate，以降低复用成本。",
    context: "适用于频繁复现的问题修复、环境准备、数据清洗、发布流程。",
    kind: "skill",
    tags: ["skill", "复用", "workflow"],
    scope: "project",
    sources: [{ project: DEMO_ALIAS, count: 2, lastSeen: now }],
    confidence: 0.88,
    trigger: "经验内容已经足够稳定，并且会反复在新项目或新会话里用到。",
    steps: [
      "确认经验有明确触发条件。",
      "补出步骤、边界和验证方式。",
      "将其标记为技能候选，以便单独检索和展示。"
    ],
    verification: "用户能直接看到触发条件、操作步骤和验证信号，而不是只看到一段总结。",
    whyItWorks: "skill card 比自由文本更适合检索、展示和复用，也更容易进一步转成可执行脚本。",
    created: now,
    updated: now,
  },
];

export async function installDemoWorkspace(): Promise<void> {
  await saveProjectMeta(DEMO_ALIAS, {
    ...DEMO_META,
    lastSync: new Date().toISOString(),
  });
  await saveProjectMemory(DEMO_ALIAS, DEMO_MEMORY, "载入演示项目");
  await saveProjectInstructions(DEMO_ALIAS, DEMO_INSTRUCTIONS);
  await clearProjectRecent(DEMO_ALIAS);

  for (const item of DEMO_RECENT_ENTRIES) {
    await appendProjectRecent(DEMO_ALIAS, item.entry, item.source);
  }

  const existing = await loadExperiences();
  const kept = existing.filter((exp) => !exp.id.startsWith(DEMO_PREFIX));
  await saveExperiences([...kept, ...DEMO_EXPERIENCES], "载入演示经验与技能");
}

export async function removeDemoWorkspace(): Promise<void> {
  await deleteProject(DEMO_ALIAS);
  const existing = await loadExperiences();
  await saveExperiences(existing.filter((exp) => !exp.id.startsWith(DEMO_PREFIX)), "移除演示经验与技能");
}

export function isDemoProject(alias: string): boolean {
  return alias === DEMO_ALIAS;
}
