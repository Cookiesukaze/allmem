import { useEffect, useMemo, useState } from "react";
import { RefreshCw, FolderOpen, Clock, CheckCircle2, AlertCircle, Lightbulb } from "lucide-react";
import { useAppStore } from "../store";
import { runSync } from "../core/sync";
import { listProjects, loadConfig, loadExperiences, saveConfig } from "../core/storage";
import { detectAgents } from "../core/detector";

export function DashboardPage() {
  const {
    projects,
    setProjects,
    isSyncing,
    setIsSyncing,
    syncProgress,
    setSyncProgress,
    setLastSyncResults,
    detectedAgents,
    setDetectedAgents,
    config,
    setConfig,
  } = useAppStore();
  const [expCount, setExpCount] = useState(0);
  const [showSyncDialog, setShowSyncDialog] = useState(false);
  const [syncAllDraft, setSyncAllDraft] = useState(true);
  const [syncProjectsDraft, setSyncProjectsDraft] = useState<string[]>([]);
  const [syncFilter, setSyncFilter] = useState("");
  const [syncOnceNoRemember, setSyncOnceNoRemember] = useState(false);

  useEffect(() => {
    // Load initial data
    listProjects().then(setProjects).catch(console.error);
    detectAgents().then(setDetectedAgents).catch(console.error);
    loadConfig().then(setConfig).catch(console.error);
    loadExperiences().then(exps => setExpCount(exps.length)).catch(console.error);
  }, []);

  const allProjectAliases = useMemo(() => {
    const fromStorage = projects.map((p) => p.alias);
    const fromConfig = config.syncProjects ?? [];
    return Array.from(new Set([...fromStorage, ...fromConfig])).sort();
  }, [projects, config.syncProjects]);

  const openSyncDialog = () => {
    setSyncAllDraft(config.syncAll ?? true);
    setSyncProjectsDraft(config.syncProjects ?? []);
    setSyncFilter("");
    // default: remember selection (i.e. not "once only")
    setSyncOnceNoRemember(false);
    setShowSyncDialog(true);
  };

  const toggleDraftProject = (alias: string) => {
    setSyncProjectsDraft((prev) => {
      if (prev.includes(alias)) return prev.filter((a) => a !== alias);
      return [...prev, alias];
    });
  };

  const handleSync = async (targetProjects?: string[]) => {
    setIsSyncing(true);
    setSyncProgress({ stage: "开始", detail: "准备同步...", progress: 0 });

    try {
      const results = await runSync((progress) => {
        setSyncProgress(progress);
        // Refresh project list and experience count incrementally as each project completes
        if (progress.completedProject) {
          listProjects().then(setProjects).catch(console.error);
          loadExperiences().then(exps => setExpCount(exps.length)).catch(console.error);
        }
      }, false, targetProjects);
      setLastSyncResults(results);
      // Refresh project list
      const updated = await listProjects();
      setProjects(updated);
      // Refresh config to update lastSyncTimestamp
      const updatedConfig = await loadConfig();
      setConfig(updatedConfig);
      // Refresh experience count
      loadExperiences().then(exps => setExpCount(exps.length)).catch(console.error);
      // Show errors if any
      const errors = results.flatMap((r) => r.errors);
      if (errors.length > 0) {
        setSyncProgress({ stage: "错误", detail: errors.join("; "), progress: 100 });
        return; // keep error visible
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Sync failed:", msg);
      setSyncProgress({ stage: "失败", detail: msg, progress: 0 });
      return; // keep error visible
    } finally {
      setIsSyncing(false);
      setSyncProgress(null);
    }
  };

  const confirmAndSync = async () => {
    // Persist the selection immediately so users don't have to "保存设置" elsewhere.
    // Keep manual selection even when syncAll=true, so toggling back can restore intent.
    const normalizedManual = Array.from(new Set(syncProjectsDraft)).sort();
    const nextConfig = {
      ...config,
      syncAll: syncAllDraft,
      syncProjects: normalizedManual,
    };

    if (!syncOnceNoRemember) {
      setConfig(nextConfig);
      await saveConfig(nextConfig);
    }

    setShowSyncDialog(false);

    if (syncAllDraft) {
      await handleSync(undefined);
      return;
    }

    await handleSync(normalizedManual);
  };

  const filteredAliases = useMemo(() => {
    const q = syncFilter.trim().toLowerCase();
    if (!q) return allProjectAliases;
    return allProjectAliases.filter((a) => a.toLowerCase().includes(q));
  }, [allProjectAliases, syncFilter]);

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">概览</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            管理你的跨工具AI记忆
          </p>
        </div>
        <button
          onClick={openSyncDialog}
          disabled={isSyncing}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
          {isSyncing ? "同步中..." : "立即同步"}
        </button>
      </div>

      {/* Sync Dialog */}
      {showSyncDialog && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={() => setShowSyncDialog(false)}
        >
          <div
            className="w-full max-w-xl bg-card rounded-xl border border-border shadow-md"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-5 py-4 border-b border-border flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold">选择本次要同步的项目</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  
                </p>
              </div>
              <button
                className="text-xs px-2 py-1 rounded-lg border border-border hover:bg-secondary transition-colors"
                onClick={() => setShowSyncDialog(false)}
              >
                关闭
              </button>
            </div>

            <div className="px-5 py-4 space-y-3">
              <label className="flex items-center gap-2 py-2 px-3 rounded-lg bg-secondary/50 cursor-pointer hover:bg-secondary">
                <input
                  type="checkbox"
                  checked={syncAllDraft}
                  onChange={(e) => setSyncAllDraft(e.target.checked)}
                  className="accent-primary"
                />
                <span className="text-sm font-medium">全部同步</span>
                <span className="text-xs text-muted-foreground">
                  （共 {allProjectAliases.length} 个）
                </span>
              </label>

              {!syncAllDraft && (
                <>
                  <input
                    type="text"
                    value={syncFilter}
                    onChange={(e) => setSyncFilter(e.target.value)}
                    placeholder="搜索项目..."
                    className="w-full px-3 py-2 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary"
                  />

                  <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                    {filteredAliases.map((alias) => {
                      const checked = syncProjectsDraft.includes(alias);
                      return (
                        <label
                          key={alias}
                          className="flex items-center gap-2 py-2 px-3 rounded-lg bg-secondary/50 cursor-pointer hover:bg-secondary"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleDraftProject(alias)}
                            className="accent-primary"
                          />
                          <span className="text-sm">{alias}</span>
                        </label>
                      );
                    })}

                    {allProjectAliases.length === 0 && (
                      <p className="text-xs text-muted-foreground py-2">
                        暂无项目。请先执行一次同步或创建项目。
                      </p>
                    )}
                  </div>

                  <div className="text-xs text-muted-foreground">
                    已选择 {syncProjectsDraft.length} 个项目
                  </div>
                </>
              )}
            </div>

            <div className="px-5 py-4 border-t border-border flex items-center justify-end gap-2">
              <label className="mr-auto flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={!syncOnceNoRemember}
                  onChange={(e) => setSyncOnceNoRemember(!e.target.checked)}
                  className="accent-primary"
                />
                记住本次选择
              </label>
              <button
                className="px-3 py-2 text-sm rounded-lg border border-border hover:bg-secondary transition-colors"
                onClick={() => setShowSyncDialog(false)}
              >
                取消
              </button>
              <button
                className="px-3 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                disabled={isSyncing || (!syncAllDraft && syncProjectsDraft.length === 0)}
                onClick={confirmAndSync}
              >
                开始同步
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sync Progress */}
      {syncProgress && (
        <div className="bg-card rounded-xl border border-border p-4 shadow-sm transition-shadow hover:shadow-md">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">{syncProgress.stage}</span>
            <span className="text-xs text-muted-foreground">{syncProgress.progress}%</span>
          </div>
          <div className="w-full bg-secondary rounded-full h-1.5">
            <div
              className="bg-primary h-1.5 rounded-full transition-all duration-300"
              style={{ width: `${syncProgress.progress}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-2">{syncProgress.detail}</p>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border border-border p-4 shadow-sm transition-shadow hover:shadow-md">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <FolderOpen size={14} />
            <span className="text-xs font-medium">项目数</span>
          </div>
          <p className="text-2xl font-semibold">{projects.length}</p>
        </div>

        <div className="bg-card rounded-xl border border-border p-4 shadow-sm transition-shadow hover:shadow-md">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Lightbulb size={14} />
            <span className="text-xs font-medium">经验数</span>
          </div>
          <p className="text-2xl font-semibold">{expCount}</p>
        </div>

        <div className="bg-card rounded-xl border border-border p-4 shadow-sm transition-shadow hover:shadow-md">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Clock size={14} />
            <span className="text-xs font-medium">已检测工具</span>
          </div>
          <p className="text-2xl font-semibold">
            {detectedAgents.filter((a) => a.detected).length}
          </p>
        </div>

        <div className="bg-card rounded-xl border border-border p-4 shadow-sm transition-shadow hover:shadow-md">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <CheckCircle2 size={14} />
            <span className="text-xs font-medium">上次同步</span>
          </div>
          <p className="text-sm font-medium">
            {config.sync.lastSyncTimestamp
              ? new Date(config.sync.lastSyncTimestamp).toLocaleString()
              : "未同步"}
          </p>
        </div>
      </div>

      {/* Detected Agents */}
      <div className="bg-card rounded-xl border border-border p-4 shadow-sm transition-shadow hover:shadow-md">
        <h3 className="text-sm font-medium mb-3">已检测的AI工具</h3>
        <div className="space-y-2">
          {detectedAgents.map((agent) => (
            <div
              key={agent.id}
              className="flex items-center justify-between py-2 px-3 rounded-lg bg-secondary/50"
            >
              <span className="text-sm">{agent.name}</span>
              {agent.detected ? (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <CheckCircle2 size={12} />
                  已检测到
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <AlertCircle size={12} />
                  未安装
                </span>
              )}
            </div>
          ))}
          {detectedAgents.length === 0 && (
            <p className="text-sm text-muted-foreground">加载中...</p>
          )}
        </div>
      </div>

      {/* Project List */}
      <div className="bg-card rounded-xl border border-border p-4 shadow-sm transition-shadow hover:shadow-md">
        <h3 className="text-sm font-medium mb-3">已管理的项目</h3>
        <div className="space-y-2">
          {projects.map((project) => (
            <div
              key={project.alias}
              className="flex items-center justify-between py-2 px-3 rounded-lg bg-secondary/50 cursor-pointer hover:bg-secondary transition-colors"
              onClick={() => {
                useAppStore.getState().setSelectedProject(project.alias);
                useAppStore.getState().setActivePage("projects");
              }}
            >
              <div>
                <span className="text-sm font-medium">{project.alias}</span>
                <p className="text-xs text-muted-foreground">{project.path}</p>
              </div>
              {project.lastSync && (
                <span className="text-xs text-muted-foreground">
                  {new Date(project.lastSync).toLocaleDateString()}
                </span>
              )}
            </div>
          ))}
          {projects.length === 0 && (
            <p className="text-sm text-muted-foreground">
              暂无项目。点击"立即同步"开始提取记忆。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
