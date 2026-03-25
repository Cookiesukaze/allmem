// Storage manager: read/write ~/.allmem/ structure

import {
  exists,
  mkdir,
  readTextFile,
  writeTextFile,
  readDir,
  remove,
  rename,
  copyFile,
} from "@tauri-apps/plugin-fs";
import { join, homeDir } from "@tauri-apps/api/path";
import type { AllMemConfig, ProjectMeta, MemoryVersion, Experience } from "./types";

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
  const subDirs = [
    "raw",
    "user",
    "user/history",
    "projects",
    "logs",
    "experiences",
    "experiences/history",
    "scan",
  ];
  for (const sub of subDirs) {
    const d = await join(dir, ...sub.split("/"));
    if (!(await exists(d))) {
      await mkdir(d, { recursive: true });
    }
  }
}

// ── Scan Index (Project Cards) ─────────────────────────────────────────────

export async function loadScannedIndex(): Promise<import("./types").ScannedIndex | null> {
  const dir = await getAllMemDir();
  const filePath = await join(dir, "scan", "scan-index.json");
  try {
    const content = await readTextFile(filePath);
    return JSON.parse(content) as import("./types").ScannedIndex;
  } catch {
    return null;
  }
}

export async function saveScannedIndex(index: import("./types").ScannedIndex): Promise<void> {
  const dir = await getAllMemDir();
  const filePath = await join(dir, "scan", "scan-index.json");
  await writeTextFile(filePath, JSON.stringify(index, null, 2));
}

// ── Config ─────────────────────────────────────────────────────────────

