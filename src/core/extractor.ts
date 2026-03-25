// Extractors: parse conversation logs from different AI tools

import {
  readDir,
  readFile,
  readTextFile,
  stat,
} from "@tauri-apps/plugin-fs";
import { join, homeDir } from "@tauri-apps/api/path";

/** 将真实路径编码为 Cursor projectId 格式（与 Cursor 一致：\ / _ 替换为 -） */
function encodePathToCursorProjectId(absPath: string): string {
  const normalized = absPath.replace(/\\/g, "/").trim();
  const match = normalized.match(/^([a-zA-Z]):\/(.*)$/);
  if (match) {
    const drive = match[1].toLowerCase();
    const rest = match[2].replace(/_/g, "-").replace(/\//g, "-");
    return `${drive}-${rest}`;
  }
  return normalized.replace(/_/g, "-").replace(/\//g, "-");
}

interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  timestamp?: string;
}

interface ExtractedSession {
  sessionId: string;
  projectPath: string;
  projectName: string;
  agent: "claude" | "codex" | "cursor";
  /** Cursor 会话所在目录名（~/.cursor/projects/<id>/），用于未解析路径时的稳定分组 */
  cursorProjectId?: string;
  turns: ConversationTurn[];
  lastModified: number;
}

// ── Claude Code Extractor ──────────────────────────────────────────────

export async function extractClaudeSessions(
  sinceTimestamp?: number
): Promise<ExtractedSession[]> {
  const home = await homeDir();
  const projectsDir = await join(home, ".claude", "projects");

  const sessions: ExtractedSession[] = [];
  let projectDirsCount = 0;
  let jsonlFilesVisited = 0;

  try {
    const projectDirs = await readDir(projectsDir);
    projectDirsCount = projectDirs.length;

    for (const projectDir of projectDirs) {
      if (!projectDir.isDirectory || !projectDir.name) continue;

      const projectDirPath = await join(projectsDir, projectDir.name);
      const files = await readDir(projectDirPath).catch(() => []);

      for (const file of files) {
        if (!file.name?.endsWith(".jsonl")) continue;

        const filePath = await join(projectDirPath, file.name);
        jsonlFilesVisited++;

        // Check modification time
        try {
          const fileStat = await stat(filePath);
          const mtime = fileStat.mtime ? new Date(fileStat.mtime).getTime() : 0;
          if (sinceTimestamp && mtime < sinceTimestamp) continue;

          const content = await readTextFile(filePath);
          const turns = parseClaudeJsonl(content);

          if (turns.length > 0) {
            // Decode project path from directory name
            const decodedPath = decodeClaudeProjectPath(projectDir.name);
            sessions.push({
              sessionId: file.name.replace(".jsonl", ""),
              projectPath: decodedPath,
              projectName: extractProjectName(decodedPath),
                agent: "claude",
              turns,
              lastModified: mtime,
            });
          }
        } catch {
          // Skip files that can't be read
        }
      }
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[extractClaude] readDir failed:", projectsDir, errMsg);
  }

  console.log(
    "[extractClaude] summary:",
    JSON.stringify({
      projectsDir,
      projectDirsCount,
      jsonlFilesVisited,
      sessionsFound: sessions.length,
    }),
  );
  return sessions;
}

function parseClaudeJsonl(content: string): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  const lines = content.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);

      if (obj.type === "user") {
        const text = extractTextContent(obj.message?.content);
        if (text) {
          turns.push({ role: "user", text, timestamp: obj.timestamp });
        }
      } else if (obj.type === "assistant") {
        const text = extractAssistantText(obj.message?.content);
        if (text) {
          turns.push({ role: "assistant", text, timestamp: obj.timestamp });
        }
      }
    } catch {
      // Skip malformed lines
    }
  }

  return turns;
}

