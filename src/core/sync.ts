// Sync engine: orchestrate multi-agent extraction and archiving

import { extractClaudeSessions, extractCodexSessions, turnsToText, groupByProject } from "./extractor";
import {
  summarizeSingleConversation,
  compactMemory,
  extractUserInfo,
  generateVersionSummary,
  generateProjectDescription,
  extractProjectObjects,
} from "./llm";
import { redactSensitive } from "./privacy";
import { getLLMConfigForRole } from "./types";
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
  loadProjectObjects,
  saveProjectObjects,
  saveProjectVersion,
} from "./storage";
import type { ProjectMeta, SyncResult } from "./types";

export interface SyncProgress {
  stage: string;
  detail: string;
  progress: number;
  completedProject?: string;
}

type ProgressCallback = (progress: SyncProgress) => void;

export async function runSync(
  onProgress?: ProgressCallback,
  dryRun = false,
  targetProjects?: string[]
): Promise<SyncResult[]> {
  await initStorage();
  const config = await loadConfig();
  const results: SyncResult[] = [];
  const syncStartTime = Date.now();
  const sinceTimestamp = config.sync.lastSyncTimestamp;

  onProgress?.({ stage: "检测", detail: "扫描已安装的AI工具...", progress: 5 });
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
  const totalSessions = allExtractions.reduce((sum, e) => sum + e.sessions.length, 0);

  onProgress?.({ stage: "提取", detail: `提取完成，共 ${totalSessions} 个会话`, progress: 30 });

  if (dryRun) {
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

  const allSessions = allExtractions.flatMap((e) => e.sessions);
  const projectGroups = groupByProject(allSessions);

  const filteredGroups = new Map<string, typeof allSessions>();
  const effectiveSyncAll = targetProjects ? false : config.syncAll;
  const effectiveSyncProjects = targetProjects ?? config.syncProjects;
  for (const [path, sessions] of projectGroups) {
    const projectName = sessions[0].projectName;
    const alias = projectName.toLowerCase().replace(/[^a-z0-9]/g, "_");
    if (effectiveSyncAll || effectiveSyncProjects.includes(alias)) {
      filteredGroups.set(path, sessions);
    }
  }

  if (!effectiveSyncAll && sinceTimestamp) {
    const foundAliases = new Set<string>();
    for (const [, sessions] of filteredGroups) {
      const alias = sessions[0].projectName.toLowerCase().replace(/[^a-z0-9]/g, "_");
      foundAliases.add(alias);
    }
    const missingAliases = effectiveSyncProjects.filter((a) => !foundAliases.has(a));

    if (missingAliases.length > 0) {
      onProgress?.({
        stage: "提取",
        detail: `为 ${missingAliases.join("、")} 重新全量提取...`,
        progress: 25,
      });

      const fullExtractPromises: Promise<{ agent: string; sessions: Awaited<ReturnType<typeof extractClaudeSessions>> }>[] = [];
      if (config.agents.includes("claude")) {
        fullExtractPromises.push(
          extractClaudeSessions().then((sessions) => ({ agent: "claude", sessions }))
        );
      }
      if (config.agents.includes("codex")) {
        fullExtractPromises.push(
          extractCodexSessions().then((sessions) => ({ agent: "codex", sessions }))
        );
      }
      const fullExtractions = await Promise.all(fullExtractPromises);
      const fullSessions = fullExtractions.flatMap((e) => e.sessions);
      const fullGroups = groupByProject(fullSessions);

      for (const [path, sessions] of fullGroups) {
        const alias = sessions[0].projectName.toLowerCase().replace(/[^a-z0-9]/g, "_");
        if (missingAliases.includes(alias) && !filteredGroups.has(path)) {
          filteredGroups.set(path, sessions);
        }
      }
    }
  }

  const totalProjects = filteredGroups.size;
  let processedProjects = 0;
  const userConversations: string[] = [];
  const projectFns: (() => Promise<void>)[] = [];

  for (const [projectPath, sessions] of filteredGroups) {
    const projectName = sessions[0].projectName;

    const processProject = async () => {
      try {
        const alias = projectName.toLowerCase().replace(/[^a-z0-9]/g, "_");
        const sortedSessions = [...sessions].sort((a, b) => a.lastModified - b.lastModified);
        const cheapConfig = getLLMConfigForRole(config.llm, "curator");
        const compactionThreshold = config.sync.compactionThreshold ?? 10;
        const existingMeta = await loadProjectMeta(alias);
        let latestMemory = await loadProjectMemory(alias);
        const projectSpan = totalProjects > 0 ? 50 / totalProjects : 0;
        const projectBase = 30 + processedProjects * projectSpan;
        const sessionDenominator = Math.max(sortedSessions.length, 1);
        const projectConversationSamples: string[] = [];
        const objectRefreshStride = 3;
        const pendingObjectEvidence: string[] = [];
        let dirtyObjectUpdates = 0;

        if (!existingMeta) {
          const initialMeta: ProjectMeta = {
            alias,
            path: projectPath,
            description: "",
            notes: "",
            created: new Date().toISOString(),
            lastSync: null,
            currentVersion: latestMemory ? 1 : 0,
            status: "active",
          };
          await saveProjectMeta(alias, initialMeta);
          onProgress?.({
            stage: "登记项目",
            detail: `${projectName}：已创建项目条目，开始填充内容...`,
            progress: projectBase + 0.2,
            completedProject: alias,
          });
        }

        // 报告开始处理会话
        if (sortedSessions.length === 0) {
          onProgress?.({
            stage: "检查",
            detail: `${projectName}：无新会话，跳过处理`,
            progress: projectBase + projectSpan * 0.5,
            completedProject: alias,
          });
        }

        for (let sessionIndex = 0; sessionIndex < sortedSessions.length; sessionIndex++) {
          const session = sortedSessions[sessionIndex];
          const progressBase = projectBase + (sessionIndex / sessionDenominator) * Math.max(projectSpan - 2, 0);
          const sessionText = redactSensitive(
            turnsToText(session.turns, config.sync.maxTurns ?? 80, config.sync.maxCharsPerTurn ?? 800),
            config
          );

          if (!sessionText.trim()) {
            continue;
          }

          projectConversationSamples.push(sessionText);
          userConversations.push(sessionText);

          onProgress?.({
            stage: "整理",
            detail: `${projectName}：分析第 ${sessionIndex + 1}/${sortedSessions.length} 段对话...`,
            progress: progressBase,
          });

          const summary = await summarizeSingleConversation(sessionText, projectName, cheapConfig);
          await appendProjectRecent(alias, summary, inferSessionSource(session.sessionId), session.lastModified);

          onProgress?.({
            stage: "写入",
            detail: `${projectName}：已写入第 ${sessionIndex + 1}/${sortedSessions.length} 段推进记录`,
            progress: progressBase + 0.8,
            completedProject: alias,
          });

          const recentCount = await countRecentEntries(alias);
          const needsCompaction = recentCount >= compactionThreshold || !latestMemory;

          pendingObjectEvidence.push(
            [
              summary,
              sessionText.slice(0, 2500),
            ].filter(Boolean).join("\n\n---\n\n")
          );
          dirtyObjectUpdates += 1;

          const shouldRefreshObjects =
            dirtyObjectUpdates >= objectRefreshStride ||
            recentCount >= compactionThreshold ||
            sessionIndex === sortedSessions.length - 1 ||
            !latestMemory;

          console.log(`[sync] Session ${sessionIndex + 1}/${sortedSessions.length}, dirtyObjectUpdates: ${dirtyObjectUpdates}, recentCount: ${recentCount}, needsCompaction: ${needsCompaction}, shouldRefreshObjects: ${shouldRefreshObjects}`);

          // 并行执行 compact 和 extractObjects
          const parallelTasks: Promise<void>[] = [];

          let compactedMemory: string | null = null;
          if (needsCompaction) {
            onProgress?.({
              stage: "压缩",
              detail: `${projectName}：压缩长期记忆（当前 ${recentCount} 条近期记录）...`,
              progress: progressBase + 2.2,
            });

            const recentContent = await loadProjectRecent(alias);
            parallelTasks.push(
              (async () => {
                const newMemory = await compactMemory(latestMemory, recentContent ?? summary, projectName, cheapConfig);
                const versionSummary = await generateVersionSummary(latestMemory, newMemory, cheapConfig);
                await saveProjectMemory(alias, newMemory, versionSummary);
                await clearProjectRecent(alias);
                compactedMemory = newMemory;
              })()
            );
          }

          if (shouldRefreshObjects) {
            const currentRecent = await loadProjectRecent(alias);
            const evidence = pendingObjectEvidence.join("\n\n=====\n\n");
            const existingObjects = await loadProjectObjects(alias);

            parallelTasks.push(
              (async () => {
                console.log(`[sync] Starting object extraction for ${projectName}`);
                const extracted = await extractProjectObjects(
                  projectName,
                  latestMemory,
                  currentRecent,
                  evidence,
                  cheapConfig,
                  existingObjects
                );
                // 根据 syncContent 配置，未勾选的板块保留原有数据
                const sc = config.syncContent;
                const merged = {
                  state: {
                    goal: sc.workspace.goal ? extracted.state.goal : (existingObjects?.state?.goal ?? ""),
                    currentStatus: sc.workspace.status ? extracted.state.currentStatus : (existingObjects?.state?.currentStatus ?? ""),
                    currentFocus: sc.workspace.focus ? extracted.state.currentFocus : (existingObjects?.state?.currentFocus ?? ""),
                    nextSteps: sc.workspace.nextSteps ? extracted.state.nextSteps : (existingObjects?.state?.nextSteps ?? []),
                    risks: sc.workspace.risks ? extracted.state.risks : (existingObjects?.state?.risks ?? []),
                  },
                  rules: sc.memory.rules ? extracted.rules : (existingObjects?.rules ?? []),
                  resources: sc.memory.resources ? extracted.resources : (existingObjects?.resources ?? []),
                  events: sc.events ? extracted.events : (existingObjects?.events ?? []),
                  updatedAt: extracted.updatedAt,
                };
                console.log(`[sync] Merged objects with syncContent filter`);
                await saveProjectObjects(alias, merged);
                console.log(`[sync] Saved objects successfully`);
              })()
            );
          }

          // 等待所有并行任务完成
          if (parallelTasks.length > 0) {
            const results = await Promise.allSettled(parallelTasks);
            for (const result of results) {
              if (result.status === "rejected") {
                console.error(`[sync] Parallel task failed:`, result.reason);
              }
            }
          }

          if (compactedMemory) {
            latestMemory = compactedMemory;
            onProgress?.({
              stage: "压缩",
              detail: `${projectName}：长期记忆已更新`,
              progress: progressBase + 2.8,
              completedProject: alias,
            });
          }

          if (shouldRefreshObjects) {
            pendingObjectEvidence.length = 0;
            dirtyObjectUpdates = 0;
            onProgress?.({
              stage: "结构化",
              detail: `${projectName}：已更新状态对象 (${sessionIndex + 1}/${sortedSessions.length})`,
              progress: progressBase + 3.4,
              completedProject: alias,
            });
          }
        }

        let description = existingMeta?.description ?? "";
        if (!description && projectConversationSamples.length > 0) {
          try {
            description = await generateProjectDescription(projectConversationSamples.join("\n\n---\n\n"), projectName, config.llm);
          } catch {
            description = "";
          }
        }

        const latestMemoryAfterSync = await loadProjectMemory(alias);
        const meta: ProjectMeta = {
          alias,
          path: projectPath,
          description,
          notes: existingMeta?.notes ?? "",
          created: existingMeta?.created ?? new Date().toISOString(),
          lastSync: new Date().toISOString(),
          currentVersion: existingMeta?.currentVersion ?? 0,
          status: "active",
        };
        await saveProjectMeta(alias, meta);

        // 保存版本快照
        if (latestMemoryAfterSync) {
          await saveProjectVersion(alias, `同步于 ${new Date().toLocaleString()}`);
        }

        processedProjects++;
        onProgress?.({
          stage: "完成项目",
          detail: `${projectName} 同步完成 (${processedProjects}/${totalProjects})`,
          progress: 30 + (processedProjects / Math.max(totalProjects, 1)) * 50,
          completedProject: alias,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
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

  await runWithConcurrency(projectFns, 3);

  if (!targetProjects && userConversations.length > 0 && config.syncContent.userProfile) {
    onProgress?.({ stage: "用户画像", detail: "更新用户画像...", progress: 85 });
    try {
      const existingProfile = await loadUserMemory();
      const sampleText = userConversations.slice(0, 5).join("\n\n---\n\n");
      const newProfile = await extractUserInfo(sampleText, existingProfile, config.llm);
      const profileSummary = await generateVersionSummary(existingProfile, newProfile, config.llm);
      await saveUserMemory(newProfile, profileSummary);
    } catch (err) {
      console.error("Failed to update user profile:", err);
    }
  }

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

  config.sync.lastSyncTimestamp = syncStartTime;
  await saveConfig(config);

  return results;
}

async function runWithConcurrency(fns: (() => Promise<void>)[], limit: number): Promise<void> {
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

function inferSessionSource(sessionId: string): string {
  const normalized = sessionId.toLowerCase();
  if (normalized.includes("codex")) return "codex";
  if (normalized.includes("claude")) return "claude";
  return "ai";
}


