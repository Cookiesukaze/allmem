import { useEffect, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ChevronLeft,
  Clock,
  FileText,
  FolderOpen,
  Lightbulb,
  Link2,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Target,
  Trash2,
  Upload,
  Wrench,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import { homeDir, join } from "@tauri-apps/api/path";
import { MarkdownView } from "../components/MarkdownView";
import {
  clearProjectMemory,
  deleteProject,
  deleteVersion,
  listProjects,
  listVersions,
  loadExperiences,
  loadProjectInstructions,
  loadProjectMemory,
  loadProjectMeta,
  loadProjectObjects,
  loadProjectRecent,
  loadVersionContent,
  saveProjectInstructions,
  saveProjectMemory,
  saveProjectMeta,
  saveProjectObjects,
  setVersionAsCurrent,
} from "../core/storage";
import { loadConfig } from "../core/storage";
import { runSync } from "../core/sync";
import type {
  Experience,
  MemoryVersion,
  ProjectMeta,
  ProjectObjects,
  ProjectResource,
  ProjectRule,
} from "../core/types";
import { useAppStore } from "../store";

type ProjectTab = "workspace" | "memory" | "distill" | "manual";
type ResourceKind = ProjectResource["kind"];

export function ProjectsPage() {
  const {
    projects,
    setProjects,
    selectedProject,
    setSelectedProject,
    setConfig,
    projectSyncing: syncing,
    projectSyncStatus: syncStatus,
    setProjectSyncing: setSyncing,
    setProjectSyncStatus: setSyncStatus,
  } = useAppStore();

  const [memory, setMemory] = useState("");
  const [meta, setMeta] = useState<ProjectMeta | null>(null);
  const [objects, setObjects] = useState<ProjectObjects>(createEmptyProjectObjects());
  const [versions, setVersions] = useState<MemoryVersion[]>([]);
  const [projectExperiences, setProjectExperiences] = useState<Experience[]>([]);
  const [editingMemory, setEditingMemory] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [projectInstructions, setProjectInstructions] = useState("");
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState("");
  const [recentMemory, setRecentMemory] = useState("");
  const [activeTab, setActiveTab] = useState<ProjectTab>("workspace");

  useEffect(() => {
    if (!selectedProject) return;
    setActiveTab("workspace");
    loadProjectData(selectedProject).catch(console.error);
  }, [selectedProject]);

  const loadProjectData = async (alias: string) => {
    const [loadedMemory, loadedRecent, loadedMeta, loadedInstructions, loadedObjects, allExperiences] = await Promise.all([
      loadProjectMemory(alias),
      loadProjectRecent(alias),
      loadProjectMeta(alias),
      loadProjectInstructions(alias),
      loadProjectObjects(alias),
      loadExperiences().catch(() => [] as Experience[]),
    ]);

    if (loadedMeta && !("notes" in loadedMeta)) {
      (loadedMeta as ProjectMeta).notes = "";
    }

    setMemory(loadedMemory ?? "");
    setRecentMemory(loadedRecent ?? "");
    setMeta(loadedMeta);
    setProjectInstructions(loadedInstructions);
    setObjects(normalizeProjectObjects(loadedObjects));
    setProjectExperiences(allExperiences.filter((exp) => exp.sources.some((source) => source.project === alias)));
    await loadProjectVersions(alias);
  };

  const loadProjectVersions = async (alias: string) => {
    try {
      const home = await homeDir();
      const historyDir = await join(home, ".allmem", "projects", alias, "history");
      setVersions(await listVersions(historyDir));
    } catch {
      setVersions([]);
    }
  };

  const refreshProjects = async () => {
    setProjects(await listProjects());
  };

  const persistObjects = async (next: ProjectObjects) => {
    if (!selectedProject) return;
    const normalized = normalizeProjectObjects({ ...next, updatedAt: new Date().toISOString() });
    setObjects(normalized);
    await saveProjectObjects(selectedProject, normalized);
  };

  const handleSyncProject = async () => {
    if (!selectedProject || syncing) return;
    setSyncing(true);
    setSyncStatus("同步中...");
    try {
      const results = await runSync(
        (progress) => {
          setSyncStatus(progress.detail);
          if (progress.completedProject === selectedProject) {
            loadProjectData(selectedProject).catch(console.error);
          }
        },
        false,
        [selectedProject]
      );
      const errors = results.flatMap((result) => result.errors);
      if (errors.length > 0) {
        setSyncStatus(`同步出错: ${errors.join("; ")}`);
      } else {
        setSyncStatus("同步完成");
        await refreshProjects();
        setConfig(await loadConfig());
        await loadProjectData(selectedProject);
      }
      setTimeout(() => setSyncStatus(""), 2000);
    } catch (error) {
      setSyncStatus(`同步失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleOpenFolder = async (path: string) => {
    try {
      await invoke("open_folder", { path: path.replace(/\//g, "\\") });
    } catch (error) {
      console.error("Failed to open folder:", error);
    }
  };

  const handleSaveMemory = async () => {
    if (!selectedProject) return;
    await saveProjectMemory(selectedProject, editContent, "手动编辑");
    setMemory(editContent);
    setEditingMemory(false);
    await loadProjectVersions(selectedProject);
  };

  const handleSaveInstructions = async () => {
    if (!selectedProject) return;
    await saveProjectInstructions(selectedProject, instructionsDraft);
    setProjectInstructions(instructionsDraft);
    setEditingInstructions(false);
  };

  const handleDeleteProject = async (alias: string) => {
    await deleteProject(alias);
    setSelectedProject(null);
    await refreshProjects();
  };

  const handleClearProject = async () => {
    if (!selectedProject) return;
    await clearProjectMemory(selectedProject);
    setMemory("");
    setRecentMemory("");
    setProjectInstructions("");
    setObjects(createEmptyProjectObjects());
    setProjectExperiences([]);
    setVersions([]);
    setEditingMemory(false);
    setViewingVersion(null);
    setShowHistory(false);
    setShowImport(false);
    setEditingInstructions(false);
    await loadProjectData(selectedProject);
  };

  const handleRestoreVersion = async (filename: string) => {
    if (!selectedProject) return;
    await setVersionAsCurrent(selectedProject, filename);
    await loadProjectData(selectedProject);
    setViewingVersion(null);
    setShowHistory(false);
  };

  const handleViewVersion = async (filename: string) => {
    if (!selectedProject) return;
    setViewingVersion(await loadVersionContent(selectedProject, filename));
  };

  const handleDeleteVersion = async (filename: string) => {
    if (!selectedProject) return;
    await deleteVersion(selectedProject, filename);
    await loadProjectVersions(selectedProject);
  };

  const promptText = (message: string, initial = "") => {
    const value = window.prompt(message, initial);
    return value === null ? null : value.trim();
  };

  const promptList = (message: string, items: string[]) => {
    const value = window.prompt(`${message}（用 | 分隔多项）`, items.join(" | "));
    if (value === null) return null;
    return value.split("|").map((item) => item.trim()).filter(Boolean);
  };

  const editProjectState = async () => {
    const current = objects.state;
    const goal = promptText("项目当前核心目标", current.goal);
    if (goal === null) return;
    const currentStatus = promptText("当前状态", current.currentStatus);
    if (currentStatus === null) return;
    const currentFocus = promptText("当前焦点", current.currentFocus);
    if (currentFocus === null) return;
    const nextSteps = promptList("未闭环事项 / 下一步", current.nextSteps);
    if (nextSteps === null) return;
    const risks = promptList("阻塞 / 风险", current.risks);
    if (risks === null) return;
    await persistObjects({ ...objects, state: { goal, currentStatus, currentFocus, nextSteps, risks } });
  };

  const promptRule = async (rule?: ProjectRule) => {
    const content = promptText("规则 / 偏好 / 约束", rule?.content ?? "");
    if (content === null || !content) return;
    const rationale = promptText("补充说明（可选）", rule?.rationale ?? "");
    if (rationale === null) return;
    const nextItem: ProjectRule = {
      id: rule?.id ?? makeObjectId("rule"),
      content,
      rationale: rationale || undefined,
    };
    await persistObjects({
      ...objects,
      rules: rule ? objects.rules.map((item) => (item.id === rule.id ? nextItem : item)) : [nextItem, ...objects.rules],
    });
  };
  const promptResource = async (resource?: ProjectResource) => {
    const label = promptText("资料名", resource?.label ?? "");
    if (label === null || !label) return;
    const kindInput = promptText("类型：path / command / url / doc / env", resource?.kind ?? "doc");
    if (kindInput === null) return;
    const value = promptText("内容", resource?.value ?? "");
    if (value === null || !value) return;
    const note = promptText("说明（可选）", resource?.note ?? "");
    if (note === null) return;
    const nextItem: ProjectResource = {
      id: resource?.id ?? makeObjectId("resource"),
      label,
      kind: normalizeResourceKindInput(kindInput),
      value,
      note: note || undefined,
    };
    await persistObjects({
      ...objects,
      resources: resource ? objects.resources.map((item) => (item.id === resource.id ? nextItem : item)) : [nextItem, ...objects.resources],
    });
  };

  const promptMetaEdit = async () => {
    if (!meta || !selectedProject) return;
    const path = promptText("项目路径", meta.path);
    if (path === null || !path) return;
    const description = promptText("项目描述", meta.description ?? "");
    if (description === null) return;
    const notes = promptText("备注", meta.notes ?? "");
    if (notes === null) return;
    const nextMeta: ProjectMeta = { ...meta, path, description, notes };
    await saveProjectMeta(selectedProject, nextMeta);
    setMeta(nextMeta);
    await refreshProjects();
  };

  const deleteRule = async (id: string) => {
    await persistObjects({ ...objects, rules: objects.rules.filter((item) => item.id !== id) });
  };

  const deleteResource = async (id: string) => {
    await persistObjects({ ...objects, resources: objects.resources.filter((item) => item.id !== id) });
  };

  if (!selectedProject) {
    return (
      <div className="h-full overflow-y-auto p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">项目记忆</h1>
            <p className="text-sm text-muted-foreground">选择一个项目，查看它的工作台、长期记忆、经验技能和用户维护。</p>
          </div>
          <button onClick={() => setShowCreate(true)} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90">
            <Plus size={12} />
            新建项目
          </button>
        </div>

        {showCreate && (
          <CreateProjectDialog
            onClose={() => setShowCreate(false)}
            onCreated={() => {
              setShowCreate(false);
              refreshProjects().catch(console.error);
            }}
          />
        )}

        <div className="space-y-2">
          {projects.map((project) => (
            <div key={project.alias} className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 cursor-pointer" onClick={() => setSelectedProject(project.alias)}>
                  <h3 className="text-sm font-medium">{project.alias}</h3>
                  <p className="mt-0.5 break-all text-xs text-muted-foreground">{project.path}</p>
                  {project.description && <p className="mt-2 text-xs leading-5 text-muted-foreground">{project.description}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right text-xs text-muted-foreground">
                    <div>v{project.currentVersion}</div>
                    <div>{project.lastSync ? new Date(project.lastSync).toLocaleDateString() : "未同步"}</div>
                  </div>
                  <button onClick={() => handleOpenFolder(project.path)} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" title="打开项目目录">
                    <FolderOpen size={14} />
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(`确定删除项目“${project.alias}”？`)) {
                        handleDeleteProject(project.alias).catch(console.error);
                      }
                    }}
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                    title="删除项目"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {projects.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">暂无项目。先同步一次，或者手动新建项目。</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4">
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            setSelectedProject(null);
            setEditingMemory(false);
            setViewingVersion(null);
            setShowHistory(false);
            setShowImport(false);
            setEditingInstructions(false);
          }}
          className="rounded-lg p-1.5 transition-colors hover:bg-secondary"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{selectedProject}</h1>
          {meta && <p className="break-all text-xs text-muted-foreground">{meta.path}</p>}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button onClick={handleSyncProject} disabled={syncing} className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
            <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
            {syncing ? "同步中..." : "同步"}
          </button>
          {meta?.path && (
            <button onClick={() => handleOpenFolder(meta.path)} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-secondary">
              <FolderOpen size={12} />
              打开
            </button>
          )}
          <button onClick={() => setShowImport((value) => !value)} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-secondary">
            <Upload size={12} />
            导入
          </button>
          <button onClick={() => setShowHistory((value) => !value)} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-secondary">
            <Clock size={12} />
            历史
          </button>
          <button
            onClick={() => {
              if (window.confirm(`确定清空项目“${selectedProject}”的全部记忆内容？`)) {
                handleClearProject().catch(console.error);
              }
            }}
            className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 px-3 py-1.5 text-xs text-amber-600 transition-colors hover:bg-amber-500/10"
          >
            <Trash2 size={12} />
            清空记忆
          </button>
          <button
            onClick={() => {
              if (window.confirm(`确定删除项目“${selectedProject}”？`)) {
                handleDeleteProject(selectedProject).catch(console.error);
              }
            }}
            className="flex items-center gap-1.5 rounded-lg border border-red-500/30 px-3 py-1.5 text-xs text-red-500 transition-colors hover:bg-red-500/10"
          >
            <Trash2 size={12} />
            删除
          </button>
        </div>
      </div>

      {syncStatus && <div className="rounded-xl border border-border bg-card p-3 text-xs text-muted-foreground">{syncStatus}</div>}

      <div className="flex w-fit flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-1">
        {[["workspace", "工作台"], ["memory", "长期记忆"], ["distill", "经验技能"], ["manual", "用户维护"]].map(([key, label]) => (
          <button key={key} onClick={() => setActiveTab(key as ProjectTab)} className={`rounded-lg px-3 py-1.5 text-xs transition-colors ${activeTab === key ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {label}
          </button>
        ))}
      </div>
      {showImport && (
        <ImportPanel
          projectAlias={selectedProject}
          onImported={() => {
            loadProjectData(selectedProject).catch(console.error);
            setShowImport(false);
          }}
        />
      )}

      {showHistory && (
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">版本历史</h3>
          <div className="max-h-56 space-y-1.5 overflow-y-auto">
            {versions.map((version) => (
              <div key={version.filename} className="flex items-center justify-between rounded-lg bg-secondary/50 px-3 py-2 text-xs">
                <div className="min-w-0 flex-1 pr-3">
                  <div className="font-mono">v{version.version}</div>
                  <div className="text-muted-foreground">{version.date}</div>
                  <div className="truncate">{version.summary}</div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => handleViewVersion(version.filename)} className="rounded px-2 py-0.5 hover:bg-background">查看</button>
                  <button onClick={() => handleRestoreVersion(version.filename)} className="rounded px-2 py-0.5 hover:bg-background">回滚</button>
                  <button
                    onClick={() => {
                      if (window.confirm(`删除 v${version.version}？`)) {
                        handleDeleteVersion(version.filename).catch(console.error);
                      }
                    }}
                    className="rounded px-2 py-0.5 text-muted-foreground hover:bg-red-500/10 hover:text-red-500"
                  >
                    删除
                  </button>
                </div>
              </div>
            ))}
            {versions.length === 0 && <p className="text-xs text-muted-foreground">暂无历史版本。</p>}
          </div>
        </div>
      )}

      {viewingVersion && (
        <div className="rounded-xl border border-primary/20 bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-primary">历史版本预览</h3>
            <button onClick={() => setViewingVersion(null)} className="text-xs text-muted-foreground hover:text-foreground">关闭</button>
          </div>
          <div className="max-h-72 overflow-y-auto rounded-lg bg-secondary/50 p-3">
            <MarkdownView content={viewingVersion} />
          </div>
        </div>
      )}

      {activeTab === "workspace" && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Project State</div>
                <h2 className="mt-1 text-lg font-semibold">当前局面</h2>
              </div>
              <button onClick={editProjectState} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                <Pencil size={12} />
                编辑
              </button>
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <StateBlock label="核心目标" value={objects.state.goal} empty="还没有明确记录当前核心目标。" icon={<Target size={14} />} />
              <StateBlock label="当前状态" value={objects.state.currentStatus} empty="还没有明确记录当前状态。" icon={<FileText size={14} />} />
              <StateBlock label="当前焦点" value={objects.state.currentFocus} empty="还没有明确记录当前焦点。" icon={<RefreshCw size={14} />} />
            </div>
          </div>

          <EntitySection
            title="未闭环事项"
            icon={<AlertTriangle size={14} />}
            empty="暂无未闭环事项。"
            items={buildOpenLoopItems(objects.state.nextSteps, objects.state.risks).map((item, index) => ({
              id: `open-loop-${index}`,
              title: item.title,
              description: item.description,
            }))}
          />

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 text-sm font-medium">近期动态</div>
            {recentMemory && recentMemory.trim() !== "# 近期动态" ? <MarkdownView content={recentMemory} /> : <p className="text-xs text-muted-foreground">暂无近期动态。</p>}
          </div>
        </div>
      )}

      {activeTab === "memory" && (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-medium">项目元信息</div>
              {meta && (
                <button onClick={() => promptMetaEdit().catch(console.error)} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                  <Pencil size={12} />
                  编辑
                </button>
              )}
            </div>
            {meta ? (
              <div className="space-y-2 text-xs">
                <InfoRow label="路径" value={meta.path} mono />
                <InfoRow label="状态" value={meta.status === "active" ? "活跃" : "归档"} />
                <InfoRow label="版本" value={`v${meta.currentVersion}`} />
                <InfoRow label="最后同步" value={meta.lastSync ? new Date(meta.lastSync).toLocaleString() : "从未"} />
                {meta.description && <InfoBlock label="描述" value={meta.description} />}
                {meta.notes && <InfoBlock label="备注" value={meta.notes} muted />}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">暂无元信息。</p>
            )}
          </div>

          <EntitySection
            title="长期规则"
            icon={<Target size={14} />}
            description="这里只放长期使用的规则、偏好、红线和稳定约束，不放当前一两次任务里的临时说法。"
            empty="暂无规则。"
            onAdd={() => promptRule().catch(console.error)}
            items={objects.rules.map((rule) => ({
              id: rule.id,
              title: rule.content,
              description: rule.rationale,
              onEdit: () => promptRule(rule).catch(console.error),
              onDelete: () => {
                if (window.confirm("删除这条规则？")) {
                  deleteRule(rule.id).catch(console.error);
                }
              },
            }))}
          />

          <EntitySection
            title="关键资料"
            icon={<Link2 size={14} />}
            description="这里只收以后真的会查、会用、会复用的路径、命令、文档和环境信息。"
            empty="暂无关键资料。"
            onAdd={() => promptResource().catch(console.error)}
            items={objects.resources.map((resource) => ({
              id: resource.id,
              title: resource.label,
              meta: kindLabel(resource.kind),
              description: `${resource.value}${resource.note ? `\n说明：${resource.note}` : ""}`,
              mono: resource.kind === "path" || resource.kind === "command" || resource.kind === "env",
              onEdit: () => promptResource(resource).catch(console.error),
              onDelete: () => {
                if (window.confirm("删除这条资料？")) {
                  deleteResource(resource.id).catch(console.error);
                }
              },
            }))}
          />

          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium">原始长记忆</h3>
                <p className="mt-1 text-[11px] text-muted-foreground">保留原始 Markdown 视图，方便你直接检查自动整理结果。</p>
              </div>
              {editingMemory ? (
                <div className="flex gap-1.5">
                  <button onClick={handleSaveMemory} className="flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground hover:opacity-90">
                    <Save size={10} />
                    保存
                  </button>
                  <button onClick={() => setEditingMemory(false)} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-secondary">取消</button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setEditContent(memory);
                    setEditingMemory(true);
                  }}
                  className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Pencil size={10} />
                  编辑
                </button>
              )}
            </div>
            {editingMemory ? (
              <textarea value={editContent} onChange={(event) => setEditContent(event.target.value)} className="h-96 w-full resize-none bg-transparent font-mono text-sm outline-none" placeholder="输入记忆内容..." />
            ) : memory ? (
              <MarkdownView content={memory} />
            ) : (
              <p className="text-sm text-muted-foreground">暂无长期记忆。</p>
            )}
          </div>
        </div>
      )}
      {activeTab === "distill" && (
        <div className="space-y-4">
          <EntitySection
            title="经验"
            icon={<Lightbulb size={14} />}
            description="这里放真正值得复盘的经验：大版本推进、关键问题攻克、重要路线取舍。"
            empty="暂无经验。"
            items={projectExperiences.filter((exp) => (exp.kind ?? "experience") !== "skill").map((exp) => ({
              id: exp.id,
              title: exp.title,
              meta: `confidence ${exp.confidence}`,
              description: [exp.content, exp.context ? `背景：${exp.context}` : ""].filter(Boolean).join("\n"),
            }))}
          />

          <EntitySection
            title="技能"
            icon={<Wrench size={14} />}
            description="这里只有复杂且可复用的一整轮流程，不放简单操作。"
            empty="暂无技能。"
            items={projectExperiences.filter((exp) => exp.kind === "skill").map((exp) => ({
              id: exp.id,
              title: exp.title,
              description: [
                exp.trigger ? `触发：${exp.trigger}` : "",
                exp.steps && exp.steps.length > 0 ? `步骤：${exp.steps.join("；")}` : "",
                exp.verification ? `验证：${exp.verification}` : "",
                exp.whyItWorks ? `原理：${exp.whyItWorks}` : "",
              ].filter(Boolean).join("\n"),
            }))}
          />
        </div>
      )}

      {activeTab === "manual" && (
        <div className="rounded-xl border border-border bg-card p-4 min-h-[420px]">
          <div className="mb-2 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium">用户维护</h3>
              <p className="mt-1 text-[11px] text-muted-foreground">这里放你希望始终注入给 LLM 的额外说明、约束、背景或使用说明。</p>
            </div>
            {editingInstructions ? (
              <div className="flex gap-1.5">
                <button onClick={handleSaveInstructions} className="flex items-center gap-1 rounded bg-primary px-2 py-0.5 text-xs text-primary-foreground hover:opacity-90">
                  <Save size={10} />
                  保存
                </button>
                <button onClick={() => setEditingInstructions(false)} className="rounded border border-border px-2 py-0.5 text-xs hover:bg-secondary">取消</button>
              </div>
            ) : (
              <button
                onClick={() => {
                  setInstructionsDraft(projectInstructions);
                  setEditingInstructions(true);
                }}
                className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                <Pencil size={10} />
                编辑
              </button>
            )}
          </div>

          {editingInstructions ? (
            <textarea value={instructionsDraft} onChange={(event) => setInstructionsDraft(event.target.value)} className="h-[340px] w-full resize-none bg-transparent text-sm leading-6 outline-none" placeholder="例如：优先中文；先给结论；不要自动 push；重要路径必须记住；实验报告需要包含评估方法。" />
          ) : projectInstructions ? (
            <MarkdownView content={projectInstructions} />
          ) : (
            <p className="text-sm text-muted-foreground">暂无用户维护内容。</p>
          )}
        </div>
      )}
    </div>
  );
}

