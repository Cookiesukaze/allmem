import { useEffect, useState } from "react";
import { RefreshCw, FolderOpen, Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { useAppStore } from "../store";
import { showToast } from "../components/Toast";
import { runSync } from "../core/sync";
import { listProjects, loadConfig, loadExperiences, saveSyncHistory } from "../core/storage";
import { detectAgents } from "../core/detector";

export function DashboardPage() {
  const {
    projects,
    setProjects,
    isSyncing,
    setIsSyncing,
    setSyncProgress,
    setLastSyncResults,
    detectedAgents,
    setDetectedAgents,
    setConfig,
  } = useAppStore();
  const [, setExpCount] = useState(0);
  const [, setSkillCount] = useState(0);
  const [lastSyncLabel, setLastSyncLabel] = useState("未同步");

  useEffect(() => {
    const loadInitialData = async () => {
      const [projectList, agents, config, experiences] = await Promise.all([
        listProjects(),
        detectAgents(),
        loadConfig(),
        loadExperiences(),
      ]);
      setProjects(projectList);
      setDetectedAgents(agents);
      setConfig(config);
      setExpCount(experiences.length);
      setSkillCount(experiences.filter((exp) => exp.kind === "skill").length);
      setLastSyncLabel(
        config.sync.lastSyncTimestamp
          ? new Date(config.sync.lastSyncTimestamp).toLocaleString()
          : "未同步"
      );
    };

    loadInitialData().catch(console.error);
  }, []);

  const handleSync = async () => {
    setIsSyncing(true);
    setSyncProgress({ stage: "开始", detail: "准备同步...", progress: 0 });

    try {
      const results = await runSync((progress) => {
        setSyncProgress(progress);
        if (progress.completedProject) {
          listProjects().then(setProjects).catch(console.error);
          loadExperiences()
            .then((exps) => {
              setExpCount(exps.length);
              setSkillCount(exps.filter((exp) => exp.kind === "skill").length);
            })
            .catch(console.error);
        }
      });
      setLastSyncResults(results);

      const [updatedProjects, updatedConfig, updatedExperiences] = await Promise.all([
        listProjects(),
        loadConfig(),
        loadExperiences(),
      ]);
      setProjects(updatedProjects);
      setConfig(updatedConfig);
      setExpCount(updatedExperiences.length);
      setSkillCount(updatedExperiences.filter((exp) => exp.kind === "skill").length);
      setLastSyncLabel(
        updatedConfig.sync.lastSyncTimestamp
          ? new Date(updatedConfig.sync.lastSyncTimestamp).toLocaleString()
          : "未同步"
      );

      const errors = results.flatMap((r) => r.errors);
      if (errors.length > 0) {
        setSyncProgress({ stage: "错误", detail: errors.join("; "), progress: 100 });
        showToast(`同步出错: ${errors.join("; ")}`, "error");
        await saveSyncHistory({
          timestamp: new Date().toISOString(),
          stage: "错误",
          detail: errors.join("; "),
          progress: 100,
          success: false,
        });
        return;
      }

      await saveSyncHistory({
        timestamp: new Date().toISOString(),
        stage: "完成",
        detail: `同步完成，更新了 ${results.reduce((sum, r) => sum + r.projectsUpdated, 0)} 个项目`,
        progress: 100,
        success: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Sync failed:", msg);
      setSyncProgress({ stage: "失败", detail: msg, progress: 0 });
      showToast(`同步失败: ${msg}`, "error");
      await saveSyncHistory({
        timestamp: new Date().toISOString(),
        stage: "失败",
        detail: msg,
        progress: 0,
        success: false,
      });
      return;
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">概览</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              管理你的跨工具 AI 记忆
            </p>
          </div>
          <button
            onClick={handleSync}
            disabled={isSyncing}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
            {isSyncing ? "同步中..." : "立即同步"}
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <StatCard icon={FolderOpen} label="项目数" value={String(projects.length)} />
          <StatCard
            icon={Clock}
            label="已检测工具"
            value={String(detectedAgents.filter((a) => a.detected).length)}
          />
          <StatCard icon={CheckCircle2} label="上次同步" value={lastSyncLabel} compact />
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">已检测的 AI 工具</h3>
          <div className="space-y-2">
            {detectedAgents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center justify-between rounded-lg bg-secondary/50 px-3 py-2"
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

        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="mb-3 text-sm font-medium">已管理的项目</h3>
          <div className="space-y-2">
            {projects.map((project) => (
              <div
                key={project.alias}
                className="cursor-pointer rounded-lg bg-secondary/50 px-3 py-2 transition-colors hover:bg-secondary"
                onClick={() => {
                  useAppStore.getState().setSelectedProject(project.alias);
                  useAppStore.getState().setActivePage("projects");
                }}
              >
                <div className="flex items-center justify-between gap-3">
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
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  compact = false,
}: {
  icon: typeof FolderOpen;
  label: string;
  value: string;
  compact?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card p-4">
      <div className="mb-2 flex items-center gap-2 text-muted-foreground">
        <Icon size={14} />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className={compact ? "break-words text-sm font-medium leading-5" : "text-2xl font-semibold"}>{value}</p>
    </div>
  );
}
