// Sync engine: orchestrate multi-agent extraction and archiving

import { extractClaudeSessions, extractCodexSessions, turnsToText, groupByProject } from "./extractor";
import {
  summarizeSingleConversation,
  compactMemory,
  extractUserInfo,
  generateVersionSummary,
  generateProjectDescription,
  narrateCausalChains,
  distillExperiences,
  mergeExperiences,
  extractProjectObjects,
} from "./llm";
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
  saveProjectObjects,
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
  const allDistilledResults: Array<{
    alias: string;
    distilled: { newExperiences: Omit<Experience, "id" | "created" | "updated" | "confidence" | "sources">[]; reinforced: string[] };
  }> = [];

  for (const [projectPath, sessions] of filteredGroups) {
    const projectName = sessions[0].projectName;

    const processProject = async () => {
      try {
        const allTurns = sessions.sort((a, b) => a.lastModified - b.lastModified).flatMap((s) => s.turns);

        const conversationText = redactSensitive(
          turnsToText(allTurns, config.sync.maxTurns ?? 80, config.sync.maxCharsPerTurn ?? 800),
          config
        );

        userConversations.push(conversationText);

        const alias = projectName.toLowerCase().replace(/[^a-z0-9]/g, "_");
        const existingMemory = await loadProjectMemory(alias);
        const isUpdate = !!existingMemory;

        onProgress?.({
          stage: "叙事",
          detail: `提取 ${projectName} 的因果链... (${processedProjects + 1}/${totalProjects})`,
          progress: 30 + (processedProjects / totalProjects) * 50,
        });

        const goodConfig = getLLMConfigForRole(config.llm, "narrator");
        const causalNarrative = await narrateCausalChains(conversationText, projectName, goodConfig);
        const hasCausalChains = causalNarrative.trim() !== "无因果链";

        onProgress?.({
          stage: isUpdate ? "更新" : "整理",
          detail: `${isUpdate ? "更新" : "整理"} ${projectName} 的记忆... (${processedProjects + 1}/${totalProjects})`,
          progress: 30 + (processedProjects / totalProjects) * 50 + 3,
        });

        const cheapConfig = getLLMConfigForRole(config.llm, "curator");
        const sessionSource = sessions[0]?.sessionId?.includes("codex") ? "codex" : "claude";

        const curatorTask = async () => {
          const inputText = hasCausalChains ? causalNarrative : conversationText;
          const summary = await summarizeSingleConversation(inputText, projectName, cheapConfig);
          await appendProjectRecent(alias, summary, sessionSource);

          const compactionThreshold = config.sync.compactionThreshold ?? 10;
          const recentCount = await countRecentEntries(alias);

          if (recentCount >= compactionThreshold || !existingMemory) {
            onProgress?.({
              stage: "压缩",
              detail: `压缩 ${projectName} 的记忆 (${recentCount} 条近期记录)...`,
              progress: 30 + (processedProjects / totalProjects) * 50 + 5,
            });

            const recentContent = await loadProjectRecent(alias);
            const newMemory = await compactMemory(existingMemory, recentContent ?? summary, projectName, cheapConfig);
            const versionSummary = await generateVersionSummary(existingMemory, newMemory, cheapConfig);
            await saveProjectMemory(alias, newMemory, versionSummary);
            await clearProjectRecent(alias);
          }
        };

        const distillerTask = async () => {
          if (!hasCausalChains || !config.enableDistiller) return;
          const distillerConfig = getLLMConfigForRole(config.llm, "distiller");
          const existingExps = await loadExperiences();
          const distilled = await distillExperiences(causalNarrative, alias, existingExps, distillerConfig);

          if (distilled.newExperiences.length > 0 || distilled.reinforced.length > 0) {
            allDistilledResults.push({ alias, distilled });
          }
        };

        await Promise.all([curatorTask(), distillerTask()]);

        onProgress?.({
          stage: "结构化",
          detail: `整理 ${projectName} 的结构化对象...`,
          progress: 30 + (processedProjects / totalProjects) * 50 + 8,
        });

        const currentMemory = await loadProjectMemory(alias);
        const currentRecent = await loadProjectRecent(alias);
        const objectsSource = hasCausalChains ? causalNarrative : conversationText;
        const objects = await extractProjectObjects(
          projectName,
          currentMemory,
          currentRecent,
          objectsSource,
          cheapConfig
        );
        await saveProjectObjects(alias, objects);

        const existingMeta = await loadProjectMeta(alias);
        let description = existingMeta?.description ?? "";
        if (!description) {
          try {
            description = await generateProjectDescription(conversationText, projectName, config.llm);
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
          currentVersion: existingMeta?.currentVersion ?? (existingMemory ? 1 : 0),
          status: "active",
        };
        await saveProjectMeta(alias, meta);

        processedProjects++;
        onProgress?.({
          stage: "完成项目",
          detail: `${projectName} 同步完成 (${processedProjects}/${totalProjects})`,
          progress: 30 + (processedProjects / totalProjects) * 50,
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

  if (allDistilledResults.length > 0) {
    onProgress?.({ stage: "蒸馏", detail: `合并 ${allDistilledResults.length} 个项目的经验...`, progress: 82 });
    let experiences = await loadExperiences();
    for (const { alias, distilled } of allDistilledResults) {
      experiences = mergeExperiences(experiences, distilled, alias);
    }
    await saveExperiences(experiences, `同步蒸馏${allDistilledResults.length}项`);
  }

  if (!targetProjects && userConversations.length > 0) {
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
