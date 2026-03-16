import { useEffect } from "react";
import { RefreshCw, FolderOpen, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { useAppStore } from "../store";
import { runSync } from "../core/sync";
import { listProjects, loadConfig } from "../core/storage";
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

  useEffect(() => {
    // Load initial data
    listProjects().then(setProjects).catch(console.error);
    detectAgents().then(setDetectedAgents).catch(console.error);
    loadConfig().then(setConfig).catch(console.error);
  }, []);

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncProgress({ stage: "开始", detail: "准备同步...", progress: 0 });

    try {
      const results = await runSync((progress) => {
        setSyncProgress(progress);
      });
      setLastSyncResults(results);
      // Refresh project list
      const updated = await listProjects();
      setProjects(updated);
      // Refresh config to update lastSyncTimestamp
      const updatedConfig = await loadConfig();
      setConfig(updatedConfig);
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
          onClick={handleSync}
          disabled={isSyncing}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
          {isSyncing ? "同步中..." : "立即同步"}
        </button>
      </div>

      {/* Sync Progress */}
      {syncProgress && (
        <div className="bg-card rounded-xl border border-border p-4">
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
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <FolderOpen size={14} />
            <span className="text-xs font-medium">项目数</span>
          </div>
          <p className="text-2xl font-semibold">{projects.length}</p>
        </div>

        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-2 text-muted-foreground mb-2">
            <Clock size={14} />
            <span className="text-xs font-medium">已检测工具</span>
          </div>
          <p className="text-2xl font-semibold">
            {detectedAgents.filter((a) => a.detected).length}
          </p>
        </div>

        <div className="bg-card rounded-xl border border-border p-4">
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
      <div className="bg-card rounded-xl border border-border p-4">
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
      <div className="bg-card rounded-xl border border-border p-4">
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
