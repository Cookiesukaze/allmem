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
import type { AllMemConfig, ProjectMeta, MemoryVersion } from "./types";

let ALLMEM_DIR = "";

async function getAllMemDir(): Promise<string> {
  if (!ALLMEM_DIR) {
    const home = await homeDir();
    ALLMEM_DIR = await join(home, ".allmem");
  }
  return ALLMEM_DIR;
}

// ── Init ───────────────────────────────────────────────────────────────

export async function initStorage(): Promise<void> {
  const dir = await getAllMemDir();
  const subDirs = ["raw", "user", "user/history", "projects", "logs"];
  for (const sub of subDirs) {
    const d = await join(dir, ...sub.split("/"));
    if (!(await exists(d))) {
      await mkdir(d, { recursive: true });
    }
  }
}

// ── Config ─────────────────────────────────────────────────────────────

export async function loadConfig(): Promise<AllMemConfig> {
  const dir = await getAllMemDir();
  const configPath = await join(dir, "config.json");
  try {
    const content = await readTextFile(configPath);
    return JSON.parse(content) as AllMemConfig;
  } catch {
    const { DEFAULT_CONFIG } = await import("./types");
    return DEFAULT_CONFIG;
  }
}

export async function saveConfig(config: AllMemConfig): Promise<void> {
  const dir = await getAllMemDir();
  await writeTextFile(await join(dir, "config.json"), JSON.stringify(config, null, 2));
}

// ── User Memory ────────────────────────────────────────────────────────

export async function loadUserMemory(): Promise<string | null> {
  const dir = await getAllMemDir();
  try {
    return await readTextFile(await join(dir, "user", "latest.md"));
  } catch {
    return null;
  }
}

export async function saveUserMemory(
  content: string,
  summary: string
): Promise<void> {
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

// ── User Instructions (global, user-editable) ─────────────────────────

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

// ── Project Instructions (per-project, user-editable) ─────────────────

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

// ── Project Recent (WAL-style incremental log) ─────────────────────────

export async function loadProjectRecent(alias: string): Promise<string | null> {
  const dir = await getAllMemDir();
  try {
    return await readTextFile(await join(dir, "projects", alias, "recent.md"));
  } catch {
    return null;
  }
}

export async function appendProjectRecent(
  alias: string,
  entry: string,
  source: string
): Promise<void> {
  const dir = await getAllMemDir();
  const projectDir = await join(dir, "projects", alias);
  if (!(await exists(projectDir))) {
    await mkdir(projectDir, { recursive: true });
  }
  const recentPath = await join(projectDir, "recent.md");
  const now = new Date().toLocaleString("zh-CN");
  const newEntry = `\n### ${now} (${source})\n${entry}\n`;

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
  // Count ### headers as entries
  return (recent.match(/^### /gm) || []).length;
}

// ── Project Memory ─────────────────────────────────────────────────────

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

export async function saveProjectMeta(
  alias: string,
  meta: ProjectMeta
): Promise<void> {
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

export async function saveProjectMemory(
  alias: string,
  content: string,
  summary: string
): Promise<void> {
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

// ── List Projects ──────────────────────────────────────────────────────

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

// ── Version History ────────────────────────────────────────────────────

export async function listVersions(historyDir: string): Promise<MemoryVersion[]> {
  try {
    const entries = await readDir(historyDir);
    const versions: MemoryVersion[] = [];

    for (const entry of entries) {
      if (!entry.name?.endsWith(".md")) continue;

      const match = entry.name.match(/^v(\d+)_(\d{4}-\d{2}-\d{2}_\d{6})_(.+)\.md$/);
      if (match) {
        versions.push({
          version: parseInt(match[1]),
          date: match[2].replace("_", " "),
          summary: match[3],
          filename: entry.name,
        });
      }
    }

    return versions.sort((a, b) => b.version - a.version);
  } catch {
    return [];
  }
}

export async function loadVersionContent(
  projectAlias: string,
  filename: string
): Promise<string> {
  const dir = await getAllMemDir();
  return readTextFile(await join(dir, "projects", projectAlias, "history", filename));
}

export async function setVersionAsCurrent(
  projectAlias: string,
  filename: string
): Promise<void> {
  const content = await loadVersionContent(projectAlias, filename);
  const dir = await getAllMemDir();
  await writeTextFile(await join(dir, "projects", projectAlias, "latest.md"), content);
}

// ── Delete ─────────────────────────────────────────────────────────────

export async function deleteProject(alias: string): Promise<void> {
  const dir = await getAllMemDir();
  const projectDir = await join(dir, "projects", alias);
  if (await exists(projectDir)) {
    await remove(projectDir, { recursive: true });
  }
}

export async function deleteVersion(
  projectAlias: string,
  filename: string
): Promise<void> {
  const dir = await getAllMemDir();
  const filePath = await join(dir, "projects", projectAlias, "history", filename);
  if (await exists(filePath)) {
    await remove(filePath);
  }
}

// ── Raw Backup ─────────────────────────────────────────────────────────

export async function saveRawBackup(
  agentId: string,
  content: string
): Promise<void> {
  const dir = await getAllMemDir();
  const dateStr = formatDateForFilename(new Date());
  await writeTextFile(await join(dir, "raw", `${dateStr}_${agentId}.jsonl`), content);
}

// ── Sync Log ───────────────────────────────────────────────────────────

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

// ── Helpers ────────────────────────────────────────────────────────────

function formatDateForFilename(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${d}_${h}${min}${s}`;
}
