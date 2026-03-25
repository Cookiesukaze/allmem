import { useEffect, useMemo, useState } from "react";
import {
  RefreshCw,
  FolderOpen,
  Clock,
  CheckCircle2,
  AlertCircle,
  Lightbulb,
} from "lucide-react";
import { useAppStore } from "../store";
import { runSync } from "../core/sync";
import {
  listProjects,
  loadConfig,
  loadExperiences,
  saveConfig,
  saveScannedIndex,
} from "../core/storage";
import { detectAgents } from "../core/detector";
import { discoverProjects } from "../core/discovery";

const EDITOR_OPTIONS: Array<{ id: "claude" | "codex" | "cursor"; label: string }> = [
  { id: "claude", label: "Claude Code" },
  { id: "codex", label: "Codex CLI" },
  { id: "cursor", label: "Cursor IDE" },
];

function getSafeCardKey(card: {
  key?: string;
  alias: string;
  projectPath: string;
  cursorProjectId?: string;
}): string {
  if (card.key && card.key.trim()) return card.key;
  const normalizedPath = card.projectPath?.replace(/\//g, "\\").trim().toLowerCase();
  if (normalizedPath) return `path:${normalizedPath}`;
  if (card.cursorProjectId?.trim()) return `cursor:${card.cursorProjectId.trim()}`;
  return `alias:${card.alias}`;
}

type ScanProgress = {
  stage: string;
  percent: number;
  startedAt: number;
};

type StatusNotice = {
  kind: "success" | "warning" | "error" | "info";
  text: string;
};

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
    setScannedIndex,
    scannedProjectCards,
  } = useAppStore();

  const [expCount, setExpCount] = useState(0);
  const [isScanningProjects, setIsScanningProjects] = useState(false);
  const [scanHint, setScanHint] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [scanNotice, setScanNotice] = useState<StatusNotice | null>(null);
  const [syncNotice, setSyncNotice] = useState<StatusNotice | null>(null);

  const [selectedProjectKeys, setSelectedProjectKeys] = useState<string[]>([]);
  const [syncAllSelected, setSyncAllSelected] = useState(false);
  const [toolFilter, setToolFilter] = useState<"all" | "claude" | "codex" | "cursor">("all");
  const [page, setPage] = useState(1);
  const pageSize = 8;

  useEffect(() => {
    listProjects().then(setProjects).catch(console.error);
    detectAgents().then(setDetectedAgents).catch(console.error);
    loadConfig()
      .then((loaded) => {
        setConfig(loaded);
        setSelectedProjectKeys([]);
      })
      .catch(console.error);
    loadExperiences()
      .then((exps) => setExpCount(exps.length))
      .catch(console.error);
  }, []);

  const handleScanProjects = async () => {
    setIsScanningProjects(true);
    setScanHint(null);
    setScanNotice(null);
    const startedAt = Date.now();
    setScanProgress({ stage: "检测工具", percent: 10, startedAt });
    try {
      const agents = await detectAgents().catch(() => []);
      setScanProgress({ stage: "解析项目", percent: 45, startedAt });

      const enabledIds = (["claude", "codex", "cursor"] as const).filter((id) =>
        agents.some((a) => a.id === id && a.detected)
      );

      const index = await discoverProjects(enabledIds);
      setScanProgress({ stage: "保存结果", percent: 85, startedAt });

      setScannedIndex(index.cards);
      await saveScannedIndex(index);

      const validKeys = new Set(index.cards.map((c) => getSafeCardKey(c)));
      const preferredAliases = new Set(config.syncProjects ?? []);
      setSelectedProjectKeys((prev) => {
        const kept = prev.filter((key) => validKeys.has(key));
        const fromAliasPreference: string[] = [];
        for (const c of index.cards) {
          if (!preferredAliases.has(c.alias)) continue;
          fromAliasPreference.push(getSafeCardKey(c));
        }
        return Array.from(new Set([...kept, ...fromAliasPreference]));
      });
      setSyncAllSelected(false);
      setToolFilter("all");
      setPage(1);

      if (index.cards.length === 0) {
        const detected = agents.filter((a) => a.detected).map((a) => a.name);
        setScanHint(
          detected.length === 0
            ? "未检测到任何工具（Claude/Codex/Cursor）。请先安装并确保它们已生成会话记录。"
            : "解析完成但未发现可同步项目（transcript 解析结果为空）。"
        );
      }

      setScanProgress({ stage: "扫描完成", percent: 100, startedAt });
      const costSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      setScanNotice({
        kind: "success",
        text: `扫描完成：发现 ${index.cards.length} 个项目，用时 ${costSec}s。`,
      });
      setTimeout(() => setScanProgress(null), 1200);
    } catch (err) {
      console.error("[scan-dashboard] failed:", err);
      setScannedIndex([]);
      setSelectedProjectKeys([]);
      setSyncAllSelected(false);
      setScanHint("扫描失败：请查看控制台错误信息。");
      setScanNotice({ kind: "error", text: "扫描失败：请查看控制台错误信息。" });
      setScanProgress(null);
    } finally {
      setIsScanningProjects(false);
    }
  };

  const toggleSelectedProject = (projectKey: string) => {
    setSelectedProjectKeys((prev) =>
      prev.includes(projectKey) ? prev.filter((a) => a !== projectKey) : [...prev, projectKey]
    );
  };

  const handleSync = async (
    targetProjects?: string[],
    targetAgents?: string[],
    targetProjectPaths?: string[]
  ) => {
    setIsSyncing(true);
    setSyncProgress({ stage: "开始", detail: "准备同步...", progress: 0 });
    setSyncNotice(null);

    try {
      const results = await runSync(
        (progress) => {
          setSyncProgress(progress);
          if (progress.completedProject) {
            listProjects().then(setProjects).catch(console.error);
            loadExperiences()
              .then((exps) => setExpCount(exps.length))
              .catch(console.error);
          }
        },
        false,
        targetProjects,
        targetAgents,
        targetProjectPaths
      );
      setLastSyncResults(results);

      const updated = await listProjects();
      setProjects(updated);
      const updatedConfig = await loadConfig();
      setConfig(updatedConfig);
      loadExperiences()
        .then((exps) => setExpCount(exps.length))
        .catch(console.error);

      const errors = results.flatMap((r) => r.errors);
      const updatedCount = Math.max(0, ...results.map((r) => r.projectsUpdated || 0));
      if (errors.length > 0) {
        setSyncProgress({ stage: "错误", detail: errors.join("; "), progress: 100 });
        setSyncNotice({
          kind: "warning",
          text: `同步完成，但有 ${errors.length} 个错误。已更新 ${updatedCount} 个项目。`,
        });
        return;
      }
      setSyncNotice({
        kind: "success",
        text: `同步完成：已更新 ${updatedCount} 个项目。`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("Sync failed:", msg);
      setSyncProgress({ stage: "失败", detail: msg, progress: 0 });
      setSyncNotice({ kind: "error", text: `同步失败：${msg}` });
      return;
    } finally {
      setIsSyncing(false);
      setSyncProgress(null);
    }
  };

  const normalizedCards = useMemo(
    () =>
      scannedProjectCards
        .map((c) => ({ ...c, key: getSafeCardKey(c) }))
        .sort((a, b) => a.alias.localeCompare(b.alias)),
    [scannedProjectCards]
  );

  const filteredCards = useMemo(
    () =>
      toolFilter === "all"
        ? normalizedCards
        : normalizedCards.filter((c) => c.ides.includes(toolFilter)),
    [normalizedCards, toolFilter]
  );

  const pageCount = Math.max(1, Math.ceil(filteredCards.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageStart = (safePage - 1) * pageSize;
  const currentPageCards = filteredCards.slice(pageStart, pageStart + pageSize);

  const selectedCards = useMemo(
    () => normalizedCards.filter((c) => selectedProjectKeys.includes(c.key)),
    [normalizedCards, selectedProjectKeys]
  );

  const scanElapsedMs = scanProgress ? Date.now() - scanProgress.startedAt : 0;
  const scanElapsedSec = (scanElapsedMs / 1000).toFixed(1);
  const selectedEditors = useMemo(
    () => Array.from(new Set(selectedCards.flatMap((c) => c.ides))).sort(),
    [selectedCards]
  );
  const selectedPreview = useMemo(
    () => selectedCards.slice(0, 3).map((c) => c.displayName).join("、"),
    [selectedCards]
  );

  useEffect(() => {
    setPage(1);
  }, [toolFilter]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

  const toggleCurrentPage = (checked: boolean) => {
    const pageKeys = currentPageCards.map((c) => c.key);
    setSelectedProjectKeys((prev) => {
      if (checked) return Array.from(new Set([...prev, ...pageKeys]));
      const rm = new Set(pageKeys);
      return prev.filter((k) => !rm.has(k));
    });
  };

  const submitSelectedProjects = async () => {
    let targetProjects: string[];
    let targetAgents: string[];
    let targetProjectPaths: string[];

    if (syncAllSelected) {
      targetProjects = Array.from(new Set(normalizedCards.map((c) => c.alias))).sort();
      targetAgents = Array.from(new Set(normalizedCards.flatMap((c) => c.ides))).sort();
      targetProjectPaths = Array.from(
        new Set(normalizedCards.map((c) => c.projectPath).filter(Boolean))
      ).sort();
    } else {
      targetProjects = Array.from(new Set(selectedCards.map((c) => c.alias))).sort();
      targetAgents = Array.from(new Set(selectedCards.flatMap((c) => c.ides))).sort();
      targetProjectPaths = Array.from(
        new Set(selectedCards.map((c) => c.projectPath).filter(Boolean))
      ).sort();
    }

    if (
      (targetProjects.length === 0 && targetProjectPaths.length === 0) ||
      targetAgents.length === 0
    ) {
      return;
    }

    const nextConfig = {
      ...config,
      syncAll: false,
      syncProjects: targetProjects,
      agents: targetAgents,
    };
    setConfig(nextConfig);
    await saveConfig(nextConfig);

    await handleSync(targetProjects, targetAgents, targetProjectPaths);
  };

  const submitDisabled =
    isSyncing ||
    normalizedCards.length === 0 ||
    (!syncAllSelected && selectedCards.length === 0);

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">概览</h1>
          <p className="text-sm text-muted-foreground mt-0.5">管理你的跨工具 AI 记忆</p>
        </div>
        <button
          onClick={() => void handleScanProjects()}
          disabled={isScanningProjects || isSyncing}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          <RefreshCw size={14} className={isScanningProjects ? "animate-spin" : ""} />
          {isScanningProjects ? "扫描中..." : "扫描项目"}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border border-border p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">扫描状态</span>
            <span className="text-xs text-muted-foreground">
              {isScanningProjects && scanProgress
                ? `${scanProgress.percent}% · ${scanElapsedSec}s`
                : "待命"}
            </span>
          </div>
          {isScanningProjects && scanProgress ? (
            <>
              <div className="w-full bg-secondary rounded-full h-1.5">
                <div
                  className="bg-primary h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${scanProgress.percent}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">当前阶段：{scanProgress.stage}</p>
            </>
          ) : (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {scanHint ?? "点击“扫描项目”后，会在此展示扫描进度与结果提示。"}
              </p>
              {scanNotice && (
                <p
                  className={`text-xs ${
                    scanNotice.kind === "success"
                      ? "text-green-600"
                      : scanNotice.kind === "error"
                        ? "text-red-600"
                        : "text-amber-600"
                  }`}
                >
                  {scanNotice.text}
                </p>
              )}
            </div>
          )}
        </div>

        <div className="bg-card rounded-xl border border-border p-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">同步状态</span>
            <span className="text-xs text-muted-foreground">
              {isSyncing && syncProgress ? `${syncProgress.progress}%` : "待命"}
            </span>
          </div>
          {isSyncing && syncProgress ? (
            <>
              <div className="w-full bg-secondary rounded-full h-1.5">
                <div
                  className="bg-primary h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${syncProgress.progress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {syncProgress.stage}：{syncProgress.detail}
              </p>
            </>
          ) : (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">
                {config.sync.lastSyncTimestamp
                  ? `上次同步：${new Date(config.sync.lastSyncTimestamp).toLocaleString()}`
                  : "尚未开始同步。请在下方表单提交后开始。"}
              </p>
              {syncNotice && (
                <p
                  className={`text-xs ${
                    syncNotice.kind === "success"
                      ? "text-green-600"
                      : syncNotice.kind === "error"
                        ? "text-red-600"
                        : "text-amber-600"
                  }`}
                >
                  {syncNotice.text}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

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
          <p className="text-2xl font-semibold">{detectedAgents.filter((a) => a.detected).length}</p>
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

      <div className="bg-card rounded-xl border border-border p-4 shadow-sm transition-shadow hover:shadow-md space-y-4">
        <div>
          <h3 className="text-sm font-medium">同步记忆表单</h3>
          <p className="text-xs text-muted-foreground mt-1">
            先扫描项目，再在下方按编辑器选择项目，最后提交同步。
          </p>
        </div>

        {scanHint && <p className="text-xs text-amber-600">{scanHint}</p>}
        {!scanHint && scannedProjectCards.length === 0 && (
          <p className="text-xs text-muted-foreground">暂无已扫描项目，请先点击“扫描项目”。</p>
        )}

        <label className="flex items-center gap-2 py-2 px-3 rounded-lg bg-secondary/40 cursor-pointer">
          <input
            type="checkbox"
            checked={syncAllSelected}
            onChange={(e) => setSyncAllSelected(e.target.checked)}
            className="accent-primary"
          />
          <span className="text-sm font-medium">全部同步（本次扫描结果）</span>
          <span className="text-xs text-muted-foreground">共 {normalizedCards.length} 个</span>
        </label>

        <div className="rounded-lg border border-border bg-secondary/30 px-3 py-2">
          <div className="text-xs text-muted-foreground">
            已选摘要：项目 {syncAllSelected ? normalizedCards.length : selectedCards.length} 个，
            编辑器 {syncAllSelected ? "自动" : selectedEditors.length} 个
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {syncAllSelected
              ? "已开启“全部同步”，将使用本次扫描的全部项目。"
              : selectedCards.length === 0
                ? "尚未选择项目。"
                : `示例：${selectedPreview}${selectedCards.length > 3 ? " 等" : ""}`}
          </div>
        </div>

        {!syncAllSelected && (
          <div className="space-y-3 border border-border rounded-lg p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                共 {filteredCards.length} 个项目，当前第 {safePage}/{pageCount} 页
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={toolFilter}
                  onChange={(e) => setToolFilter(e.target.value as "all" | "claude" | "codex" | "cursor")}
                  className="px-2 py-1 text-xs rounded border border-border bg-card"
                >
                  <option value="all">全部工具</option>
                  {EDITOR_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="px-2 py-1 text-xs rounded border border-border hover:bg-secondary"
                  onClick={() => toggleCurrentPage(true)}
                  disabled={currentPageCards.length === 0}
                >
                  全选本页
                </button>
                <button
                  type="button"
                  className="px-2 py-1 text-xs rounded border border-border hover:bg-secondary"
                  onClick={() => toggleCurrentPage(false)}
                  disabled={currentPageCards.length === 0}
                >
                  清空本页
                </button>
              </div>
            </div>

            {currentPageCards.length === 0 ? (
              <div className="text-xs text-muted-foreground py-2 px-3 rounded bg-secondary/40">
                当前筛选下暂无项目
              </div>
            ) : (
              <div className="space-y-1.5">
                {currentPageCards.map((c) => {
                  const checked = selectedProjectKeys.includes(c.key);
                  const tags = c.ides
                    .map((id) => EDITOR_OPTIONS.find((opt) => opt.id === id)?.label ?? id)
                    .join(" + ");
                  return (
                    <label
                      key={c.key}
                      className="flex items-start gap-2 py-2 px-3 rounded-lg bg-secondary/50 cursor-pointer hover:bg-secondary"
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSelectedProject(c.key)}
                        className="accent-primary mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium truncate">{c.displayName}</span>
                        <span className="block text-xs text-muted-foreground truncate">
                          {c.pathUnresolved
                            ? `路径未解析（对话里暂无绝对路径等线索）${c.cursorProjectId ? ` · ${c.cursorProjectId}` : ""}`
                            : c.projectPath || c.alias}
                        </span>
                        <span className="block text-[11px] text-muted-foreground mt-0.5">来源: {tags}</span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className="px-2 py-1 text-xs rounded border border-border hover:bg-secondary disabled:opacity-50"
                disabled={safePage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                上一页
              </button>
              <span className="text-xs text-muted-foreground">第 {safePage}/{pageCount} 页</span>
              <button
                type="button"
                className="px-2 py-1 text-xs rounded border border-border hover:bg-secondary disabled:opacity-50"
                disabled={safePage >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              >
                下一页
              </button>
            </div>
          </div>
        )}

        <div className="pt-2 border-t border-border flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {syncAllSelected ? `本次将同步全部 ${normalizedCards.length} 个项目` : `已选择 ${selectedCards.length} 个项目`}
          </div>
          <button
            className="px-3 py-2 text-sm rounded-lg bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
            disabled={submitDisabled}
            onClick={() => void submitSelectedProjects()}
          >
            {isSyncing ? "同步中..." : "提交并同步"}
          </button>
        </div>
      </div>

      <div className="bg-card rounded-xl border border-border p-4 shadow-sm transition-shadow hover:shadow-md">
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
          {detectedAgents.length === 0 && <p className="text-sm text-muted-foreground">加载中...</p>}
        </div>
      </div>
    </div>
  );
}
