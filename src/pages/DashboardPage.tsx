import { useEffect, useState } from "react";
import { RefreshCw, FolderOpen, Clock, CheckCircle2, AlertCircle, Lightbulb, Workflow } from "lucide-react";
import { useAppStore } from "../store";
import { runSync } from "../core/sync";
import { listProjects, loadConfig, loadExperiences } from "../core/storage";
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
    setConfig,
  } = useAppStore();
  const [expCount, setExpCount] = useState(0);
  const [skillCount, setSkillCount] = useState(0);
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
        return;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Sync failed:", msg);
      setSyncProgress({ stage: "失败", detail: msg, progress: 0 });
      return;
    } finally {
      setIsSyncing(false);
      setSyncProgress(null);
    }
  };

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">概览</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            管理你的跨工具 AI 记忆
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

      <div className="grid grid-cols-5 gap-4">
        <StatCard icon={FolderOpen} label="项目数" value={String(projects.length)} />
        <StatCard icon={Lightbulb} label="经验数" value={String(expCount)} />
        <StatCard icon={Workflow} label="技能数" value={String(skillCount)} />
        <StatCard
          icon={Clock}
          label="已检测工具"
          value={String(detectedAgents.filter((a) => a.detected).length)}
        />
        <StatCard icon={CheckCircle2} label="上次同步" value={lastSyncLabel} compact />
      </div>

      <div className="bg-card rounded-xl border border-border p-4">
        <h3 className="text-sm font-medium mb-3">已检测的 AI 工具</h3>
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
              暂无项目。点击“立即同步”开始提取记忆。
            </p>
          )}
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
    <div className="bg-card rounded-xl border border-border p-4 min-w-0">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        <Icon size={14} />
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className={compact ? "text-sm font-medium break-words leading-5" : "text-2xl font-semibold"}>{value}</p>
    </div>
  );
}