export async function loadConfig(): Promise<AllMemConfig> {
  const dir = await getAllMemDir();
  const configPath = await join(dir, "config.json");

  const { DEFAULT_CONFIG } = await import("./types");
  try {
    const content = await readTextFile(configPath);
    const parsed = JSON.parse(content) as Partial<AllMemConfig>;

    // Merge defaults for forward compatibility (new fields / new agents).
    const merged: AllMemConfig = {
      ...DEFAULT_CONFIG,
      ...parsed,
      llm: { ...DEFAULT_CONFIG.llm, ...(parsed as Partial<AllMemConfig>).llm },
      sync: { ...DEFAULT_CONFIG.sync, ...(parsed as Partial<AllMemConfig>).sync },
      privacy: { ...DEFAULT_CONFIG.privacy, ...(parsed as Partial<AllMemConfig>).privacy },
      agents:
        Array.isArray(parsed.agents) && parsed.agents.length > 0
          ? [...parsed.agents]
          : [...DEFAULT_CONFIG.agents],
    };

    // Ensure cursor sync support is enabled by default.
    if (!merged.agents.includes("cursor")) merged.agents.push("cursor");

    return merged;
  } catch {
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
  if (
    existing &&
    normalizeForStableCompare(existing) === normalizeForStableCompare(content)
  ) {
    // Skip creating another history snapshot when profile content is unchanged.
    return;
  }
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
  // Ensure each line is a bullet point (- prefix)
  const normalizedEntry = entry
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      // Strip existing bullet markers and normalize to "- "
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
  // Count bullet points (- lines) as individual entries
  return (recent.match(/^- /gm) || []).length;
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

// —— Alias Migration / Deduplication ——————————————————————————————————————————————

function normalizeProjectPath(p: string): string {
  return p.replace(/\//g, "\\").toLowerCase().trim();
}

async function ensureDir(path: string): Promise<void> {
  if (!(await exists(path))) {
    await mkdir(path, { recursive: true });
  }
}

async function copyIfMissing(fromPath: string, toPath: string): Promise<void> {
  if (!(await exists(fromPath))) return;
  if (await exists(toPath)) return;
  await copyFile(fromPath, toPath);
}

async function appendRecentIfPresent(fromPath: string, toPath: string): Promise<void> {
  if (!(await exists(fromPath))) return;
  const from = await readTextFile(fromPath).catch(() => "");
  if (!from.trim()) return;

  const to = await readTextFile(toPath).catch(() => "");
  if (!to.trim()) {
    await writeTextFile(toPath, from);
    return;
  }

  await writeTextFile(toPath, `${to.trimEnd()}\n\n${from.trimStart()}`);
}

async function copyHistoryFiles(oldHistoryDir: string, newHistoryDir: string, oldAlias: string): Promise<void> {
  if (!(await exists(oldHistoryDir))) return;
  await ensureDir(newHistoryDir);

  const entries = await readDir(oldHistoryDir).catch(() => []);
  for (const e of entries) {
    if (!e.name || e.isDirectory) continue;
    const src = await join(oldHistoryDir, e.name);
    let dst = await join(newHistoryDir, e.name);
    if (await exists(dst)) {
      dst = await join(newHistoryDir, `${oldAlias}__${e.name}`);
    }
    await copyFile(src, dst).catch(() => {});
  }
}

/**
 * Deduplicate project aliases that point to the same real path.
 * Returns removed legacy aliases (e.g. ["asit"] migrated to "travel_asit").
 */
export async function dedupeProjectAliasesByPath(
  preferredAlias: string,
  projectPath: string
): Promise<string[]> {
  const normalizedTargetPath = normalizeProjectPath(projectPath);
  if (!preferredAlias || !normalizedTargetPath) return [];

  const all = await listProjects();
  const duplicates = all.filter(
    (p) =>
      p.alias !== preferredAlias &&
      p.path &&
      normalizeProjectPath(p.path) === normalizedTargetPath
  );
  if (duplicates.length === 0) return [];

  const dir = await getAllMemDir();
  const preferredDir = await join(dir, "projects", preferredAlias);
  const removed: string[] = [];

  for (const dup of duplicates) {
    const oldAlias = dup.alias;
    const oldDir = await join(dir, "projects", oldAlias);
    if (!(await exists(oldDir))) continue;

    const preferredExists = await exists(preferredDir);

    if (!preferredExists) {
      // Fast path: target doesn't exist, direct rename keeps all files/history.
      await rename(oldDir, preferredDir).catch(async () => {
        await ensureDir(preferredDir);
      });
    } else {
      // Merge path: keep preferred alias directory, merge useful artifacts from legacy alias.
      await ensureDir(preferredDir);
      await copyIfMissing(await join(oldDir, "latest.md"), await join(preferredDir, "latest.md"));
      await copyIfMissing(
        await join(oldDir, "instructions.md"),
        await join(preferredDir, "instructions.md")
      );
      await appendRecentIfPresent(await join(oldDir, "recent.md"), await join(preferredDir, "recent.md"));
      await copyHistoryFiles(
        await join(oldDir, "history"),
        await join(preferredDir, "history"),
        oldAlias
      );
    }

    // Merge metadata conservatively.
    const oldMeta = await loadProjectMeta(oldAlias);
    const newMeta = await loadProjectMeta(preferredAlias);
    const merged: ProjectMeta = {
      alias: preferredAlias,
      path: projectPath,
      description: newMeta?.description || oldMeta?.description || "",
      notes: newMeta?.notes || oldMeta?.notes || "",
      created: newMeta?.created || oldMeta?.created || new Date().toISOString(),
      lastSync: newMeta?.lastSync || oldMeta?.lastSync || new Date().toISOString(),
      currentVersion: Math.max(newMeta?.currentVersion ?? 0, oldMeta?.currentVersion ?? 0),
      status: "active",
    };
    await saveProjectMeta(preferredAlias, merged);

    // Remove legacy alias directory after successful merge.
    if (await exists(oldDir)) {
      await remove(oldDir, { recursive: true }).catch(() => {});
    }
    removed.push(oldAlias);
  }

  return removed;
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

// ── Experiences ───────────────────────────────────────────────────────

export async function loadExperiences(): Promise<Experience[]> {
  const dir = await getAllMemDir();
  try {
    const content = await readTextFile(await join(dir, "experiences", "latest.json"));
    return JSON.parse(content) as Experience[];
  } catch {
    return [];
  }
}

export async function saveExperiences(
  experiences: Experience[],
  summary: string
): Promise<void> {
  const dir = await getAllMemDir();
  const expDir = await join(dir, "experiences");
  const historyDir = await join(expDir, "history");

  if (!(await exists(expDir))) await mkdir(expDir, { recursive: true });
  if (!(await exists(historyDir))) await mkdir(historyDir, { recursive: true });

  // Backup current version before overwriting
  const latestPath = await join(expDir, "latest.json");
  try {
    const existing = await readTextFile(latestPath);
    if (existing.trim().length > 2) { // not empty array "[]"
      const dateStr = formatDateForFilename(new Date());
      const safeSummary = summary.replace(/[<>:"/\\|?*]/g, "").slice(0, 20);
      await writeTextFile(await join(historyDir, `${dateStr}_${safeSummary}.json`), existing);
    }
  } catch {
    // No existing file, skip backup
  }

  await writeTextFile(latestPath, JSON.stringify(experiences, null, 2));
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

function normalizeForStableCompare(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
