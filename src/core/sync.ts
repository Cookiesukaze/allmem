// Sync engine: orchestrate multi-agent extraction and archiving

import {
  extractClaudeSessions,
  extractCodexSessions,
  extractCursorSessions,
  turnsToText,
  groupByProject,
  looksLikeWindowsAbsPath,
} from "./extractor";
import { summarizeSingleConversation, compactMemory, extractUserInfo, generateVersionSummary, generateProjectDescription, narrateCausalChains, distillExperiences, mergeExperiences, dedupeUserProfileMarkdown } from "./llm";
import { redactSensitive } from "./privacy";
import { getLLMConfigForRole } from "./types";
import type { Experience } from "./types";
import {
  loadConfig,
  saveConfig,
  loadUserMemory,
  saveUserMemory,
  loadProjectMeta,
  saveProjectMeta,
  loadProjectMemory,
  saveProjectMemory,
  loadProjectRecent,
  appendProjectRecent,
  clearProjectRecent,
  countRecentEntries,
  appendSyncLog,
  initStorage,
  loadExperiences,
  saveExperiences,
  dedupeProjectAliasesByPath,
} from "./storage";
import type { ProjectMeta, SyncResult } from "./types";

export interface SyncProgress {
  stage: string;
  detail: string;
  progress: number; // 0-100
  completedProject?: string; // alias of just-finished project
}

type ProgressCallback = (progress: SyncProgress) => void;

/**
 * Run a full sync: extract from all enabled agents, structure, and archive
 * @param onProgress - progress callback
 * @param dryRun - if true, only report what would be synced
 * @param targetProjects - if set, only sync these project aliases (overrides config)
 */
