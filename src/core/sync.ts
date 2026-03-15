// Sync engine: orchestrate multi-agent extraction and archiving

import { extractClaudeSessions, extractCodexSessions, turnsToText, groupByProject } from "./extractor";
import { extractStructured, extractUserInfo, generateVersionSummary, generateProjectDescription } from "./llm";
import {
  loadConfig,
  saveConfig,
  loadUserMemory,
  saveUserMemory,
  loadProjectMeta,
  saveProjectMeta,
  loadProjectMemory,
  saveProjectMemory,
  appendSyncLog,
  initStorage,
} from "./storage";
import type { ProjectMeta, SyncResult } from "./types";

export interface SyncProgress {
  stage: string;
  detail: string;
  progress: number; // 0-100
}

type ProgressCallback = (progress: SyncProgress) => void;

/**
 * Run a full sync: extract from all enabled agents, structure, and archive
 */
export async function runSync(
  onProgress?: ProgressCallback,
  dryRun = false
): Promise<SyncResult[]> {
  await initStorage();
  const config = await loadConfig();
  const results: SyncResult[] = [];
  const syncStartTime = Date.now();
  const sinceTimestamp = config.sync.lastSyncTimestamp;

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

  if (config.agents.includes("claude")) {
    extractPromises.push(
      extractClaudeSessions(sinceTimestamp).then((sessions) => ({ agent: "claude", sessions }))
    );
  }
  if (config.agents.includes("codex")) {
    extractPromises.push(
      extractCodexSessions(sinceTimestamp).then((sessions) => ({ agent: "codex", sessions }))
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
  for (const [path, sessions] of projectGroups) {
    const projectName = sessions[0].projectName;
    const alias = projectName.toLowerCase().replace(/[^a-z0-9]/g, "_");
    if (config.syncProjects.length === 0 || config.syncProjects.includes(alias)) {
      filteredGroups.set(path, sessions);
    }
  }

  const totalProjects = filteredGroups.size;
  let processedProjects = 0;

  // ── Step 3: Process each project (with concurrency limit) ──
  const userConversations: string[] = [];
  const projectFns: (() => Promise<void>)[] = [];

  for (const [projectPath, sessions] of filteredGroups) {
    const projectName = sessions[0].projectName;

    const processProject = async () => {
      try {
        // Combine all conversation turns for this project
        const allTurns = sessions
          .sort((a, b) => a.lastModified - b.lastModified)
          .flatMap((s) => s.turns);

        const conversationText = turnsToText(
          allTurns,
          config.sync.maxTurns ?? 80,
          config.sync.maxCharsPerTurn ?? 800
        );

        // Collect user-level info for later
        userConversations.push(conversationText);

        // Load existing memory
        const alias = projectName.toLowerCase().replace(/[^a-z0-9]/g, "_");
        const existingMemory = await loadProjectMemory(alias);
        const isUpdate = !!existingMemory;

        onProgress?.({
          stage: isUpdate ? "更新" : "整理",
          detail: `${isUpdate ? "更新" : "整理"} ${projectName} 的记忆... (${processedProjects + 1}/${totalProjects})`,
          progress: 30 + (processedProjects / totalProjects) * 50,
        });

        console.log(`[sync] ${isUpdate ? "Updating" : "Creating"} project: ${projectName} (${allTurns.length} turns)`);

        // Call LLM to extract structured memory
        const newMemory = await extractStructured(
          conversationText,
          projectName,
          existingMemory,
          config.llm
        );

        // Generate version summary
        const summary = await generateVersionSummary(
          existingMemory,
          newMemory,
          config.llm
        );

        // Save project memory (with version history)
        await saveProjectMemory(alias, newMemory, summary);

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
          path: projectPath,
          description,
          notes: existingMeta?.notes ?? "",
          created: existingMeta?.created ?? new Date().toISOString(),
          lastSync: new Date().toISOString(),
          currentVersion: (existingMeta?.currentVersion ?? 0) + 1,
          status: "active",
        };
        await saveProjectMeta(alias, meta);

        processedProjects++;
        console.log(`[sync] Done: ${projectName}`);
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

  // ── Step 4: Update user profile ──
  onProgress?.({ stage: "用户画像", detail: "更新用户画像...", progress: 85 });

  if (userConversations.length > 0) {
    try {
      const existingProfile = await loadUserMemory();
      // Combine a sample of conversations (not all, to save tokens)
      const sampleText = userConversations
        .slice(0, 5)
        .join("\n\n---\n\n");

      const newProfile = await extractUserInfo(
        sampleText,
        existingProfile,
        config.llm
      );

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
      projectsUpdated: processedProjects,
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
