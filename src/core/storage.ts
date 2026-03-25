// Storage manager: read/write ~/.allmem/ structure

import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
  readDir,
  remove,
} from "@tauri-apps/plugin-fs";
import { join, homeDir } from "@tauri-apps/api/path";
import type {
  AllMemConfig,
  ProjectMeta,
  MemoryVersion,
  Experience,
  ProjectObjects,
} from "./types";

let ALLMEM_DIR = "";

async function getAllMemDir(): Promise<string> {
  if (!ALLMEM_DIR) {
    const home = await homeDir();
    ALLMEM_DIR = await join(home, ".allmem");
  }
  return ALLMEM_DIR;
}

export async function initStorage(): Promise<void> {
  const dir = await getAllMemDir();
  const subDirs = ["raw", "user", "user/history", "projects", "logs", "experiences", "experiences/history"];
  for (const sub of subDirs) {
    const d = await join(dir, ...sub.split("/"));
    if (!(await exists(d))) {
      await mkdir(d, { recursive: true });
    }
  }
}

export async function loadConfig(): Promise<AllMemConfig> {
  const dir = await getAllMemDir();
  const configPath = await join(dir, "config.json");
  const { DEFAULT_CONFIG } = await import("./types");
  try {
    const content = await readTextFile(configPath);
    const saved = JSON.parse(content);
    return {
      ...DEFAULT_CONFIG,
      ...saved,
      llm: { ...DEFAULT_CONFIG.llm, ...saved.llm },
      sync: { ...DEFAULT_CONFIG.sync, ...saved.sync },
      syncContent: {
        workspace: { ...DEFAULT_CONFIG.syncContent.workspace, ...saved.syncContent?.workspace },
        memory: { ...DEFAULT_CONFIG.syncContent.memory, ...saved.syncContent?.memory },
        events: saved.syncContent?.events ?? DEFAULT_CONFIG.syncContent.events,
        userProfile: saved.syncContent?.userProfile ?? DEFAULT_CONFIG.syncContent.userProfile,
      },
      injection: {
        workspace: { ...DEFAULT_CONFIG.injection.workspace, ...saved.injection?.workspace },
        memory: { ...DEFAULT_CONFIG.injection.memory, ...saved.injection?.memory },
        events: saved.injection?.events ?? DEFAULT_CONFIG.injection.events,
        manual: saved.injection?.manual ?? DEFAULT_CONFIG.injection.manual,
        userProfile: saved.injection?.userProfile ?? DEFAULT_CONFIG.injection.userProfile,
      },
      privacy: { ...DEFAULT_CONFIG.privacy, ...saved.privacy },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: AllMemConfig): Promise<void> {
  const dir = await getAllMemDir();
  await writeTextFile(await join(dir, "config.json"), JSON.stringify(config, null, 2));
}

export async function loadUserMemory(): Promise<string | null> {
  const dir = await getAllMemDir();
  try {
    return await readTextFile(await join(dir, "user", "latest.md"));
  } catch {
    return null;
  }
}

export async function saveUserMemory(content: string, summary: string): Promise<void> {
  const dir = await getAllMemDir();
  const userDir = await join(dir, "user");
  const historyDir = await join(userDir, "history");

  const existing = await loadUserMemory();
  let version = 1;
  if (existing) {
    const historyFiles = await listVersions(historyDir);
    version = historyFiles.length + 1;
  }

  await writeTextFile(await join(userDir, "latest.md"), content);

  const now = new Date();
  const dateStr = formatDateForFilename(now);
  const safeSummary = summary.replace(/[<>:"/\\|?*]/g, "").slice(0, 20);
  const historyFilename = `v${version}_${dateStr}_${safeSummary}.md`;
  await writeTextFile(await join(historyDir, historyFilename), content);
}

export async function loadUserInstructions(): Promise<string> {
  const dir = await getAllMemDir();
  try {
    return await readTextFile(await join(dir, "user", "instructions.md"));
  } catch {
    return "";
  }
}

export async function saveUserInstructions(content: string): Promise<void> {
  const dir = await getAllMemDir();
  await writeTextFile(await join(dir, "user", "instructions.md"), content);
}

export async function loadProjectInstructions(alias: string): Promise<string> {
  const dir = await getAllMemDir();
  try {
    return await readTextFile(await join(dir, "projects", alias, "instructions.md"));
  } catch {
    return "";
  }
}

export async function saveProjectInstructions(alias: string, content: string): Promise<void> {
  const dir = await getAllMemDir();
  const projectDir = await join(dir, "projects", alias);
  if (!(await exists(projectDir))) {
    await mkdir(projectDir, { recursive: true });
  }
  await writeTextFile(await join(projectDir, "instructions.md"), content);
}

export async function loadProjectRecent(alias: string): Promise<string | null> {
  const dir = await getAllMemDir();
  try {
    return await readTextFile(await join(dir, "projects", alias, "recent.md"));
  } catch {
    return null;
  }
}

export async function appendProjectRecent(alias: string, entry: string, source: string, occurredAt?: number): Promise<void> {
  const dir = await getAllMemDir();
  const projectDir = await join(dir, "projects", alias);
  if (!(await exists(projectDir))) {
    await mkdir(projectDir, { recursive: true });
  }
  const recentPath = await join(projectDir, "recent.md");
  const now = new Date(occurredAt ?? Date.now()).toLocaleString("zh-CN");
  const normalizedEntry = entry
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const stripped = line.replace(/^[-*•·]\s*/, "").replace(/^\d+[.)]\s*/, "");
      return `- ${stripped}`;
    })
    .join("\n");
  const newEntry = `\n### ${now} (${source})\n${normalizedEntry}\n`;

  try {
    const existing = await readTextFile(recentPath);
    await writeTextFile(recentPath, existing + newEntry);
  } catch {
    await writeTextFile(recentPath, `# 近期动态\n${newEntry}`);
  }
}

export async function clearProjectRecent(alias: string): Promise<void> {
  const dir = await getAllMemDir();
  const recentPath = await join(dir, "projects", alias, "recent.md");
  try {
    await writeTextFile(recentPath, "# 近期动态\n");
  } catch {
    // ignore
  }
}

export async function countRecentEntries(alias: string): Promise<number> {
  const recent = await loadProjectRecent(alias);
  if (!recent) return 0;
  return (recent.match(/^- /gm) || []).length;
}

export async function loadProjectMeta(alias: string): Promise<ProjectMeta | null> {
  const dir = await getAllMemDir();
  try {
    const metaPath = await join(dir, "projects", alias, "meta.json");
    const content = await readTextFile(metaPath);
    return JSON.parse(content) as ProjectMeta;
  } catch {
    return null;
  }
}

export async function saveProjectMeta(alias: string, meta: ProjectMeta): Promise<void> {
  const dir = await getAllMemDir();
  const projectDir = await join(dir, "projects", alias);
  const historyDir = await join(projectDir, "history");
  if (!(await exists(projectDir))) {
    await mkdir(projectDir, { recursive: true });
  }
  if (!(await exists(historyDir))) {
    await mkdir(historyDir, { recursive: true });
  }
  await writeTextFile(await join(projectDir, "meta.json"), JSON.stringify(meta, null, 2));
}

export async function loadProjectMemory(alias: string): Promise<string | null> {
  const dir = await getAllMemDir();
  try {
    return await readTextFile(await join(dir, "projects", alias, "latest.md"));
  } catch {
    return null;
  }
}

export async function saveProjectMemory(alias: string, content: string, summary: string): Promise<void> {
  const dir = await getAllMemDir();
  const projectDir = await join(dir, "projects", alias);
  const historyDir = await join(projectDir, "history");

  if (!(await exists(projectDir))) {
    await mkdir(projectDir, { recursive: true });
  }
  if (!(await exists(historyDir))) {
    await mkdir(historyDir, { recursive: true });
  }

  const historyFiles = await listVersions(historyDir);
  const version = historyFiles.length + 1;

  await writeTextFile(await join(projectDir, "latest.md"), content);

  const now = new Date();
  const dateStr = formatDateForFilename(now);
  const safeSummary = summary.replace(/[<>:"/\\|?*]/g, "").slice(0, 20);
  const historyFilename = `v${version}_${dateStr}_${safeSummary}.md`;
  await writeTextFile(await join(historyDir, historyFilename), content);
}

export async function loadProjectObjects(alias: string): Promise<ProjectObjects | null> {
  const dir = await getAllMemDir();
  try {
    const content = await readTextFile(await join(dir, "projects", alias, "objects.json"));
    const parsed = JSON.parse(content) as Record<string, unknown>;
    if ("state" in parsed || "rules" in parsed || "resources" in parsed || "events" in parsed) {
      return normalizeProjectObjectsData(parsed as Partial<ProjectObjects>);
    }
    return migrateLegacyProjectObjects(parsed);
  } catch {
    return null;
  }
}

export async function saveProjectObjects(alias: string, objects: ProjectObjects): Promise<void> {
  const dir = await getAllMemDir();
  const projectDir = await join(dir, "projects", alias);
  if (!(await exists(projectDir))) {
    await mkdir(projectDir, { recursive: true });
  }
  await writeTextFile(await join(projectDir, "objects.json"), JSON.stringify(normalizeProjectObjectsData(objects), null, 2));
}

function createEmptyProjectState(): ProjectObjects["state"] {
  return {
    goal: "",
    currentStatus: "",
    currentFocus: "",
    nextSteps: [],
    risks: [],
  };
}

function normalizeProjectObjectsData(objects: Partial<ProjectObjects> | null | undefined): ProjectObjects {
  const state = objects?.state;
  return {
    state: {
      goal: typeof state?.goal === "string" ? state.goal : "",
      currentStatus: typeof state?.currentStatus === "string" ? state.currentStatus : "",
      currentFocus: typeof state?.currentFocus === "string" ? state.currentFocus : "",
      nextSteps: Array.isArray(state?.nextSteps) ? state.nextSteps.map((item) => String(item).trim()).filter(Boolean) : [],
      risks: Array.isArray(state?.risks) ? state.risks.map((item) => String(item).trim()).filter(Boolean) : [],
    },
    rules: Array.isArray(objects?.rules) ? objects.rules.map((rule, index) => ({
      id: typeof rule.id === "string" && rule.id ? rule.id : `rule-${index + 1}`,
      content: typeof rule.content === "string" ? rule.content.trim() : "",
      rationale: typeof rule.rationale === "string" && rule.rationale.trim() ? rule.rationale.trim() : undefined,
    })).filter((rule) => rule.content.length > 0) : [],
    resources: Array.isArray(objects?.resources) ? objects.resources.map((resource, index) => ({
      id: typeof resource.id === "string" && resource.id ? resource.id : `resource-${index + 1}`,
      label: typeof resource.label === "string" ? resource.label.trim() : "",
      kind: normalizeResourceKind(resource.kind),
      value: typeof resource.value === "string" ? resource.value.trim() : "",
      note: typeof resource.note === "string" && resource.note.trim() ? resource.note.trim() : undefined,
    })).filter((resource) => resource.label.length > 0 && resource.value.length > 0) : [],
    events: Array.isArray(objects?.events) ? objects.events.map((event, index) => ({
      id: typeof event.id === "string" && event.id ? event.id : `event-${index + 1}`,
      title: typeof event.title === "string" ? event.title.trim() : "",
      time: typeof event.time === "string" && event.time.trim() ? event.time.trim() : undefined,
      background: typeof event.background === "string" && event.background.trim() ? event.background.trim() : undefined,
      trigger: typeof event.trigger === "string" ? event.trigger.trim() : "",
      actions: Array.isArray(event.actions) ? event.actions.map((item) => String(item).trim()).filter(Boolean) : [],
      result: typeof event.result === "string" ? event.result.trim() : "",
      status: typeof event.status === "string" && event.status.trim() ? event.status.trim() : undefined,
      nextStep: typeof event.nextStep === "string" && event.nextStep.trim() ? event.nextStep.trim() : undefined,
      lesson: typeof event.lesson === "string" && event.lesson.trim() ? event.lesson.trim() : undefined,
      refs: Array.isArray(event.refs) ? event.refs.map((item) => String(item).trim()).filter(Boolean) : [],
    })).filter((event) => event.title.length > 0 || event.result.length > 0) : [],
    updatedAt: typeof objects?.updatedAt === "string" ? objects.updatedAt : new Date().toISOString(),
  };
}

function migrateLegacyProjectObjects(legacy: Record<string, unknown>): ProjectObjects {
  const openLoops = Array.isArray(legacy.openLoops) ? legacy.openLoops as Array<{ task?: string; nextStep?: string; blocker?: string }> : [];
  const facts = Array.isArray(legacy.facts) ? legacy.facts as Array<{ content?: string; category?: string }> : [];
  const procedures = Array.isArray(legacy.procedures) ? legacy.procedures as Array<{ title?: string; trigger?: string; steps?: string[]; verification?: string }> : [];
  const episodes = Array.isArray(legacy.episodes) ? legacy.episodes as Array<{ title?: string; trigger?: string; attempts?: string[]; outcome?: string; takeaway?: string }> : [];
  const decisions = Array.isArray(legacy.decisions) ? legacy.decisions as Array<{ decision?: string; rationale?: string }> : [];

  return normalizeProjectObjectsData({
    state: {
      ...createEmptyProjectState(),
      nextSteps: openLoops.map((item) => [item.task, item.nextStep].filter(Boolean).join(" -> ")).filter(Boolean),
      risks: openLoops.map((item) => item.blocker ?? "").filter(Boolean),
    },
    rules: facts.filter((fact) => fact.category === "constraint" || fact.category === "preference").map((fact, index) => ({
      id: `rule-${index + 1}`,
      content: fact.content ?? "",
      rationale: fact.category === "preference" ? "用户/项目偏好" : "项目约束",
    })),
    resources: procedures.map((procedure, index) => ({
      id: `resource-${index + 1}`,
      label: procedure.title ?? `流程 ${index + 1}`,
      kind: "doc" as const,
      value: [procedure.trigger ?? "", ...(procedure.steps ?? []), procedure.verification ?? ""].filter(Boolean).join(" | "),
      note: "从旧版流程对象迁移",
    })),
    events: [
      ...episodes.map((episode, index) => ({
        id: `event-${index + 1}`,
        title: episode.title ?? "",
        time: undefined,
        background: undefined,
        trigger: episode.trigger ?? "",
        actions: Array.isArray(episode.attempts) ? episode.attempts : [],
        result: episode.outcome ?? "",
        status: undefined,
        nextStep: undefined,
        lesson: episode.takeaway,
        refs: [],
      })),
      ...decisions.map((decision, index) => ({
        id: `event-decision-${index + 1}`,
        title: decision.decision ?? "",
        time: undefined,
        background: undefined,
        trigger: "形成路线取舍",
        actions: [],
        result: decision.decision ?? "",
        status: undefined,
        nextStep: undefined,
        lesson: decision.rationale,
        refs: [],
      })),
    ],
    updatedAt: typeof legacy.updatedAt === "string" ? legacy.updatedAt : new Date().toISOString(),
  });
}

function normalizeResourceKind(value: unknown): ProjectObjects["resources"][number]["kind"] {
  return value === "path" || value === "command" || value === "url" || value === "doc" || value === "env"
    ? value
    : "doc";
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const dir = await getAllMemDir();
  const projectsDir = await join(dir, "projects");

  if (!(await exists(projectsDir))) return [];

  const entries = await readDir(projectsDir);
  const projects: ProjectMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory || !entry.name) continue;
    const meta = await loadProjectMeta(entry.name);
    if (meta) projects.push(meta);
  }

  return projects;
}

export async function listVersions(historyDir: string): Promise<MemoryVersion[]> {
  try {
    const entries = await readDir(historyDir);
    const versions: MemoryVersion[] = [];

    for (const entry of entries) {
      if (!entry.name?.endsWith(".json")) continue;

      try {
        const content = await readTextFile(await join(historyDir, entry.name));
        const versionData = JSON.parse(content);
        versions.push(versionData);
      } catch {
        continue;
      }
    }

    return versions.sort((a, b) => b.version - a.version);
  } catch {
    return [];
  }
}

export async function loadVersionContent(projectAlias: string, filename: string): Promise<string> {
  const dir = await getAllMemDir();
  return readTextFile(await join(dir, "projects", projectAlias, "history", filename));
}

export async function setVersionAsCurrent(projectAlias: string, filename: string): Promise<void> {
  const dir = await getAllMemDir();
  const historyPath = await join(dir, "projects", projectAlias, "history", filename);

  // 加载历史版本的完整快照
  const versionData: MemoryVersion = JSON.parse(await readTextFile(historyPath));

  // 恢复 objects.json
  const objectsPath = await join(dir, "projects", projectAlias, "objects.json");
  await writeTextFile(objectsPath, JSON.stringify(versionData.snapshot, null, 2));

  // 更新 meta.json 的 currentVersion
  const meta = await loadProjectMeta(projectAlias);
  if (meta) {
    meta.currentVersion = versionData.version;
    await saveProjectMeta(projectAlias, meta);
  }
}

export async function deleteProject(alias: string): Promise<void> {
  const dir = await getAllMemDir();
  const projectDir = await join(dir, "projects", alias);
  await purgeProjectExperienceSources(alias);
  if (await exists(projectDir)) {
    await remove(projectDir, { recursive: true });
  }
}

export async function clearProjectMemory(alias: string): Promise<void> {
  const dir = await getAllMemDir();
  const projectDir = await join(dir, "projects", alias);
  if (!(await exists(projectDir))) return;

  const meta = await loadProjectMeta(alias);
  const targets = [
    await join(projectDir, "latest.md"),
    await join(projectDir, "recent.md"),
    await join(projectDir, "objects.json"),
  ];

  for (const target of targets) {
    if (await exists(target)) {
      await remove(target, { recursive: true });
    }
  }

  await purgeProjectExperienceSources(alias);

  if (meta) {
    await saveProjectMeta(alias, {
      ...meta,
      description: "",
      lastSync: null,
      currentVersion: 0,
    });
  }
}

export async function clearAllMemory(): Promise<void> {
  const dir = await getAllMemDir();

  // 备份用户维护的 instructions.md 文件
  const userInstructionsPath = await join(dir, "user", "instructions.md");
  let userInstructions: string | null = null;
  try {
    if (await exists(userInstructionsPath)) {
      userInstructions = await readTextFile(userInstructionsPath);
    }
  } catch {}

  // 备份各项目的 instructions.md
  const projectInstructions: Record<string, string> = {};
  const projectsDir = await join(dir, "projects");
  try {
    if (await exists(projectsDir)) {
      const { readDir } = await import("@tauri-apps/plugin-fs");
      const entries = await readDir(projectsDir);
      for (const entry of entries) {
        if (entry.isDirectory && entry.name) {
          const instrPath = await join(projectsDir, entry.name, "instructions.md");
          try {
            if (await exists(instrPath)) {
              projectInstructions[entry.name] = await readTextFile(instrPath);
            }
          } catch {}
        }
      }
    }
  } catch {}

  const targets = ["raw", "user", "projects", "logs", "experiences"];
  for (const name of targets) {
    const target = await join(dir, name);
    if (await exists(target)) {
      await remove(target, { recursive: true });
    }
  }

  await initStorage();

  // 恢复用户维护文件
  if (userInstructions) {
    await writeTextFile(userInstructionsPath, userInstructions);
  }
  for (const [alias, content] of Object.entries(projectInstructions)) {
    const projDir = await join(dir, "projects", alias);
    if (!(await exists(projDir))) {
      await mkdir(projDir, { recursive: true });
    }
    await writeTextFile(await join(projDir, "instructions.md"), content);
  }
}

export async function deleteVersion(projectAlias: string, filename: string): Promise<void> {
  const dir = await getAllMemDir();
  const filePath = await join(dir, "projects", projectAlias, "history", filename);
  if (await exists(filePath)) {
    await remove(filePath);
  }
}

export async function saveRawBackup(agentId: string, content: string): Promise<void> {
  const dir = await getAllMemDir();
  const dateStr = formatDateForFilename(new Date());
  await writeTextFile(await join(dir, "raw", `${dateStr}_${agentId}.jsonl`), content);
}

export async function appendSyncLog(entry: Record<string, unknown>): Promise<void> {
  const dir = await getAllMemDir();
  const logPath = await join(dir, "logs", "sync.jsonl");
  const line = JSON.stringify({ ...entry, timestamp: new Date().toISOString() }) + "\n";

  try {
    const existing = await readTextFile(logPath).catch(() => "");
    await writeTextFile(logPath, existing + line);
  } catch {
    await writeTextFile(logPath, line);
  }
}

export async function loadExperiences(): Promise<Experience[]> {
  const dir = await getAllMemDir();
  try {
    const content = await readTextFile(await join(dir, "experiences", "latest.json"));
    return JSON.parse(content) as Experience[];
  } catch {
    return [];
  }
}

export async function saveExperiences(experiences: Experience[], summary: string): Promise<void> {
  const dir = await getAllMemDir();
  const expDir = await join(dir, "experiences");
  const historyDir = await join(expDir, "history");

  if (!(await exists(expDir))) await mkdir(expDir, { recursive: true });
  if (!(await exists(historyDir))) await mkdir(historyDir, { recursive: true });

  const latestPath = await join(expDir, "latest.json");
  try {
    const existing = await readTextFile(latestPath);
    if (existing.trim().length > 2) {
      const dateStr = formatDateForFilename(new Date());
      const safeSummary = summary.replace(/[<>:"/\\|?*]/g, "").slice(0, 20);
      await writeTextFile(await join(historyDir, `${dateStr}_${safeSummary}.json`), existing);
    }
  } catch {
    // No existing file, skip backup
  }

  await writeTextFile(latestPath, JSON.stringify(experiences, null, 2));
}


async function purgeProjectExperienceSources(alias: string): Promise<void> {
  const experiences = await loadExperiences();
  if (experiences.length === 0) return;

  const cleaned = experiences
    .map((experience) => ({
      ...experience,
      sources: experience.sources.filter((source) => source.project !== alias),
    }))
    .filter((experience) => experience.sources.length > 0);

  const changed =
    cleaned.length !== experiences.length ||
    cleaned.some((experience, index) => experience.sources.length !== experiences[index]?.sources.length);

  if (changed) {
    await saveExperiences(cleaned, `清空项目${alias}`);
  }
}
function formatDateForFilename(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}_${h}${min}${s}`;
}











export async function saveProjectVersion(alias: string, summary: string): Promise<void> {
  const dir = await getAllMemDir();
  const projectDir = await join(dir, "projects", alias);
  const historyDir = await join(projectDir, "history");
  
  if (!(await exists(historyDir))) {
    await mkdir(historyDir, { recursive: true });
  }

  const objects = await loadProjectObjects(alias);
  const instructions = await loadProjectInstructions(alias);
  const meta = await loadProjectMeta(alias);
  
  const version = (meta?.currentVersion ?? 0) + 1;
  const dateStr = formatDateForFilename(new Date());
  const safeSummary = summary.replace(/[<>:"/\|?*]/g, "").slice(0, 30);
  const filename = `v${version}_${dateStr}_${safeSummary}.json`;
  
  const snapshot = {
    version,
    date: new Date().toISOString(),
    summary,
    filename,
    snapshot: {
      objects,
      instructions,
    },
  };
  
  await writeTextFile(await join(historyDir, filename), JSON.stringify(snapshot, null, 2));
  
  if (meta) {
    await saveProjectMeta(alias, { ...meta, currentVersion: version });
  }
}

export interface SyncHistoryRecord {
  timestamp: string;
  stage: string;
  detail: string;
  progress: number;
  success: boolean;
}

export async function saveSyncHistory(record: SyncHistoryRecord): Promise<void> {
  const dir = await getAllMemDir();
  const historyPath = await join(dir, "sync-history.json");

  let history: SyncHistoryRecord[] = [];
  if (await exists(historyPath)) {
    try {
      const content = await readTextFile(historyPath);
      history = JSON.parse(content);
    } catch {
      history = [];
    }
  }

  history.push(record);
  // 只保留最近50条
  if (history.length > 50) {
    history = history.slice(-50);
  }

  await writeTextFile(historyPath, JSON.stringify(history, null, 2));
}

export async function loadSyncHistory(): Promise<SyncHistoryRecord[]> {
  const dir = await getAllMemDir();
  const historyPath = await join(dir, "sync-history.json");

  if (!(await exists(historyPath))) {
    return [];
  }

  try {
    const content = await readTextFile(historyPath);
    return JSON.parse(content);
  } catch {
    return [];
  }
}

export async function injectMemoryToFile(
  projectAlias: string,
  targetFile: "CLAUDE.md" | "AGENTS.md",
  projectPath: string
): Promise<void> {
  const config = await loadConfig();
  const [userInstructions, userProfile, projectObjects, projectRecent, projectInstructions] = await Promise.all([
    loadUserInstructions(),
    config.injection.userProfile ? loadUserMemory() : Promise.resolve(null),
    loadProjectObjects(projectAlias),
    loadProjectRecent(projectAlias),
    loadProjectInstructions(projectAlias),
  ]);

  let content = "<!-- allmem-start -->\n## AllMem 记忆上下文\n\n";

  if (config.injection.manual && userInstructions) {
    content += "### 用户全局说明\n" + userInstructions + "\n\n";
  }

  if (config.injection.userProfile && userProfile) {
    content += "### 用户画像\n" + userProfile + "\n\n";
  }

  if (config.injection.manual && projectInstructions) {
    content += "### 项目使用说明\n" + projectInstructions + "\n\n";
  }

  if (projectObjects) {
    const ws = config.injection.workspace;
    if (ws.goal || ws.status || ws.focus || ws.nextSteps || ws.risks) {
      content += "### 工作台\n";
      if (ws.goal && projectObjects.state.goal) content += `- **核心目标**: ${projectObjects.state.goal}\n`;
      if (ws.status && projectObjects.state.currentStatus) content += `- **当前状态**: ${projectObjects.state.currentStatus}\n`;
      if (ws.focus && projectObjects.state.currentFocus) content += `- **当前焦点**: ${projectObjects.state.currentFocus}\n`;
      if (ws.nextSteps && projectObjects.state.nextSteps.length > 0) {
        content += "- **下一步**:\n";
        projectObjects.state.nextSteps.forEach(s => content += `  - ${s}\n`);
      }
      if (ws.risks && projectObjects.state.risks.length > 0) {
        content += "- **风险/阻塞**:\n";
        projectObjects.state.risks.forEach(r => content += `  - ${r}\n`);
      }
      content += "\n";
    }

    if (config.injection.memory.rules && projectObjects.rules.length > 0) {
      content += "### 长期规则\n";
      projectObjects.rules.forEach(r => content += `- ${r.content}（${r.rationale}）\n`);
      content += "\n";
    }

    if (config.injection.memory.resources && projectObjects.resources.length > 0) {
      content += "### 关键资料\n";
      projectObjects.resources.forEach(r => {
        content += `- [${r.kind}] ${r.label}: ${r.value}`;
        if (r.note) content += `（${r.note}）`;
        content += "\n";
      });
      content += "\n";
    }

    if (config.injection.events && projectObjects.events.length > 0) {
      content += "### 事件\n";
      projectObjects.events.forEach(e => {
        content += `#### ${e.title}（${e.time}）\n`;
        if (e.background) content += `- 背景: ${e.background}\n`;
        if (e.trigger) content += `- 起因: ${e.trigger}\n`;
        if (e.actions) content += `- 动作: ${e.actions}\n`;
        if (e.result) content += `- 结果: ${e.result}\n`;
        if (e.lesson) content += `- 结论: ${e.lesson}\n`;
      });
      content += "\n";
    }
  }

  if (projectRecent) {
    content += "### 近期动态\n" + projectRecent + "\n\n";
  }

  content += `*最后更新: ${new Date().toLocaleString()}*\n<!-- allmem-end -->`;

  const filePath = await join(projectPath, targetFile);

  try {
    const existing = await readTextFile(filePath);
    const startMarker = "<!-- allmem-start -->";
    const endMarker = "<!-- allmem-end -->";

    if (existing.includes(startMarker) && existing.includes(endMarker)) {
      const before = existing.substring(0, existing.indexOf(startMarker));
      const after = existing.substring(existing.indexOf(endMarker) + endMarker.length);
      await writeTextFile(filePath, before + content + after);
    } else {
      await writeTextFile(filePath, existing + "\n\n" + content);
    }
  } catch {
    await writeTextFile(filePath, content);
  }
}