export async function runSync(
  onProgress?: ProgressCallback,
  dryRun = false,
  targetProjects?: string[],
  targetAgents?: string[],
  targetProjectPaths?: string[]
): Promise<SyncResult[]> {
  await initStorage();
  const config = await loadConfig();
  const results: SyncResult[] = [];
  const syncStartTime = Date.now();
  const sinceTimestamp = config.sync.lastSyncTimestamp;
  const activeAgents = targetAgents && targetAgents.length > 0 ? targetAgents : config.agents;

  onProgress?.({ stage: "检测", detail: "扫描已安装的AI工具...", progress: 5 });

  // ── Step 1: Extract sessions from all enabled agents (parallel) ──
  onProgress?.({
    stage: "提取",
    detail: sinceTimestamp
      ? `提取 ${new Date(sinceTimestamp).toLocaleString()} 以来的新对话...`
      : "首次同步，提取所有对话...",
    progress: 10,
  });

  const extractPromises: Promise<{ agent: string; sessions: Awaited<ReturnType<typeof extractClaudeSessions>> }>[] = [];

  if (activeAgents.includes("codex")) {
    extractPromises.push(
      extractCodexSessions(sinceTimestamp).then((sessions) => ({ agent: "codex", sessions }))
    );
  }
  if (activeAgents.includes("claude")) {
    extractPromises.push(
      extractClaudeSessions(sinceTimestamp).then((sessions) => ({ agent: "claude", sessions }))
    );
  }
  if (activeAgents.includes("cursor")) {
    extractPromises.push(
      extractCursorSessions(sinceTimestamp).then((sessions) => ({ agent: "cursor", sessions }))
    );
  }

  const allExtractions = await Promise.all(extractPromises);

  // Log extraction results for debugging
  const totalSessions = allExtractions.reduce((sum, e) => sum + e.sessions.length, 0);
  console.log(`[sync] Extracted ${totalSessions} sessions from ${allExtractions.length} agents`);

  onProgress?.({ stage: "提取", detail: `提取完成，共 ${totalSessions} 个会话`, progress: 30 });

  if (dryRun) {
    // Just report what would be synced
    for (const { agent, sessions } of allExtractions) {
      const grouped = groupByProject(sessions);
      results.push({
        agent,
        projectsFound: grouped.size,
        projectsUpdated: 0,
        errors: [],
        timestamp: new Date().toISOString(),
      });
    }
    return results;
  }

  // ── Step 2: Group all sessions by project ──
  const allSessions = allExtractions.flatMap((e) => e.sessions);
  const projectGroups = groupByProject(allSessions);

  // Filter by syncProjects if specified
  const filteredGroups = new Map<string, typeof allSessions>();
  const hasExplicitTargets =
    (targetProjects?.length ?? 0) > 0 || (targetProjectPaths?.length ?? 0) > 0;
  const effectiveSyncAll = hasExplicitTargets ? false : config.syncAll;
  const effectiveSyncProjects = targetProjects ?? config.syncProjects;
  const effectiveSyncProjectPaths = new Set(
    (targetProjectPaths ?? []).map((p) => normalizeProjectPathForMatch(p))
  );
  for (const [path, sessions] of projectGroups) {
    const projectName = sessions[0].projectName;
    const alias = projectName.toLowerCase().replace(/[^a-z0-9]/g, "_");
    const normalizedPath = normalizeProjectPathForMatch(path);
    if (
      effectiveSyncAll ||
      effectiveSyncProjects.includes(alias) ||
      effectiveSyncProjectPaths.has(normalizedPath)
    ) {
      filteredGroups.set(path, sessions);
    }
  }

  // If user selected specific projects that weren't found in incremental extraction,
  // do a full extraction (no sinceTimestamp) to find them
  if (!effectiveSyncAll && sinceTimestamp) {
    const foundAliases = new Set<string>();
    const foundPaths = new Set<string>();
    for (const [, sessions] of filteredGroups) {
      const alias = sessions[0].projectName.toLowerCase().replace(/[^a-z0-9]/g, "_");
      foundAliases.add(alias);
    }
    for (const [path] of filteredGroups) {
      foundPaths.add(normalizeProjectPathForMatch(path));
    }
    const missingAliases = effectiveSyncProjects.filter((a) => !foundAliases.has(a));
    const missingPaths = Array.from(effectiveSyncProjectPaths).filter(
      (p) => !foundPaths.has(p)
    );

    if (missingAliases.length > 0 || missingPaths.length > 0) {
      onProgress?.({
        stage: "提取",
        detail: "为缺失项目重新全量提取...",
        progress: 25,
      });

      const fullExtractPromises: Promise<{ agent: string; sessions: Awaited<ReturnType<typeof extractClaudeSessions>> }>[] = [];
      if (activeAgents.includes("claude")) {
        fullExtractPromises.push(
          extractClaudeSessions().then((sessions) => ({ agent: "claude", sessions }))
        );
      }
      if (activeAgents.includes("codex")) {
        fullExtractPromises.push(
          extractCodexSessions().then((sessions) => ({ agent: "codex", sessions }))
        );
      }
      if (activeAgents.includes("cursor")) {
        fullExtractPromises.push(
          extractCursorSessions().then((sessions) => ({ agent: "cursor", sessions }))
        );
      }
      const fullExtractions = await Promise.all(fullExtractPromises);
      const fullSessions = fullExtractions.flatMap((e) => e.sessions);
      const fullGroups = groupByProject(fullSessions);
      const missingPathsSet = new Set(missingPaths);

      for (const [path, sessions] of fullGroups) {
        const alias = sessions[0].projectName.toLowerCase().replace(/[^a-z0-9]/g, "_");
        const normalizedPath = normalizeProjectPathForMatch(path);
        const shouldInclude =
          missingAliases.includes(alias) || missingPathsSet.has(normalizedPath);
        if (shouldInclude && !hasProjectPath(filteredGroups, path)) {
          filteredGroups.set(path, sessions);
        }
      }
    }
  }

  const totalProjects = filteredGroups.size;
  let processedProjects = 0;
  const updatedProjectsByAgent = new Map<string, number>();
  let lastProjectProgress = 0;
  const guardProjectProgress = (p: number) => {
    lastProjectProgress = Math.max(lastProjectProgress, p);
    return lastProjectProgress;
  };

  // ── Step 3: Process each project (with concurrency limit) ──
  const userConversations: string[] = [];
  const projectFns: (() => Promise<void>)[] = [];
  const allDistilledResults: Array<{
    alias: string;
    distilled: { newExperiences: Omit<Experience, "id" | "created" | "updated" | "confidence" | "sources">[]; reinforced: string[] };
  }> = [];

  let projectOrder = 0;
  for (const [projectPath, sessions] of filteredGroups) {
    projectOrder++;
    const currentProjectIndex = projectOrder; // 1..totalProjects (stable snapshot for progress calc)
    const sliceStart = 30 + ((currentProjectIndex - 1) / totalProjects) * 50;
    const sliceEnd = 30 + (currentProjectIndex / totalProjects) * 50;
    const getProjectProgress = (fraction: number) =>
      sliceStart + (sliceEnd - sliceStart) * fraction; // fraction in [0, 1]

    const projectName = sessions[0].projectName;

    const processProject = async () => {
      try {
        // Combine all conversation turns for this project
        const allTurns = sessions
          .sort((a, b) => a.lastModified - b.lastModified)
          .flatMap((s) => s.turns);

        const conversationText = redactSensitive(turnsToText(
          allTurns,
          config.sync.maxTurns ?? 80,
          config.sync.maxCharsPerTurn ?? 800
        ), config);

        // Collect user-level info for later
        userConversations.push(conversationText);

        // Load existing memory
        const alias = projectName.toLowerCase().replace(/[^a-z0-9]/g, "_");
        // Auto-migrate legacy aliases that point to the same project path (e.g. asit -> travel_asit).
        const storagePath = looksLikeWindowsAbsPath(sessions[0].projectPath)
          ? sessions[0].projectPath
          : "";
        const migratedAliases = await dedupeProjectAliasesByPath(alias, storagePath).catch(() => []);
        if (migratedAliases.length > 0) {
          console.log(`[sync] alias migration: ${migratedAliases.join(",")} -> ${alias}`);
        }
        const existingMemory = await loadProjectMemory(alias);
        const isUpdate = !!existingMemory;

        const uniqueAgents = Array.from(new Set(sessions.map((s) => s.agent)));
        const agentLabel = uniqueAgents.join(",");
        const sessionSource = uniqueAgents.join("+");

        // ── Agent 1: Narrator (good model, sequential) ──
        onProgress?.({
          stage: "叙事",
          detail: `提取 ${projectName} 的因果链...（来源: ${agentLabel || "unknown"}）(${currentProjectIndex}/${totalProjects})`,
          progress: guardProjectProgress(getProjectProgress(0.1)),
        });

        const goodConfig = getLLMConfigForRole(config.llm, "narrator");
        const causalNarrative = await narrateCausalChains(conversationText, projectName, goodConfig);
        const hasCausalChains = causalNarrative.trim() !== "无因果链";

        console.log(`[narrator] ${projectName}: ${hasCausalChains ? "extracted causal chains" : "no causal chains"}`);

        // ── Agent 2 + 3: Curator + Distiller (parallel) ──
        onProgress?.({
          stage: isUpdate ? "更新" : "整理",
          detail: `${isUpdate ? "更新" : "整理"} ${projectName} 的记忆...（来源: ${agentLabel || "unknown"}）(${currentProjectIndex}/${totalProjects})`,
          progress: guardProjectProgress(getProjectProgress(0.35)),
        });

        const cheapConfig = getLLMConfigForRole(config.llm, "curator");

        // Curator task: summarize → WAL → compaction
        const curatorTask = async () => {
          // Feed causal narrative to Curator if available, else raw conversation
          const inputText = hasCausalChains ? causalNarrative : conversationText;
          const summary = await summarizeSingleConversation(inputText, projectName, cheapConfig);
          await appendProjectRecent(alias, summary, sessionSource);

          const COMPACTION_THRESHOLD = config.sync.compactionThreshold ?? 10;
          const recentCount = await countRecentEntries(alias);

          if (recentCount >= COMPACTION_THRESHOLD || !existingMemory) {
            onProgress?.({
              stage: "压缩",
              detail: `压缩 ${projectName} 的记忆 (${recentCount} 条近期记录)...`,
              progress: guardProjectProgress(getProjectProgress(0.7)),
            });

            const recentContent = await loadProjectRecent(alias);
            const newMemory = await compactMemory(
              existingMemory,
              recentContent ?? summary,
              projectName,
              cheapConfig
            );

            const versionSummary = await generateVersionSummary(existingMemory, newMemory, cheapConfig);
            await saveProjectMemory(alias, newMemory, versionSummary);
            await clearProjectRecent(alias);

            console.log(`[curator] Compacted: ${projectName} (${recentCount} entries merged)`);
          } else {
            console.log(`[curator] WAL append: ${projectName} (${recentCount}/${COMPACTION_THRESHOLD} entries)`);
          }
        };

        // Distiller task: extract experiences (only if causal chains found)
        const distillerTask = async () => {
          if (!hasCausalChains) return;
          const distillerConfig = getLLMConfigForRole(config.llm, "distiller");
          const existingExps = await loadExperiences();
          const distilled = await distillExperiences(causalNarrative, alias, existingExps, distillerConfig);

          console.log(`[distiller] ${projectName}: ${distilled.newExperiences.length} new, ${distilled.reinforced.length} reinforced`);

          if (distilled.newExperiences.length > 0 || distilled.reinforced.length > 0) {
            allDistilledResults.push({ alias, distilled });
          }
        };

        // Run Curator and Distiller in parallel
        await Promise.all([curatorTask(), distillerTask()]);

        // Save/update project meta
        const existingMeta = await loadProjectMeta(alias);

        // Auto-generate description if empty or on first sync
        let description = existingMeta?.description ?? "";
        if (!description) {
          try {
            description = await generateProjectDescription(
              conversationText,
              projectName,
              config.llm
            );
          } catch {
            description = "";
          }
        }

        const meta: ProjectMeta = {
          alias,
          path: storagePath,
          description,
          notes: existingMeta?.notes ?? "",
          created: existingMeta?.created ?? new Date().toISOString(),
          lastSync: new Date().toISOString(),
          currentVersion: existingMeta?.currentVersion ?? (existingMemory ? 1 : 0),
          status: "active",
        };
        await saveProjectMeta(alias, meta);

        processedProjects++;
        for (const agentId of uniqueAgents) {
          updatedProjectsByAgent.set(
            agentId,
            (updatedProjectsByAgent.get(agentId) ?? 0) + 1
          );
        }
        console.log(`[sync] Done: ${projectName}`);

        onProgress?.({
          stage: "完成项目",
          detail: `${projectName} 同步完成 (${processedProjects}/${totalProjects})`,
          progress: guardProjectProgress(getProjectProgress(1)),
          completedProject: alias,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[sync] Error processing ${projectName}:`, errMsg);
        results.push({
          agent: "mixed",
          projectsFound: 1,
          projectsUpdated: 0,
          errors: [`${projectName}: ${errMsg}`],
          timestamp: new Date().toISOString(),
        });
      }
    };

    projectFns.push(processProject);
  }

  // Run project processing with concurrency of 3
  await runWithConcurrency(projectFns, 3);

  // ── Step 3.5: Batch merge all distilled experiences ──
  if (allDistilledResults.length > 0) {
    onProgress?.({ stage: "蒸馏", detail: `合并 ${allDistilledResults.length} 个项目的经验...`, progress: 82 });
    let experiences = await loadExperiences();
    for (const { alias, distilled } of allDistilledResults) {
      experiences = mergeExperiences(experiences, distilled, alias);
    }
    await saveExperiences(experiences, `同步蒸馏${allDistilledResults.length}项`);
    console.log(`[distiller] Saved ${experiences.length} total experiences`);
  }

  // ── Step 4: Update user profile ──
  // User requested manual project selection should also update user profile.
  if (userConversations.length > 0) {
    onProgress?.({ stage: "用户画像", detail: "更新用户画像...", progress: 85 });
    try {
      const existingProfile = await loadUserMemory();
      // Combine a deduplicated sample (not all, to save tokens and reduce repeated profile facts)
      const sampleText = buildDedupedUserProfileSample(userConversations);

      const newProfileRaw = await extractUserInfo(
        sampleText,
        existingProfile,
        config.llm
      );
      const newProfile = dedupeUserProfileMarkdown(newProfileRaw);

      const profileSummary = await generateVersionSummary(
        existingProfile,
        newProfile,
        config.llm
      );

      await saveUserMemory(newProfile, profileSummary);
    } catch (err) {
      console.error("Failed to update user profile:", err);
    }
  }

  // ── Step 5: Log sync ──
  onProgress?.({ stage: "完成", detail: "同步完成!", progress: 100 });

  for (const { agent, sessions } of allExtractions) {
    const grouped = groupByProject(sessions);
    results.push({
      agent,
      projectsFound: grouped.size,
      projectsUpdated: updatedProjectsByAgent.get(agent) ?? 0,
      errors: [],
      timestamp: new Date().toISOString(),
    });
  }

  await appendSyncLog({
    results,
    projectsProcessed: processedProjects,
    totalSessions: allSessions.length,
  });

  // Save sync timestamp for incremental sync next time
  config.sync.lastSyncTimestamp = syncStartTime;
  await saveConfig(config);

  return results;
}

function buildDedupedUserProfileSample(conversations: string[]): string {
  const picked = conversations.slice(0, 5);
  const seen = new Set<string>();
  const dedupedBlocks: string[] = [];

  for (const convo of picked) {
    const blocks = convo
      .split(/\n{2,}/)
      .map((b) => b.trim())
      .filter(Boolean);
    for (const block of blocks) {
      const key = block
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      dedupedBlocks.push(block);
      if (dedupedBlocks.length >= 120) break;
    }
    if (dedupedBlocks.length >= 120) break;
  }

  return dedupedBlocks.join("\n\n---\n\n");
}

function normalizeProjectPathForMatch(path: string): string {
  let value = path.replace(/\//g, "\\").trim();
  if (/^[a-zA-Z]:\\/.test(value)) {
    value = value[0].toUpperCase() + value.slice(1);
  }
  if (!/^[a-zA-Z]:\\$/.test(value)) {
    value = value.replace(/\\+$/, "");
  }
  return value.toLowerCase();
}

function hasProjectPath(groups: Map<string, unknown>, path: string): boolean {
  const target = normalizeProjectPathForMatch(path);
  for (const key of groups.keys()) {
    if (normalizeProjectPathForMatch(key) === target) return true;
  }
  return false;
}

// Simple concurrency limiter
async function runWithConcurrency(
  fns: (() => Promise<void>)[],
  limit: number
): Promise<void> {
  const executing: Promise<void>[] = [];
  for (const fn of fns) {
    const p = fn().then(() => {
      executing.splice(executing.indexOf(p), 1);
    });
    executing.push(p);
    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
}
