// Extractors: parse conversation logs from different AI tools

import {
  readDir,
  readTextFile,
  stat,
} from "@tauri-apps/plugin-fs";
import { join, homeDir } from "@tauri-apps/api/path";

interface ConversationTurn {
  role: "user" | "assistant";
  text: string;
  timestamp?: string;
}

interface ExtractedSession {
  sessionId: string;
  projectPath: string;
  projectName: string;
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

  try {
    const projectDirs = await readDir(projectsDir);

    for (const projectDir of projectDirs) {
      if (!projectDir.isDirectory || !projectDir.name) continue;

      const projectDirPath = await join(projectsDir, projectDir.name);
      const files = await readDir(projectDirPath).catch(() => []);

      for (const file of files) {
        if (!file.name?.endsWith(".jsonl")) continue;

        const filePath = await join(projectDirPath, file.name);

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
              turns,
              lastModified: mtime,
            });
          }
        } catch {
          // Skip files that can't be read
        }
      }
    }
  } catch {
    // Projects dir doesn't exist or can't be read
  }

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

  try {
    const sessionDirs = await readDir(sessionsDir);

    for (const sessionDir of sessionDirs) {
      if (!sessionDir.isDirectory || !sessionDir.name) continue;

      const sessionDirPath = await join(sessionsDir, sessionDir.name);
      const files = await readDir(sessionDirPath).catch(() => []);

      for (const file of files) {
        if (!file.name?.match(/^rollout-.*\.jsonl$/)) continue;

        const filePath = await join(sessionDirPath, file.name);

        try {
          const fileStat = await stat(filePath);
          const mtime = fileStat.mtime ? new Date(fileStat.mtime).getTime() : 0;
          if (sinceTimestamp && mtime < sinceTimestamp) continue;

          const content = await readTextFile(filePath);
          const turns = parseCodexJsonl(content);

          if (turns.length > 0) {
            sessions.push({
              sessionId: `${sessionDir.name}_${file.name.replace(".jsonl", "")}`,
              projectPath: sessionDir.name,
              projectName: sessionDir.name,
              turns,
              lastModified: mtime,
            });
          }
        } catch {
          // Skip
        }
      }
    }
  } catch {
    // Sessions dir doesn't exist
  }

  return sessions;
}

function parseCodexJsonl(content: string): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  const lines = content.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      // Codex format varies, handle common patterns
      if (obj.role === "user" && obj.content) {
        const text =
          typeof obj.content === "string"
            ? obj.content
            : extractTextContent(obj.content);
        if (text) turns.push({ role: "user", text, timestamp: obj.timestamp });
      } else if (obj.role === "assistant" && obj.content) {
        const text =
          typeof obj.content === "string"
            ? obj.content
            : extractAssistantText(obj.content);
        if (text) turns.push({ role: "assistant", text, timestamp: obj.timestamp });
      }
    } catch {
      // Skip
    }
  }

  return turns;
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
export function groupByProject(
  sessions: ExtractedSession[]
): Map<string, ExtractedSession[]> {
  const grouped = new Map<string, ExtractedSession[]>();
  for (const session of sessions) {
    const key = session.projectPath;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(session);
  }
  return grouped;
}