function createEmptyProjectObjects(): ProjectObjects {
  return {
    state: { goal: "", currentStatus: "", currentFocus: "", nextSteps: [], risks: [] },
    rules: [],
    resources: [],
    events: [],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeProjectObjects(objects: ProjectObjects | null | undefined): ProjectObjects {
  return {
    state: {
      goal: typeof objects?.state?.goal === "string" ? objects.state.goal : "",
      currentStatus: typeof objects?.state?.currentStatus === "string" ? objects.state.currentStatus : "",
      currentFocus: typeof objects?.state?.currentFocus === "string" ? objects.state.currentFocus : "",
      nextSteps: Array.isArray(objects?.state?.nextSteps) ? objects.state.nextSteps : [],
      risks: Array.isArray(objects?.state?.risks) ? objects.state.risks : [],
    },
    rules: Array.isArray(objects?.rules) ? objects.rules : [],
    resources: Array.isArray(objects?.resources) ? objects.resources : [],
    events: Array.isArray(objects?.events) ? objects.events : [],
    updatedAt: typeof objects?.updatedAt === "string" ? objects.updatedAt : new Date().toISOString(),
  };
}

function makeObjectId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeResourceKindInput(value: string): ResourceKind {
  const normalized = value.trim().toLowerCase();
  return normalized === "path" || normalized === "command" || normalized === "url" || normalized === "doc" || normalized === "env" ? normalized : "doc";
}

function kindLabel(kind: ResourceKind): string {
  return kind === "path" ? "路径" : kind === "command" ? "命令" : kind === "url" ? "链接" : kind === "env" ? "环境" : "文档";
}

function buildOpenLoopItems(nextSteps: string[], risks: string[]): Array<{ title: string; description?: string }> {
  const size = Math.max(nextSteps.length, risks.length);
  const items: Array<{ title: string; description?: string }> = [];

  for (let index = 0; index < size; index += 1) {
    const nextStep = nextSteps[index] ?? "";
    const risk = risks[index] ?? "";
    const title = nextStep || risk;
    if (!title) continue;
    items.push({
      title,
      description: nextStep && risk ? `阻塞：${risk}` : nextStep ? undefined : `阻塞：${risk}`,
    });
  }

  return items;
}

function StateBlock({ label, value, empty, icon }: { label: string; value: string; empty: string; icon: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-background px-4 py-4">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">{icon}{label}</div>
      <p className={`text-sm leading-6 ${value ? "text-foreground" : "text-muted-foreground"}`}>{value || empty}</p>
    </div>
  );
}

function EntitySection({
  title,
  icon,
  description,
  items,
  empty,
  onAdd,
}: {
  title: string;
  icon: ReactNode;
  description?: string;
  items: Array<{ id: string; title: string; description?: string; meta?: string; mono?: boolean; onEdit?: () => void; onDelete?: () => void }>;
  empty: string;
  onAdd?: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            {icon}
            {title}
            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{items.length}</span>
          </div>
          {description && <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{description}</p>}
        </div>
        {onAdd && <button onClick={onAdd} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs transition-colors hover:bg-secondary"><Plus size={11} />新增</button>}
      </div>
      {items.length > 0 ? (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-xl border border-border bg-background px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 text-sm font-medium leading-6 break-words">{item.title}</div>
                    {item.meta && <span className="whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">{item.meta}</span>}
                  </div>
                  {item.description && <p className={`mt-2 whitespace-pre-line text-xs leading-6 text-muted-foreground ${item.mono ? "font-mono" : ""}`}>{item.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {item.onEdit && <button onClick={item.onEdit} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" title="编辑"><Pencil size={12} /></button>}
                  {item.onDelete && <button onClick={item.onDelete} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500" title="删除"><Trash2 size={12} /></button>}
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

function InfoRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="flex justify-between gap-3"><span className="text-muted-foreground">{label}</span><span className={mono ? "break-all text-right font-mono" : "text-right"}>{value}</span></div>;
}

function InfoBlock({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return <div className="border-t border-border pt-2"><p className="mb-1 text-[10px] text-muted-foreground">{label}</p><p className={`text-xs leading-relaxed ${muted ? "text-muted-foreground" : ""}`}>{value}</p></div>;
}

function CreateProjectDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [alias, setAlias] = useState("");
  const [path, setPath] = useState("");
  const [description, setDescription] = useState("");

  const handleCreate = async () => {
    if (!alias.trim()) return;
    const meta: ProjectMeta = {
      alias: alias.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_"),
      path: path.trim() || alias.trim(),
      description: description.trim(),
      notes: "",
      created: new Date().toISOString(),
      lastSync: null,
      currentVersion: 0,
      status: "active",
    };
    await saveProjectMeta(meta.alias, meta);
    onCreated();
  };

  return (
    <div className="space-y-3 rounded-xl border border-primary/30 bg-card p-4">
      <h3 className="text-sm font-medium">新建项目</h3>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">项目名 (alias)</label>
        <input type="text" value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="my_project" className="w-full rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm outline-none focus:border-primary" />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">项目路径 (可选)</label>
        <input type="text" value={path} onChange={(event) => setPath(event.target.value)} placeholder="E:/Projects/my_project" className="w-full rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm outline-none focus:border-primary" />
      </div>
      <div>
        <label className="mb-1 block text-xs text-muted-foreground">描述 (可选)</label>
        <input type="text" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="项目简介" className="w-full rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm outline-none focus:border-primary" />
      </div>
      <div className="flex gap-2">
        <button onClick={handleCreate} disabled={!alias.trim()} className="rounded-lg bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:opacity-90 disabled:opacity-50">创建</button>
        <button onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-xs hover:bg-secondary">取消</button>
      </div>
    </div>
  );
}

function ImportPanel({ projectAlias, onImported }: { projectAlias: string; onImported: () => void }) {
  const [urlInput, setUrlInput] = useState("");
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState("");

  const handleImportFile = async () => {
    try {
      const selected = await openDialog({ multiple: false, filters: [{ name: "Text Files", extensions: ["md", "txt", "json"] }] });
      if (!selected) return;
      setImporting(true);
      setStatus("读取文件...");
      const content = await readTextFile(selected as string);
      const existing = await loadProjectMemory(projectAlias);
      const merged = existing ? `${existing}\n\n---\n\n## 导入内容\n${content}` : content;
      await saveProjectMemory(projectAlias, merged, "文件导入");
      setStatus("导入成功");
      setTimeout(onImported, 500);
    } catch (error) {
      setStatus(`导入失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setImporting(false);
    }
  };

  const handleImportUrl = async () => {
    if (!urlInput.trim()) return;
    setImporting(true);
    setStatus("抓取网页...");
    try {
      const response = await fetch(urlInput.trim());
      const text = await response.text();
      const cleaned = text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      const existing = await loadProjectMemory(projectAlias);
      const merged = existing ? `${existing}\n\n---\n\n## 从URL导入\nSource: ${urlInput}\n\n${cleaned.slice(0, 5000)}` : `## 从URL导入\nSource: ${urlInput}\n\n${cleaned.slice(0, 5000)}`;
      await saveProjectMemory(projectAlias, merged, "URL导入");
      setStatus("导入成功");
      setTimeout(onImported, 500);
    } catch (error) {
      setStatus(`导入失败: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h3 className="text-sm font-medium">导入记忆</h3>
      <div className="flex gap-2">
        <button onClick={handleImportFile} disabled={importing} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-secondary disabled:opacity-50"><FileText size={12} />从文件导入</button>
      </div>
      <div className="flex gap-2">
        <input type="text" value={urlInput} onChange={(event) => setUrlInput(event.target.value)} placeholder="https://example.com/doc" className="flex-1 rounded-lg border border-border bg-secondary px-3 py-1.5 text-sm outline-none focus:border-primary" />
        <button onClick={handleImportUrl} disabled={importing || !urlInput.trim()} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-secondary disabled:opacity-50"><Upload size={12} />从URL导入</button>
      </div>
      {status && <p className="text-xs text-muted-foreground">{status}</p>}
    </div>
  );
}