function extractTextContent(content: unknown): string | null {
  if (typeof content === "string") return content.trim() || null;
  if (Array.isArray(content)) {
    const texts = content
      .filter(
        (b: { type: string; text?: string }) =>
          b.type === "text" && b.text
      )
      .map((b: { text: string }) => b.text);
    return texts.join("\n").trim() || null;
  }
  return null;
}

function extractAssistantText(content: unknown): string | null {
  if (!Array.isArray(content)) return null;
  // Only text blocks, skip tool_use and thinking
  const texts = content
    .filter(
      (b: { type: string; text?: string }) =>
        b.type === "text" && b.text
    )
    .map((b: { text: string }) => b.text);
  return texts.join("\n").trim() || null;
}

function decodeClaudeProjectPath(dirName: string): string {
  // Claude encodes project paths by replacing path separators
  // e.g., "e--Project3s-aipro" → "e:/Project3s/aipro"
  // Pattern: drive letter followed by -- then path segments separated by -
  const match = dirName.match(/^([a-zA-Z])--(.+)$/);
  if (match) {
    const drive = match[1];
    const pathParts = match[2].split("-");
    return `${drive}:/${pathParts.join("/")}`;
  }
  return dirName;
}

function extractProjectName(projectPath: string): string {
  const parts = projectPath.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] || projectPath;
}

// ── Codex CLI Extractor ────────────────────────────────────────────────

export async function extractCodexSessions(
  sinceTimestamp?: number
): Promise<ExtractedSession[]> {
  const home = await homeDir();
  const sessionsDir = await join(home, ".codex", "sessions");

  const sessions: ExtractedSession[] = [];
  let jsonlFilesVisited = 0;
  let jsonlFilesMatched = 0;

  try {
    // Codex sessions are nested (e.g. ~/.codex/sessions/2026/03/09/rollout-*.jsonl)
    const walk = async (dir: string): Promise<void> => {
      const entries = await readDir(dir).catch(() => []);
      for (const entry of entries) {
        if (!entry.name) continue;
        const nextPath = await join(dir, entry.name);

        if (entry.isDirectory) {
          await walk(nextPath);
          continue;
        }

        if (!entry.name.match(/^rollout-.*\.jsonl$/i)) continue;
        jsonlFilesVisited++;
        jsonlFilesMatched++;

        try {
          const fileStat = await stat(nextPath);
          const mtime = fileStat.mtime ? new Date(fileStat.mtime).getTime() : 0;
          if (sinceTimestamp && mtime < sinceTimestamp) continue;

          const content = await readTextFile(nextPath);
          const parsed = parseCodexJsonl(content);
          if (parsed.turns.length === 0) continue;

          sessions.push({
            sessionId: nextPath
              .replace(/\\/g, "/")
              .replace(/^.*sessions\//, "sessions/")
              .replace(/\.jsonl$/i, ""),
            projectPath: parsed.projectPath,
            projectName: parsed.projectName,
            agent: "codex",
            turns: parsed.turns,
            lastModified: mtime,
          });
        } catch {
          // Skip unreadable/invalid files
        }
      }
    };

    await walk(sessionsDir);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[extractCodex] readDir failed:", sessionsDir, errMsg);
  }

  console.log(
    "[extractCodex] summary:",
    JSON.stringify({
      sessionsDir,
      jsonlFilesVisited,
      jsonlFilesMatched,
      sessionsFound: sessions.length,
    }),
  );
  return sessions;
}

function parseCodexJsonl(content: string): {
  turns: ConversationTurn[];
  projectPath: string;
  projectName: string;
} {
  const turns: ConversationTurn[] = [];

  // Codex rollout jsonl includes session_meta with cwd.
  let projectPath = "";
  let projectName = "";

  const lines = content.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as any;

      if (obj?.type === "session_meta") {
        const cwd = obj?.payload?.cwd;
        if (typeof cwd === "string" && cwd.trim()) {
          projectPath = cwd;
          projectName = extractProjectName(cwd);
        }
        continue;
      }

      if (obj?.type === "response_item" && obj?.payload?.type === "message") {
        const payload = obj.payload as any;
        const role = payload.role;
        if (role !== "user" && role !== "assistant") continue;

        const parts = Array.isArray(payload.content) ? payload.content : [];
        const texts = parts
          .map((p: any) => (p && typeof p.text === "string" ? p.text : ""))
          .filter(Boolean);

        const text = texts.join("\n").trim();
        if (!text) continue;

        turns.push({ role, text, timestamp: obj.timestamp });
      }
    } catch {
      // Skip malformed JSON lines
    }
  }

  if (!projectPath) projectPath = "unknown_codex_project";
  if (!projectName) projectName = projectPath;

  return { turns, projectPath, projectName };
}

