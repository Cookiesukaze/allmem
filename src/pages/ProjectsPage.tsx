import { useEffect, useState } from "react";
import {
  ChevronLeft, Clock, RotateCcw, Save, Plus, Upload, FileText,
  Globe, Trash2, FolderOpen, Pencil, RefreshCw,
} from "lucide-react";
import { useAppStore } from "../store";
import { MarkdownView } from "../components/MarkdownView";
import {
  loadProjectMemory,
  loadProjectMeta,
  saveProjectMemory,
  saveProjectMeta,
  loadProjectInstructions,
  saveProjectInstructions,
  loadProjectRecent,
  listVersions,
  loadVersionContent,
  setVersionAsCurrent,
  listProjects,
  deleteProject,
  deleteVersion,
} from "../core/storage";
import { join, homeDir } from "@tauri-apps/api/path";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import { runSync } from "../core/sync";
import { loadConfig } from "../core/storage";
import type { MemoryVersion, ProjectMeta } from "../core/types";

export function ProjectsPage() {
  const { projects, setProjects, selectedProject, setSelectedProject, setConfig, projectSyncing: syncing, projectSyncStatus: syncStatus, setProjectSyncing: setSyncing, setProjectSyncStatus: setSyncStatus } = useAppStore();
  const [memory, setMemory] = useState<string>("");
  const [meta, setMeta] = useState<ProjectMeta | null>(null);
  const [versions, setVersions] = useState<MemoryVersion[]>([]);
  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editingMeta, setEditingMeta] = useState(false);
  const [metaDraft, setMetaDraft] = useState<ProjectMeta | null>(null);
  const [projectInstructions, setProjectInstructions] = useState("");
  const [editingInstructions, setEditingInstructions] = useState(false);
  const [instructionsDraft, setInstructionsDraft] = useState("");
  const [recentMemory, setRecentMemory] = useState<string>("");

  useEffect(() => {
    if (selectedProject) {
      loadProjectMemory(selectedProject).then((m) => setMemory(m ?? ""));
      loadProjectRecent(selectedProject).then((r) => setRecentMemory(r ?? ""));
      loadProjectMeta(selectedProject).then((m) => {
        // Ensure notes field exists for old data
        if (m && !("notes" in m)) (m as ProjectMeta).notes = "";
        setMeta(m);
      });
      loadProjectInstructions(selectedProject).then(setProjectInstructions);
      loadProjectVersions();
    }
  }, [selectedProject]);

  const loadProjectVersions = async () => {
    if (!selectedProject) return;
    try {
      const home = await homeDir();
      const historyDir = await join(home, ".allmem", "projects", selectedProject, "history");
      const v = await listVersions(historyDir);
      setVersions(v);
    } catch {
      setVersions([]);
    }
  };

  const handleSave = async () => {
    if (!selectedProject) return;
    await saveProjectMemory(selectedProject, editContent, "手动编辑");
    setMemory(editContent);
    setEditing(false);
    loadProjectVersions();
  };

  const handleRestoreVersion = async (filename: string) => {
    if (!selectedProject) return;
    await setVersionAsCurrent(selectedProject, filename);
    const content = await loadProjectMemory(selectedProject);
    setMemory(content ?? "");
    setViewingVersion(null);
    setShowHistory(false);
    loadProjectVersions();
  };

  const handleViewVersion = async (filename: string) => {
    if (!selectedProject) return;
    const content = await loadVersionContent(selectedProject, filename);
    setViewingVersion(content);
  };

  const handleDeleteVersion = async (filename: string) => {
    if (!selectedProject) return;
    await deleteVersion(selectedProject, filename);
    loadProjectVersions();
  };

  const handleDeleteProject = async (alias: string) => {
    await deleteProject(alias);
    setSelectedProject(null);
    const updated = await listProjects();
    setProjects(updated);
  };

  const handleOpenFolder = async (path: string) => {
    try {
      await invoke("open_folder", { path: path.replace(/\//g, "\\") });
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  };

  const handleSaveMeta = async () => {
    if (!metaDraft || !selectedProject) return;
    await saveProjectMeta(selectedProject, metaDraft);
    setMeta(metaDraft);
    setEditingMeta(false);
    const updated = await listProjects();
    setProjects(updated);
  };

  const handleSaveProjectInstructions = async () => {
    if (!selectedProject) return;
    await saveProjectInstructions(selectedProject, instructionsDraft);
    setProjectInstructions(instructionsDraft);
    setEditingInstructions(false);
  };

  const refreshProjects = async () => {
    const updated = await listProjects();
    setProjects(updated);
  };

  const handleSyncProject = async () => {
    if (!selectedProject || syncing) return;
    setSyncing(true);
    setSyncStatus("同步中...");
    try {
      const results = await runSync(
        (progress) => {
          setSyncStatus(progress.detail);
          // Refresh project data as soon as it completes
          if (progress.completedProject === selectedProject) {
            loadProjectMemory(selectedProject).then((m) => setMemory(m ?? ""));
            loadProjectRecent(selectedProject).then((r) => setRecentMemory(r ?? ""));
            loadProjectMeta(selectedProject).then((m) => {
              if (m && !("notes" in m)) (m as ProjectMeta).notes = "";
              setMeta(m);
            });
            loadProjectVersions();
          }
        },
        false,
        [selectedProject]
      );
      const errors = results.flatMap((r) => r.errors);
      if (errors.length > 0) {
        setSyncStatus(`同步出错: ${errors.join("; ")}`);
      } else {
        setSyncStatus("同步完成!");
        const updated = await listProjects();
        setProjects(updated);
        const updatedConfig = await loadConfig();
        setConfig(updatedConfig);
      }
      setTimeout(() => setSyncStatus(""), 2000);
    } catch (err) {
      setSyncStatus(`同步失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncing(false);
    }
  };

  // ── Project List View ──
  if (!selectedProject) {
    return (
      <div className="p-6 space-y-4 overflow-y-auto h-full">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">项目记忆</h1>
            <p className="text-sm text-muted-foreground">选择一个项目查看和编辑其记忆</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:opacity-90"
          >
            <Plus size={12} />
            新建项目
          </button>
        </div>

        {showCreate && (
          <CreateProjectDialog
            onClose={() => setShowCreate(false)}
            onCreated={() => {
              setShowCreate(false);
              refreshProjects();
            }}
          />
        )}

        <div className="space-y-2 mt-4">
          {projects.map((project) => (
            <div
              key={project.alias}
              className="bg-card rounded-xl border border-border p-4 hover:border-primary/30 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div
                  className="flex-1 cursor-pointer"
                  onClick={() => setSelectedProject(project.alias)}
                >
                  <h3 className="text-sm font-medium">{project.alias}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">{project.path}</p>
                  {project.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{project.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-3">
                  <div className="text-right mr-2">
                    <span className="text-xs text-muted-foreground">v{project.currentVersion}</span>
                    {project.lastSync && (
                      <p className="text-xs text-muted-foreground">
                        {new Date(project.lastSync).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleOpenFolder(project.path); }}
                    className="p-1.5 rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    title="打开项目文件夹"
                  >
                    <FolderOpen size={14} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(`确定删除项目 "${project.alias}" 的所有记忆？`)) {
                        handleDeleteProject(project.alias);
                      }
                    }}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
                    title="删除项目"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {projects.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              暂无项目。请先在概览页面执行同步，或手动新建项目。
            </p>
          )}
        </div>
      </div>
    );
  }

  // ── Project Detail View ──
  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            setSelectedProject(null);
            setEditing(false);
            setShowHistory(false);
            setViewingVersion(null);
            setShowImport(false);
            setEditingMeta(false);
            setEditingInstructions(false);
          }}
          className="p-1.5 rounded-lg hover:bg-secondary transition-colors"
        >
          <ChevronLeft size={16} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-semibold">{selectedProject}</h1>
          {meta && (
            <p className="text-xs text-muted-foreground">{meta.path}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSyncProject}
            disabled={syncing}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
            {syncing ? "同步中..." : "同步"}
          </button>
          {meta?.path && (
            <button
              onClick={() => handleOpenFolder(meta.path)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-secondary transition-colors"
              title="打开项目文件夹"
            >
              <FolderOpen size={12} />
              打开
            </button>
          )}
          <button
            onClick={() => setShowImport(!showImport)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-secondary transition-colors"
          >
            <Upload size={12} />
            导入
          </button>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-secondary transition-colors"
          >
            <Clock size={12} />
            历史
          </button>
          <button
            onClick={() => {
              if (confirm(`确定删除项目 "${selectedProject}" 的所有记忆？`)) {
                handleDeleteProject(selectedProject);
              }
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500/10 transition-colors"
          >
            <Trash2 size={12} />
            删除
          </button>
        </div>
      </div>

      {/* Sync Status */}
      {syncStatus && (
        <div className="bg-card rounded-xl border border-border p-3">
          <p className="text-xs text-muted-foreground">{syncStatus}</p>
        </div>
      )}

      {/* Meta Info Card */}
      {meta && (
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium">项目元信息</h3>
            {editingMeta ? (
              <div className="flex gap-1.5">
                <button
                  onClick={handleSaveMeta}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90"
                >
                  <Save size={10} />
                  保存
                </button>
                <button
                  onClick={() => { setEditingMeta(false); setMetaDraft(null); }}
                  className="px-2 py-0.5 text-xs rounded border border-border hover:bg-secondary"
                >
                  取消
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setEditingMeta(true); setMetaDraft({ ...meta }); }}
                className="flex items-center gap-1 px-2 py-0.5 text-xs rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              >
                <Pencil size={10} />
                编辑
              </button>
            )}
          </div>

          {editingMeta && metaDraft ? (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-muted-foreground">项目路径</label>
                  <input
                    type="text"
                    value={metaDraft.path}
                    onChange={(e) => setMetaDraft({ ...metaDraft, path: e.target.value })}
                    className="w-full px-2 py-1 text-xs bg-secondary rounded border border-border outline-none focus:border-primary"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">状态</label>
                  <select
                    value={metaDraft.status}
                    onChange={(e) => setMetaDraft({ ...metaDraft, status: e.target.value as "active" | "archived" })}
                    className="w-full px-2 py-1 text-xs bg-secondary rounded border border-border outline-none"
                  >
                    <option value="active">活跃</option>
                    <option value="archived">归档</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">描述 (自动生成)</label>
                <textarea
                  value={metaDraft.description}
                  onChange={(e) => setMetaDraft({ ...metaDraft, description: e.target.value })}
                  rows={3}
                  className="w-full px-2 py-1 text-xs bg-secondary rounded border border-border outline-none focus:border-primary resize-none"
                />
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground">备注 (用户自由编辑)</label>
                <textarea
                  value={metaDraft.notes ?? ""}
                  onChange={(e) => setMetaDraft({ ...metaDraft, notes: e.target.value })}
                  rows={2}
                  placeholder="你的个人注释..."
                  className="w-full px-2 py-1 text-xs bg-secondary rounded border border-border outline-none focus:border-primary resize-none"
                />
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">路径</span>
                  <span className="font-mono text-right truncate ml-2 max-w-[200px]">{meta.path}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">状态</span>
                  <span>{meta.status === "active" ? "活跃" : "归档"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">版本</span>
                  <span>v{meta.currentVersion}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">最后同步</span>
                  <span>{meta.lastSync ? new Date(meta.lastSync).toLocaleString() : "从未"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">创建时间</span>
                  <span>{new Date(meta.created).toLocaleDateString()}</span>
                </div>
              </div>
              {meta.description && (
                <div className="mt-3 pt-3 border-t border-border">
                  <p className="text-[10px] text-muted-foreground mb-1">描述</p>
                  <p className="text-xs leading-relaxed">{meta.description}</p>
                </div>
              )}
              {meta.notes && (
                <div className="mt-2 pt-2 border-t border-border">
                  <p className="text-[10px] text-muted-foreground mb-1">备注</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">{meta.notes}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Project Instructions (user-editable) */}
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-medium">项目使用说明</h3>
            <p className="text-[10px] text-muted-foreground">你希望AI在处理此项目时始终记住的信息，会注入到上下文中</p>
          </div>
          {editingInstructions ? (
            <div className="flex gap-1.5">
              <button
                onClick={handleSaveProjectInstructions}
                className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90"
              >
                <Save size={10} />
                保存
              </button>
              <button
                onClick={() => setEditingInstructions(false)}
                className="px-2 py-0.5 text-xs rounded border border-border hover:bg-secondary"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              onClick={() => {
                setInstructionsDraft(projectInstructions);
                setEditingInstructions(true);
              }}
              className="flex items-center gap-1 px-2 py-0.5 text-xs rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <Pencil size={10} />
              编辑
            </button>
          )}
        </div>

        {editingInstructions ? (
          <textarea
            value={instructionsDraft}
            onChange={(e) => setInstructionsDraft(e.target.value)}
            className="w-full h-40 bg-transparent text-sm font-mono resize-none outline-none"
            placeholder="例如：这个项目用 Tauri + React，注意 Windows 路径兼容性，优先用中文注释..."
          />
        ) : (
          <div className="min-h-[2rem]">
            {projectInstructions ? (
              <MarkdownView content={projectInstructions} />
            ) : (
              <p className="text-sm text-muted-foreground">
                暂无。点击编辑添加你希望AI在处理此项目时始终记住的信息。
              </p>
            )}
          </div>
        )}
      </div>

      {/* Import Panel */}
      {showImport && (
        <ImportPanel
          projectAlias={selectedProject}
          onImported={() => {
            loadProjectMemory(selectedProject).then((m) => setMemory(m ?? ""));
            loadProjectVersions();
            setShowImport(false);
          }}
        />
      )}

      {/* History Panel */}
      {showHistory && (
        <div className="bg-card rounded-xl border border-border p-4">
          <h3 className="text-sm font-medium mb-3">版本历史</h3>
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {versions.map((v) => (
              <div
                key={v.filename}
                className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-secondary/50 hover:bg-secondary text-xs"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono font-medium">v{v.version}</span>
                  <span className="text-muted-foreground">{v.date}</span>
                  <span>{v.summary}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleViewVersion(v.filename)}
                    className="px-2 py-0.5 rounded hover:bg-background transition-colors"
                  >
                    查看
                  </button>
                  <button
                    onClick={() => handleRestoreVersion(v.filename)}
                    className="px-2 py-0.5 rounded hover:bg-background transition-colors flex items-center gap-1"
                  >
                    <RotateCcw size={10} />
                    回滚
                  </button>
                  <button
                    onClick={() => {
                      if (confirm(`删除 v${v.version}？`)) handleDeleteVersion(v.filename);
                    }}
                    className="px-2 py-0.5 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
            ))}
            {versions.length === 0 && (
              <p className="text-xs text-muted-foreground">暂无历史版本</p>
            )}
          </div>
        </div>
      )}

      {/* Version Preview */}
      {viewingVersion && (
        <div className="bg-card rounded-xl border border-primary/20 p-4">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-primary">历史版本预览</h3>
            <button
              onClick={() => setViewingVersion(null)}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              关闭
            </button>
          </div>
          <div className="bg-secondary/50 rounded-lg p-3 max-h-64 overflow-y-auto">
            <MarkdownView content={viewingVersion} />
          </div>
        </div>
      )}

      {/* Recent Activity (WAL) */}
      <div className="bg-card rounded-xl border border-amber-500/20 p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-medium">近期动态</h3>
            <p className="text-[10px] text-muted-foreground">
              最近同步的对话摘要，攒够一定数量后会自动压缩到长期记忆中
            </p>
          </div>
        </div>
        {recentMemory && recentMemory.trim() !== "# 近期动态" ? (
          <div className="max-h-64 overflow-y-auto">
            <MarkdownView content={recentMemory} />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            暂无近期动态。{memory ? "已压缩到长期记忆中。" : "请先执行同步。"}
          </p>
        )}
      </div>

      {/* Memory Content */}
      <div className="bg-card rounded-xl border border-border p-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">长期记忆</h3>
          {editing ? (
            <button
              onClick={handleSave}
              className="flex items-center gap-1 px-2 py-0.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90"
            >
              <Save size={10} />
              保存
            </button>
          ) : (
            <button
              onClick={() => {
                setEditContent(memory);
                setEditing(true);
              }}
              className="flex items-center gap-1 px-2 py-0.5 text-xs rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              <Pencil size={10} />
              编辑
            </button>
          )}
        </div>
        {editing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full h-96 bg-transparent text-sm font-mono resize-none outline-none"
            placeholder="输入记忆内容..."
          />
        ) : (
          <div>
            {memory ? (
              <MarkdownView content={memory} />
            ) : (
              <p className="text-sm text-muted-foreground">暂无记忆内容。请先执行同步或导入记忆。</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Create Project Dialog ──
function CreateProjectDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
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
    <div className="bg-card rounded-xl border border-primary/30 p-4 space-y-3">
      <h3 className="text-sm font-medium">新建项目</h3>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">项目名 (alias)</label>
        <input
          type="text"
          value={alias}
          onChange={(e) => setAlias(e.target.value)}
          placeholder="my_project"
          className="w-full px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary"
        />
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">项目路径 (可选)</label>
        <input
          type="text"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="E:/Projects/my_project"
          className="w-full px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary"
        />
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">描述 (可选)</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="项目简介"
          className="w-full px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleCreate}
          disabled={!alias.trim()}
          className="px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          创建
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-secondary"
        >
          取消
        </button>
      </div>
    </div>
  );
}

// ── Import Panel ──
function ImportPanel({
  projectAlias,
  onImported,
}: {
  projectAlias: string;
  onImported: () => void;
}) {
  const [urlInput, setUrlInput] = useState("");
  const [importing, setImporting] = useState(false);
  const [status, setStatus] = useState("");

  const handleImportFile = async () => {
    try {
      const selected = await openDialog({
        multiple: false,
        filters: [{ name: "Text Files", extensions: ["md", "txt", "json"] }],
      });
      if (!selected) return;

      setImporting(true);
      setStatus("读取文件...");

      const content = await readTextFile(selected as string);

      const existing = await loadProjectMemory(projectAlias);
      const merged = existing ? `${existing}\n\n---\n\n## 导入内容\n${content}` : content;

      await saveProjectMemory(projectAlias, merged, "文件导入");
      setStatus("导入成功!");
      setTimeout(onImported, 500);
    } catch (err) {
      setStatus(`导入失败: ${err instanceof Error ? err.message : String(err)}`);
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
      const cleaned = text
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, "\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

      const existing = await loadProjectMemory(projectAlias);
      const merged = existing
        ? `${existing}\n\n---\n\n## 从URL导入\nSource: ${urlInput}\n\n${cleaned.slice(0, 5000)}`
        : `## 从URL导入\nSource: ${urlInput}\n\n${cleaned.slice(0, 5000)}`;

      await saveProjectMemory(projectAlias, merged, "URL导入");
      setStatus("导入成功!");
      setTimeout(onImported, 500);
    } catch (err) {
      setStatus(`导入失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border p-4 space-y-3">
      <h3 className="text-sm font-medium">导入记忆</h3>

      <div className="flex gap-2">
        <button
          onClick={handleImportFile}
          disabled={importing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-secondary transition-colors disabled:opacity-50"
        >
          <FileText size={12} />
          从文件导入 (.md / .txt)
        </button>
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          placeholder="https://example.com/doc"
          className="flex-1 px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary"
        />
        <button
          onClick={handleImportUrl}
          disabled={importing || !urlInput.trim()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-secondary transition-colors disabled:opacity-50"
        >
          <Globe size={12} />
          从URL导入
        </button>
      </div>

      {status && (
        <p className="text-xs text-muted-foreground">{status}</p>
      )}
    </div>
  );
}
