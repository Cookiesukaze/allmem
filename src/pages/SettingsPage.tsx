import { useEffect, useState } from "react";
import { Download, CheckCircle2, RefreshCw, Trash2 } from "lucide-react";
import { useAppStore } from "../store";
import { loadConfig, saveConfig, listProjects } from "../core/storage";
import { installSkillToClaude, installSkillToCodex, isSkillInstalled, uninstallSkillFromClaude, uninstallSkillFromCodex } from "../core/installer";
import { detectAgents } from "../core/detector";
import { extractClaudeSessions, extractCodexSessions, groupByProject } from "../core/extractor";

export function SettingsPage() {
  const { config, setConfig, detectedAgents, setDetectedAgents } = useAppStore();
  const [skillStatus, setSkillStatus] = useState<Record<string, boolean>>({});
  const [installingSkill, setInstallingSkill] = useState<string | null>(null);
  const [uninstallingSkill, setUninstallingSkill] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [allProjectAliases, setAllProjectAliases] = useState<string[]>([]);

  useEffect(() => {
    loadConfig().then(setConfig).catch(console.error);
    detectAgents().then(setDetectedAgents).catch(console.error);
    checkSkillStatus();
    scanDetectedProjects();
  }, []);

  const checkSkillStatus = async () => {
    const claude = await isSkillInstalled("claude").catch(() => false);
    const codex = await isSkillInstalled("codex").catch(() => false);
    setSkillStatus({ claude, codex });
  };

  const scanDetectedProjects = async () => {
    try {
      // Get projects from conversation logs
      const [claudeSessions, codexSessions] = await Promise.all([
        extractClaudeSessions().catch(() => []),
        extractCodexSessions().catch(() => []),
      ]);
      const all = [...claudeSessions, ...codexSessions];
      const grouped = groupByProject(all);
      const aliases = new Set<string>();
      for (const [, sessions] of grouped) {
        const name = sessions[0].projectName;
        const alias = name.toLowerCase().replace(/[^a-z0-9]/g, "_");
        aliases.add(alias);
      }

      // Also include projects already in ~/.allmem/projects/
      const existingProjects = await listProjects().catch(() => []);
      for (const p of existingProjects) {
        aliases.add(p.alias);
      }

      setAllProjectAliases([...aliases].sort());
    } catch {
      // ignore
    }
  };

  const handleSave = async () => {
    setSaving(true);
    await saveConfig(config);
    setTimeout(() => setSaving(false), 1000);
  };

  const handleInstallSkill = async (tool: string) => {
    setInstallingSkill(tool);
    let ok = false;
    if (tool === "claude") {
      ok = await installSkillToClaude();
    } else if (tool === "codex") {
      ok = await installSkillToCodex();
    }
    if (ok) {
      setSkillStatus((prev) => ({ ...prev, [tool]: true }));
    }
    // Brief flash to show completion
    setTimeout(() => setInstallingSkill(null), 1000);
  };

  const handleUninstallSkill = async (tool: string) => {
    setUninstallingSkill(tool);
    let ok = false;
    if (tool === "claude") {
      ok = await uninstallSkillFromClaude();
    } else if (tool === "codex") {
      ok = await uninstallSkillFromCodex();
    }
    if (ok) {
      setSkillStatus((prev) => ({ ...prev, [tool]: false }));
    }
    setTimeout(() => setUninstallingSkill(null), 1000);
  };

  const toggleSyncProject = (alias: string) => {
    const current = config.syncProjects ?? [];
    const updated = current.includes(alias)
      ? current.filter((a) => a !== alias)
      : [...current, alias];
    setConfig({ ...config, syncAll: false, syncProjects: updated });
  };

  const isSyncAll = config.syncAll ?? true;

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <h1 className="text-xl font-semibold">设置</h1>

      {/* LLM Config */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-4">
        <h3 className="text-sm font-medium">LLM 配置</h3>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">API Base URL</label>
            <input
              type="text"
              value={config.llm.baseUrl}
              onChange={(e) =>
                setConfig({ ...config, llm: { ...config.llm, baseUrl: e.target.value } })
              }
              className="w-full px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">API Key</label>
            <input
              type="password"
              value={config.llm.apiKey}
              onChange={(e) =>
                setConfig({ ...config, llm: { ...config.llm, apiKey: e.target.value } })
              }
              className="w-full px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">模型</label>
            <input
              type="text"
              value={config.llm.model}
              onChange={(e) =>
                setConfig({ ...config, llm: { ...config.llm, model: e.target.value } })
              }
              className="w-full px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">主模型，用于因果链提取和经验蒸馏</p>
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">Curator 模型 (廉价模型)</label>
            <input
              type="text"
              value={config.llm.curatorModel ?? ""}
              onChange={(e) =>
                setConfig({ ...config, llm: { ...config.llm, curatorModel: e.target.value } })
              }
              placeholder="留空则与主模型相同"
              className="w-full px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">用于记忆压缩和摘要，可用更便宜的模型节省 token</p>
          </div>
        </div>
      </div>

      {/* Sync Config */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-4">
        <h3 className="text-sm font-medium">同步设置</h3>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">同步模式</p>
            <p className="text-xs text-muted-foreground">手动: 需要手动触发; 自动: 定时同步</p>
          </div>
          <select
            value={config.sync.mode}
            onChange={(e) =>
              setConfig({
                ...config,
                sync: { ...config.sync, mode: e.target.value as "manual" | "auto" },
              })
            }
            className="px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none"
          >
            <option value="manual">手动</option>
            <option value="auto">自动</option>
          </select>
        </div>

        {config.sync.mode === "auto" && (
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              同步间隔（分钟）
            </label>
            <input
              type="number"
              value={config.sync.intervalMinutes}
              onChange={(e) =>
                setConfig({
                  ...config,
                  sync: { ...config.sync, intervalMinutes: parseInt(e.target.value) || 30 },
                })
              }
              className="w-32 px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary"
            />
          </div>
        )}

        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              最大对话轮次
            </label>
            <input
              type="number"
              value={config.sync.maxTurns ?? 80}
              onChange={(e) =>
                setConfig({
                  ...config,
                  sync: { ...config.sync, maxTurns: parseInt(e.target.value) || 80 },
                })
              }
              className="w-full px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">每个项目取最近N轮对话</p>
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              单轮最大字符数
            </label>
            <input
              type="number"
              value={config.sync.maxCharsPerTurn ?? 800}
              onChange={(e) =>
                setConfig({
                  ...config,
                  sync: { ...config.sync, maxCharsPerTurn: parseInt(e.target.value) || 800 },
                })
              }
              className="w-full px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">超过则截断，节省token</p>
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              压缩阈值
            </label>
            <input
              type="number"
              value={config.sync.compactionThreshold ?? 10}
              onChange={(e) =>
                setConfig({
                  ...config,
                  sync: { ...config.sync, compactionThreshold: parseInt(e.target.value) || 10 },
                })
              }
              className="w-full px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">近期记录攒够N条后压缩</p>
          </div>
        </div>
      </div>

      {/* Project Sync Selection */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-4">
        <h3 className="text-sm font-medium">同步项目选择</h3>
        <p className="text-xs text-muted-foreground">
          勾选"全部同步"会同步所有检测到的项目；取消后可单独选择
        </p>

        <div className="space-y-1.5">
          <label className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-secondary/50 cursor-pointer hover:bg-secondary">
            <input
              type="checkbox"
              checked={isSyncAll}
              onChange={(e) => {
                if (e.target.checked) {
                  setConfig({ ...config, syncAll: true, syncProjects: [] });
                } else {
                  // Switch to manual selection, start with all selected
                  setConfig({ ...config, syncAll: false, syncProjects: [...allProjectAliases] });
                }
              }}
              className="accent-primary"
            />
            <span className="text-sm font-medium">全部同步</span>
          </label>

          {!isSyncAll && allProjectAliases.map((alias) => (
            <label
              key={alias}
              className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-secondary/50 cursor-pointer hover:bg-secondary"
            >
              <input
                type="checkbox"
                checked={(config.syncProjects ?? []).includes(alias)}
                onChange={() => toggleSyncProject(alias)}
                className="accent-primary"
              />
              <span className="text-sm">{alias}</span>
            </label>
          ))}

          {isSyncAll && allProjectAliases.length > 0 && (
            <div className="px-3 py-1.5">
              <p className="text-xs text-muted-foreground">
                当前将同步所有 {allProjectAliases.length} 个项目：{allProjectAliases.join("、")}
              </p>
            </div>
          )}

          {allProjectAliases.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">
              未检测到项目，请先在概览页面执行一次同步
            </p>
          )}
        </div>
      </div>

      {/* Experience Distiller */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">经验蒸馏</h3>
            <p className="text-xs text-muted-foreground">
              同步时自动从因果链中提取可复用经验（实验性功能，会额外消耗 LLM token）
            </p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={config.enableDistiller ?? false}
              onChange={(e) =>
                setConfig({ ...config, enableDistiller: e.target.checked })
              }
              className="accent-primary"
            />
            <span className="text-xs">启用</span>
          </label>
        </div>
      </div>

      {/* Privacy Protection */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium">隐私保护</h3>
            <p className="text-xs text-muted-foreground">
              同步时自动屏蔽敏感信息，防止真实姓名、手机号等泄露到记忆中
            </p>
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={config.privacy?.enabled ?? false}
              onChange={(e) =>
                setConfig({
                  ...config,
                  privacy: { ...config.privacy, enabled: e.target.checked },
                })
              }
              className="accent-primary"
            />
            <span className="text-xs">启用</span>
          </label>
        </div>

        {config.privacy?.enabled && (
          <>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                替换为
              </label>
              <input
                type="text"
                value={config.privacy?.replacement ?? "[***]"}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    privacy: { ...config.privacy, replacement: e.target.value },
                  })
                }
                className="w-40 px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                敏感词列表（每行一个）
              </label>
              <textarea
                value={(config.privacy?.sensitiveWords ?? []).join("\n")}
                onChange={(e) =>
                  setConfig({
                    ...config,
                    privacy: {
                      ...config.privacy,
                      sensitiveWords: e.target.value.split("\n").filter((s) => s.trim()),
                    },
                  })
                }
                rows={5}
                placeholder={"张三\n13812345678\nzhangsan@email.com\n某某大学"}
                className="w-full px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary resize-none font-mono"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                这些词会在发送给LLM之前和保存记忆时被替换为"{config.privacy?.replacement ?? "[***]"}"
              </p>
            </div>
          </>
        )}
      </div>

      {/* Skill Installation */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-4">
        <h3 className="text-sm font-medium">Skill 安装</h3>
        <p className="text-xs text-muted-foreground">
          安装 /allmem、/allmem-sync 和 /allmem-undo skill 到你的AI工具中
        </p>

        <div className="space-y-2">
          {detectedAgents
            .filter((a) => a.detected)
            .map((agent) => (
              <div
                key={agent.id}
                className="flex items-center justify-between py-2 px-3 rounded-lg bg-secondary/50"
              >
                <span className="text-sm">{agent.name}</span>
                <div className="flex items-center gap-2">
                  {skillStatus[agent.id] && installingSkill !== agent.id && uninstallingSkill !== agent.id && (
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <CheckCircle2 size={12} />
                      已安装
                    </span>
                  )}
                  {installingSkill === agent.id ? (
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <CheckCircle2 size={12} />
                      {skillStatus[agent.id] ? "已更新!" : "已安装!"}
                    </span>
                  ) : uninstallingSkill === agent.id ? (
                    <span className="flex items-center gap-1 text-xs text-red-500">
                      已卸载!
                    </span>
                  ) : (
                    <>
                      <button
                        onClick={() => handleInstallSkill(agent.id)}
                        className="flex items-center gap-1 text-xs text-primary hover:opacity-80"
                      >
                        {skillStatus[agent.id] ? (
                          <>
                            <RefreshCw size={12} />
                            重新安装
                          </>
                        ) : (
                          <>
                            <Download size={12} />
                            安装
                          </>
                        )}
                      </button>
                      {skillStatus[agent.id] && (
                        <button
                          onClick={() => handleUninstallSkill(agent.id)}
                          className="flex items-center gap-1 text-xs text-red-500 hover:opacity-80"
                        >
                          <Trash2 size={12} />
                          卸载
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>

      {/* Save */}
      <button
        onClick={handleSave}
        className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
      >
        {saving ? (
          <>
            <CheckCircle2 size={14} />
            已保存
          </>
        ) : (
          "保存设置"
        )}
      </button>
    </div>
  );
}