// ── Cursor Agent Extractor ─────────────────────────────────────────
//
// Cursor 会把每次 Agent/Chat 的内容记录为 JSONL（逐行一条 message）。
// 每一行一般形如：
// { "role": "user"|"assistant", "message": { "content": [ { "type":"text", "text":"..." } ] } }
export async function extractCursorSessions(
  sinceTimestamp?: number
): Promise<ExtractedSession[]> {
  const home = await homeDir();
  const projectsRoot = await join(home, ".cursor", "projects");

  const sessions: ExtractedSession[] = [];
  let projectDirsCount = 0;
  let jsonlFilesVisited = 0;

  try {
    const projectDirs = await readDir(projectsRoot);
    projectDirsCount = projectDirs.length;
    for (const projectDir of projectDirs) {
      if (!projectDir.name) continue;

      const projectId = projectDir.name;
      const decodedProject = await decodeCursorProjectId(projectId).catch(() => ({
        projectPath: "",
        projectName: inferProjectNameFromCursorProjectId(projectId),
        cursorProjectId: projectId,
      }));
      const transcriptsRoot = await join(projectsRoot, projectId, "agent-transcripts");

      // Cursor transcript structure is not strictly flat:
      // - agent-transcripts/<sessionFolder>/<sessionFile>.jsonl
      // - agent-transcripts/<sessionFolder>/subagents/<subAgentFile>.jsonl
      // - sometimes jsonl might be directly under agent-transcripts
      // So we recurse and parse every *.jsonl.
      const walk = async (dir: string, rel: string): Promise<void> => {
        const entries = await readDir(dir).catch(() => []);
        for (const entry of entries) {
          if (!entry.name) continue;

          const name = entry.name;
          const nextPath = await join(dir, name);
          const nextRel = rel ? `${rel}/${name}` : name;
          const lower = name.toLowerCase();

          if (lower.endsWith(".jsonl")) {
            jsonlFilesVisited++;
            try {
              const fileStat = await stat(nextPath);
              const mtime = fileStat.mtime ? new Date(fileStat.mtime).getTime() : 0;
              if (sinceTimestamp && mtime < sinceTimestamp) continue;

              const content = await readTextFile(nextPath);
              const turns = parseCursorJsonlTurns(content);
              if (turns.length === 0) continue;

              const sessionId = `${projectId}_${nextRel.replace(/\.jsonl$/i, "").replace(/[\\/]/g, "_")}`;
              sessions.push({
                sessionId,
                projectPath: decodedProject.projectPath,
                projectName: decodedProject.projectName,
                agent: "cursor",
                cursorProjectId: projectId,
                turns,
                lastModified: mtime,
              });
            } catch {
              // Skip unreadable/invalid files
            }
            continue;
          }

          // If entry.isDirectory is unreliable in some environments, try readDir to confirm.
          if (entry.isDirectory) {
            await walk(nextPath, nextRel);
            continue;
          }

          const maybeEntries = await readDir(nextPath).catch(() => null);
          if (maybeEntries) {
            await walk(nextPath, nextRel);
          }
        }
      };

      await walk(transcriptsRoot, "");
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[extractCursor] readDir failed:", projectsRoot, errMsg);
  }

  console.log(
    "[extractCursor] summary:",
    JSON.stringify({
      projectsRoot,
      projectDirsCount,
      jsonlFilesVisited,
      sessionsFound: sessions.length,
    }),
  );
  return sessions;
}

function parseCursorJsonlTurns(content: string): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  const lines = content.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as unknown;

      const role = (obj as { role?: unknown }).role;
      if (role !== "user" && role !== "assistant") continue;

      const message = (obj as { message?: unknown }).message as
        | { content?: unknown }
        | undefined;
      const parts = (message?.content as unknown[] | undefined) ?? [];

      const textParts = parts
        .map((p) => {
          const item = p as { type?: unknown; text?: unknown };
          if (item && item.type === "text" && typeof item.text === "string") return item.text;
          // Be tolerant: sometimes content might be { text: "..." } without explicit type
          if (item && typeof item.text === "string") return item.text;
          return "";
        })
        .filter(Boolean);

      const text = textParts.join("\n").trim();
      if (!text) continue;

      turns.push({ role: role as "user" | "assistant", text });
    } catch {
      // Skip malformed lines
    }
  }

  return turns;
}

