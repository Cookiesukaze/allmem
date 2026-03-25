import type { IdeId, ScannedIndex, ScannedProjectCard } from "./types";
import {
  extractClaudeSessions,
  extractCodexSessions,
  extractCursorSessions,
  looksLikeWindowsAbsPath,
} from "./extractor";

function normalizeAlias(projectName: string): string {
  return projectName.toLowerCase().replace(/[^a-z0-9]/g, "_");
}

function normalizeProjectPath(path: string): string {
  const normalized = path.replace(/\//g, "\\").trim();
  if (!normalized) return "";

  let withDrive = normalized;
  if (/^[a-zA-Z]:\\/.test(withDrive)) {
    withDrive = withDrive[0].toUpperCase() + withDrive.slice(1);
  }
  if (!/^[a-zA-Z]:\\$/.test(withDrive)) {
    withDrive = withDrive.replace(/\\+$/, "");
  }
  return withDrive.toLowerCase();
}

/** 扫描卡片展示用：盘符大写、分隔符统一，不把整段路径强行小写。 */
function normalizeProjectPathForDisplay(path: string): string {
  let value = path.replace(/\//g, "\\").trim();
  if (!value) return "";

  if (/^[a-zA-Z]:\\/.test(value)) {
    value = value[0].toUpperCase() + value.slice(1);
  }
  if (!/^[a-zA-Z]:\\$/.test(value)) {
    value = value.replace(/\\+$/, "");
  }
  return value;
}

function makeCardKey(alias: string, projectPath: string): string {
  const normalizedPath = normalizeProjectPath(projectPath);
  if (normalizedPath) return `path:${normalizedPath}`;
  return `alias:${alias}`;
}

function mergeCard(dst: Map<string, ScannedProjectCard>, card: ScannedProjectCard) {
  const existing = dst.get(card.key);
  if (!existing) {
    dst.set(card.key, card);
    return;
  }
  const mergedIdes = new Set([...existing.ides, ...card.ides]);
  existing.ides = Array.from(mergedIdes);
}

export async function discoverProjects(enabled: IdeId[]): Promise<ScannedIndex> {
  const generatedAt = new Date().toISOString();
  const cardsByKey = new Map<string, ScannedProjectCard>();

  const ideTasks: Array<Promise<void>> = [];

  if (enabled.includes("claude")) {
    ideTasks.push(
      extractClaudeSessions()
        .then((sessions) => {
          for (const s of sessions) {
            const alias = normalizeAlias(s.projectName);
            const key = makeCardKey(alias, s.projectPath);
            mergeCard(
              cardsByKey,
              {
                key,
                alias,
                displayName: s.projectName,
                projectPath: normalizeProjectPathForDisplay(s.projectPath),
                ides: ["claude"],
                updatedAt: generatedAt,
              } satisfies ScannedProjectCard
            );
          }
        })
        .catch(() => {
          // Discovery should be best-effort per IDE; missing Claude should not break others.
        })
    );
  }

  if (enabled.includes("codex")) {
    ideTasks.push(
      extractCodexSessions()
        .then((sessions) => {
          for (const s of sessions) {
            const alias = normalizeAlias(s.projectName);
            const key = makeCardKey(alias, s.projectPath);
            mergeCard(
              cardsByKey,
              {
                key,
                alias,
                displayName: s.projectName,
                projectPath: normalizeProjectPathForDisplay(s.projectPath),
                ides: ["codex"],
                updatedAt: generatedAt,
              } satisfies ScannedProjectCard
            );
          }
        })
        .catch(() => {
          // best-effort
        })
    );
  }

  if (enabled.includes("cursor")) {
    ideTasks.push(
      extractCursorSessions()
        .then((sessions) => {
          for (const s of sessions) {
            const alias = normalizeAlias(s.projectName);
            const resolved = looksLikeWindowsAbsPath(s.projectPath);
            const key = resolved
              ? makeCardKey(alias, s.projectPath)
              : `cursor:${s.cursorProjectId ?? alias}`;
            mergeCard(
              cardsByKey,
              {
                key,
                alias,
                displayName: s.projectName,
                projectPath: resolved ? normalizeProjectPathForDisplay(s.projectPath) : "",
                pathUnresolved: !resolved,
                cursorProjectId: resolved ? undefined : s.cursorProjectId,
                ides: ["cursor"],
                updatedAt: generatedAt,
              } satisfies ScannedProjectCard
            );
          }
        })
        .catch(() => {
          // best-effort
        })
    );
  }

  await Promise.all(ideTasks);

  return {
    generatedAt,
    cards: Array.from(cardsByKey.values()).sort((a, b) => a.alias.localeCompare(b.alias)),
  };
}