const cursorProjectDecodeCache = new Map<
  string,
  { projectPath: string; projectName: string; cursorProjectId?: string }
>();

let cursorWorkspacePathMap: Map<string, string> | null = null;
let cursorGlobalStoragePathMap: Map<string, string> | null = null;

/** 从 Cursor workspaceStorage 读取 workspace.json，构建 projectId -> 真实路径 映射 */
async function loadCursorWorkspacePathMap(): Promise<Map<string, string>> {
  if (cursorWorkspacePathMap) return cursorWorkspacePathMap;

  const home = await homeDir();
  // Windows: %APPDATA%\Cursor\User\workspaceStorage
  // macOS: ~/Library/Application Support/Cursor/User/workspaceStorage
  // Linux: ~/.config/Cursor/User/workspaceStorage
  const candidates = [
    await join(home, "AppData", "Roaming", "Cursor", "User", "workspaceStorage"),
    await join(home, "Library", "Application Support", "Cursor", "User", "workspaceStorage"),
    await join(home, ".config", "Cursor", "User", "workspaceStorage"),
  ];

  const map = new Map<string, string>(); // projectId -> path (with \ on Windows)

  for (const wsRoot of candidates) {
    try {
      const dirs = await readDir(wsRoot);
      for (const d of dirs) {
        if (!d.isDirectory || !d.name) continue;
        const wsJsonPath = await join(wsRoot, d.name, "workspace.json");
        try {
          const content = await readTextFile(wsJsonPath);
          const obj = JSON.parse(content) as { folder?: string };
          const folder = obj?.folder;
          if (typeof folder !== "string") continue;

          // file:///d%3A/2026/higher_ai/allmem -> d:\2026\higher_ai\allmem
          const decoded = decodeURIComponent(folder.replace(/^file:\/\/\//i, ""));
          const path = decoded.replace(/^\/([a-zA-Z]):/, "$1:"); // /d: -> d:
          const pathWithBackslash = path.replace(/\//g, "\\");

          const projectId = encodePathToCursorProjectId(pathWithBackslash);
          map.set(projectId, pathWithBackslash);
        } catch {
          // skip
        }
      }
      break; // 找到第一个存在的目录即可
    } catch {
      // 该路径不存在，尝试下一个
    }
  }

  // 补充：从 Cursor 全局状态（storage.json / state.vscdb / WAL）提取历史路径映射
  const globalMap = await loadCursorGlobalStoragePathMap().catch(() => new Map<string, string>());
  for (const [projectId, path] of globalMap.entries()) {
    if (!map.has(projectId)) map.set(projectId, path);
  }

  cursorWorkspacePathMap = map;
  return map;
}

/** 从 Cursor 全局状态文件提取 projectId -> 真实路径 映射（历史兜底） */
async function loadCursorGlobalStoragePathMap(): Promise<Map<string, string>> {
  if (cursorGlobalStoragePathMap) return cursorGlobalStoragePathMap;

  const home = await homeDir();
  const globalStorageDirs = [
    await join(home, "AppData", "Roaming", "Cursor", "User", "globalStorage"),
    await join(home, "Library", "Application Support", "Cursor", "User", "globalStorage"),
    await join(home, ".config", "Cursor", "User", "globalStorage"),
  ];

  const map = new Map<string, string>();

  for (const dir of globalStorageDirs) {
    const candidates = [
      await join(dir, "storage.json"),
      await join(dir, "state.vscdb"),
      await join(dir, "state.vscdb-wal"),
    ];

    for (const filePath of candidates) {
      const rawText = await readCursorGlobalFileAsText(filePath);
      if (!rawText) continue;

      const paths = collectWindowsPathsFromRawText(rawText);
      for (const p of paths) {
        const normalized = p.replace(/\//g, "\\");
        if (!looksLikeWindowsAbsPath(normalized)) continue;
        const projectId = encodePathToCursorProjectId(normalized);
        if (!map.has(projectId)) map.set(projectId, normalized);
      }
    }

    if (map.size > 0) break;
  }

  cursorGlobalStoragePathMap = map;
  return map;
}

async function readCursorGlobalFileAsText(path: string): Promise<string> {
  try {
    // JSON 文件优先按文本读取
    if (path.toLowerCase().endsWith(".json")) {
      return await readTextFile(path);
    }

    // SQLite/二进制文件按字节读取，再宽容解码，尽量提取可见字符串片段
    const bytes = await readFile(path);
    if (!bytes || bytes.length === 0) return "";
    const decoder = new TextDecoder("utf-8", { fatal: false });
    return decoder.decode(bytes);
  } catch {
    return "";
  }
}

function collectWindowsPathsFromRawText(raw: string): string[] {
  const scored = new Map<string, number>();

  // file:///d%3A/dir1/dir2
  const uriMatches = raw.match(/file:\/\/\/[a-zA-Z]%3A\/[^"'<>\r\n)]+/gi) ?? [];
  for (const m of uriMatches) {
    try {
      const decoded = decodeURIComponent(m.replace(/^file:\/\/\//i, ""));
      const path = decoded.replace(/^\/([a-zA-Z]):/, "$1:").replace(/\//g, "\\");
      const candidate = toLikelyProjectRoot(path) ?? path;
      if (looksLikeWindowsAbsPath(candidate)) {
        scored.set(candidate, (scored.get(candidate) ?? 0) + 2);
      }
    } catch {
      // ignore malformed URI
    }
  }

  // D:\dir1\dir2\file.ts
  const absMatches = raw.match(/[a-zA-Z]:\\[^\r\n"'<>|?*]+/g) ?? [];
  for (const m of absMatches) {
    const cleaned = m.replace(/[),.;:]+$/g, "");
    const candidate = toLikelyProjectRoot(cleaned) ?? cleaned;
    if (!looksLikeWindowsAbsPath(candidate)) continue;
    scored.set(candidate, (scored.get(candidate) ?? 0) + 1);
  }

  return Array.from(scored.entries())
    .sort((a, b) => {
      if (b[1] !== a[1]) return b[1] - a[1];
      return b[0].length - a[0].length;
    })
    .map(([p]) => p);
}

async function decodeCursorProjectId(
  projectId: string
): Promise<{ projectPath: string; projectName: string; cursorProjectId?: string }> {
  const cached = cursorProjectDecodeCache.get(projectId);
  if (cached) return cached;

  const map = await loadCursorWorkspacePathMap();
  const realPath = map.get(projectId);

  if (realPath) {
    const result = {
      projectPath: realPath,
      projectName: extractProjectName(realPath),
    };
    cursorProjectDecodeCache.set(projectId, result);
    return result;
  }

  // 无法从 workspaceStorage 找到：用 projectId 反解码 + stat 验证候选真实路径
  const decodedViaStat = await decodeCursorProjectIdViaStat(projectId).catch(() => null);
  if (decodedViaStat) {
    cursorProjectDecodeCache.set(projectId, decodedViaStat);
    return decodedViaStat;
  }

  // 无法通过 workspaceStorage / stat 解析时，尝试从 transcript 文本中的绝对路径反推
  const decodedViaTranscript = await decodeCursorProjectIdViaTranscript(projectId).catch(() => null);
  if (decodedViaTranscript) {
    cursorProjectDecodeCache.set(projectId, decodedViaTranscript);
    return decodedViaTranscript;
  }

  // 无 transcript 路径、无索引命中时无法还原磁盘路径：勿把 projectId 当作路径写入
  const fallback = {
    projectPath: "",
    projectName: inferProjectNameFromCursorProjectId(projectId),
    cursorProjectId: projectId,
  };
  cursorProjectDecodeCache.set(projectId, fallback);
  return fallback;
}

/** 是否为 Windows 绝对路径（用于区分真实路径与 Cursor projectId 兜底串） */
export function looksLikeWindowsAbsPath(p: string): boolean {
  // e.g. "D:\xxx\yyy" or "D:/xxx/yyy"
  return /^[a-zA-Z]:[\\/]/.test(p);
}

/**
 * 尝试把 Cursor 的 projectId 编码（如 d-2026-higher-ai-allmem-master）
 * 解析成真实 windows 路径（如 D:\2026\higher_ai\allmem-master）。
 *
 * 解析失败时返回 null，不要返回 projectId 自己以免继续展示 '-' 编码。
 */
export async function resolveCursorProjectPath(
  pathOrProjectId: string
): Promise<string | null> {
  if (!pathOrProjectId.trim()) return null;

  if (looksLikeWindowsAbsPath(pathOrProjectId)) {
    return pathOrProjectId.replace(/\//g, "\\");
  }

  // Cursor projectId typically starts with drive letter then '-'
  if (!/^[a-zA-Z]-\d+-.+/.test(pathOrProjectId)) return null;

  const decoded = await decodeCursorProjectId(pathOrProjectId).catch(() => null);
  if (!decoded) return null;

  // If decode fell back, avoid returning the encoded id as "path".
  if (!looksLikeWindowsAbsPath(decoded.projectPath)) return null;

  return decoded.projectPath.replace(/\//g, "\\");
}

function inferProjectNameFromCursorProjectId(projectId: string): string {
  // Cursor project id is often derived from your workspace path.
  // Example: d-2026-higher-ai-allmem -> "allmem"
  const parts = projectId.split("-").filter((p) => p.length > 0);
  return parts[parts.length - 1] || projectId;
}

/**
 * 反解码 projectId -> 真实 windows 路径（使用 stat 验证候选）
 * 说明：Cursor 的 projectId 将路径分隔符与 `_` 等字符编码为 `-`，导致不可逆；
 * 这里用“分段 + `_/-` 两种连接方式”枚举候选，并用 stat 找到存在的那一个。
 */
async function decodeCursorProjectIdViaStat(
  projectId: string
): Promise<{ projectPath: string; projectName: string } | null> {
  const parts = projectId.split("-").filter(Boolean);
  if (parts.length < 2) return null;

  const drive = parts[0].toUpperCase();
  const tokens = parts.slice(1);
  const n = tokens.length;
  if (n <= 1) return null;

  // 保护：该方法是指数复杂度，token 过多时直接跳过，避免扫描卡顿。
  if (n > 12) return null;

  // 生成 partition：用 bitmask 表示每个 token 后是否切割为新目录
  const cutBitsCount = n - 1;
  const maxMask = 1 << cutBitsCount;
  const maxStatChecks = 800;
  let statChecks = 0;

  for (let mask = 0; mask < maxMask; mask++) {
    const segmentsTokens: string[][] = [];
    let current: string[] = [tokens[0]];
    for (let i = 0; i < cutBitsCount; i++) {
      const cut = (mask & (1 << i)) !== 0;
      if (cut) {
        segmentsTokens.push(current);
        current = [tokens[i + 1]];
      } else {
        current.push(tokens[i + 1]);
      }
    }
    segmentsTokens.push(current);

    const k = segmentsTokens.length;
    const joinChoiceMax = 1 << k; // bit=1 => '_' join, bit=0 => '-' join

    for (let joinMask = 0; joinMask < joinChoiceMax; joinMask++) {
      if (statChecks >= maxStatChecks) return null;

      const segmentNames = segmentsTokens.map((segTokens, idx) => {
        const useUnderscore = (joinMask & (1 << idx)) !== 0;
        const joiner = useUnderscore ? "_" : "-";
        return segTokens.join(joiner);
      });

      const candidate = `${drive}:\\${segmentNames.join("\\")}`;

      try {
        statChecks++;
        await stat(candidate);
        const projectName = extractProjectName(candidate);
        return { projectPath: candidate, projectName };
      } catch {
        // try next candidate
      }
    }
  }

  return null;
}

/**
 * 通过读取 Cursor transcript 文本中的绝对文件路径，反推出项目根路径。
 * 这能覆盖 projectId 丢失 "_" 信息等不可逆场景（例如 travel_asit -> travel-asit）。
 */
async function decodeCursorProjectIdViaTranscript(
  projectId: string
): Promise<{ projectPath: string; projectName: string } | null> {
  const home = await homeDir();
  const transcriptsRoot = await join(
    home,
    ".cursor",
    "projects",
    projectId,
    "agent-transcripts"
  );

  // 候选根路径 -> 得分
  const scoreMap = new Map<string, number>();
  const queue: string[] = [transcriptsRoot];
  let visitedJsonl = 0;
  const maxJsonlToScan = 8;

  while (queue.length > 0 && visitedJsonl < maxJsonlToScan) {
    const dir = queue.shift()!;
    const entries = await readDir(dir).catch(() => []);
    for (const entry of entries) {
      if (!entry.name) continue;
      const full = await join(dir, entry.name);

      if (entry.isDirectory) {
        queue.push(full);
        continue;
      }

      if (!entry.name.toLowerCase().endsWith(".jsonl")) continue;
      visitedJsonl++;

      const content = await readTextFile(full).catch(() => "");
      if (!content) continue;

      const inferred = inferCursorProjectFromTranscriptText(content);
      if (!inferred) continue;
      scoreMap.set(inferred, (scoreMap.get(inferred) ?? 0) + 1);

      if (visitedJsonl >= maxJsonlToScan) break;
    }
  }

  if (scoreMap.size === 0) return null;

  // 选择得分最高、且更具体（更长）的候选
  const best = Array.from(scoreMap.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0].length - a[0].length;
  })[0]?.[0];
  if (!best) return null;

  const normalized = best.replace(/\//g, "\\");
  return {
    projectPath: normalized,
    projectName: extractProjectName(normalized),
  };
}

function inferCursorProjectFromTranscriptText(content: string): string | null {
  // 提取文本字段后再找路径，避免 JSON 转义干扰
  const text = parseCursorJsonlTurns(content)
    .map((t) => t.text)
    .join("\n");
  if (!text) return null;

  // 匹配 Windows 绝对路径，排除换行和常见分隔符
  const matches = text.match(/[a-zA-Z]:\\[^\r\n"'<>|?*]+/g) ?? [];
  if (matches.length === 0) return null;

  const candidateScores = new Map<string, number>();
  for (const raw of matches) {
    const cleaned = raw
      .replace(/[),.;:]+$/g, "")
      .replace(/\//g, "\\");
    const candidate = toLikelyProjectRoot(cleaned);
    if (!candidate) continue;
    candidateScores.set(candidate, (candidateScores.get(candidate) ?? 0) + 1);
  }

  if (candidateScores.size === 0) return null;
  return Array.from(candidateScores.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return b[0].length - a[0].length;
  })[0]?.[0] ?? null;
}

function toLikelyProjectRoot(absPath: string): string | null {
  if (!looksLikeWindowsAbsPath(absPath)) return null;
  const p = absPath.replace(/\//g, "\\");
  const lower = p.toLowerCase();

  const markers = ["\\src\\", "\\tests\\", "\\test\\", "\\docs\\", "\\app\\", "\\lib\\"];
  for (const marker of markers) {
    const idx = lower.indexOf(marker);
    if (idx > 2) return p.slice(0, idx);
  }

  // 如果像文件路径（末尾包含扩展名），返回其父目录
  const lastSeg = p.split("\\").filter(Boolean).pop() ?? "";
  if (/\.[a-z0-9]{1,8}$/i.test(lastSeg)) {
    const i = p.lastIndexOf("\\");
    if (i > 2) return p.slice(0, i);
  }

  // 否则保守返回该路径本身（可能本来就是根目录）
  return p;
}

// ── Helpers ────────────────────────────────────────────────────────────

/**
 * Format turns into a readable conversation string for LLM processing
 */
export function turnsToText(turns: ConversationTurn[], maxTurns = 80, maxCharsPerTurn = 800): string {
  const limited = turns.slice(-maxTurns); // keep most recent
  return limited
    .map((t) => {
      const text = t.text.length > maxCharsPerTurn
        ? t.text.slice(0, maxCharsPerTurn) + "\n...[truncated]"
        : t.text;
      return `[${t.role}]: ${text}`;
    })
    .join("\n\n");
}

/**
 * Group sessions by project path
 */
function groupingCanonicalPath(session: ExtractedSession): string {
  if (
    session.agent === "cursor" &&
    session.cursorProjectId &&
    !looksLikeWindowsAbsPath(session.projectPath)
  ) {
    return `__cursor:${session.cursorProjectId}`;
  }
  return canonicalizeProjectPath(session.projectPath);
}

export function groupByProject(
  sessions: ExtractedSession[]
): Map<string, ExtractedSession[]> {
  const groupedByNormalizedPath = new Map<
    string,
    { canonicalPath: string; sessions: ExtractedSession[] }
  >();

  for (const session of sessions) {
    const canonicalPath = groupingCanonicalPath(session);
    const normalizedKey = normalizeProjectPathForGrouping(canonicalPath);
    const existing = groupedByNormalizedPath.get(normalizedKey);
    if (!existing) {
      groupedByNormalizedPath.set(normalizedKey, {
        canonicalPath,
        sessions: [session],
      });
      continue;
    }
    existing.sessions.push(session);
  }

  const grouped = new Map<string, ExtractedSession[]>();
  for (const { canonicalPath, sessions: projectSessions } of groupedByNormalizedPath.values()) {
    grouped.set(canonicalPath, projectSessions);
  }
  return grouped;
}

function normalizeProjectPathForGrouping(projectPath: string): string {
  return canonicalizeProjectPath(projectPath).toLowerCase();
}

function canonicalizeProjectPath(projectPath: string): string {
  let value = projectPath.replace(/\//g, "\\").trim();

  if (/^[a-zA-Z]:\\/.test(value)) {
    value = value[0].toUpperCase() + value.slice(1);
  }

  // Keep root path like "D:\", trim trailing separators otherwise.
  if (!/^[a-zA-Z]:\\$/.test(value)) {
    value = value.replace(/\\+$/, "");
  }

  return value;
}
