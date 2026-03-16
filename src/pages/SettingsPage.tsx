import { useEffect, useState } from "react";
import { Download, CheckCircle2 } from "lucide-react";
import { useAppStore } from "../store";
import { loadConfig, saveConfig } from "../core/storage";
import { installSkillToClaude, installSkillToCodex, isSkillInstalled } from "../core/installer";
import { detectAgents } from "../core/detector";
import { extractClaudeSessions, extractCodexSessions, groupByProject } from "../core/extractor";

export function SettingsPage() {
  const { config, setConfig, detectedAgents, setDetectedAgents } = useAppStore();
  const [skillStatus, setSkillStatus] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [detectedProjectAliases, setDetectedProjectAliases] = useState<string[]>([]);

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
      const [claudeSessions, codexSessions] = await Promise.all([
        extractClaudeSessions().catch(() => []),
        extractCodexSessions().catch(() => []),
      ]);
      const all = [...claudeSessions, ...codexSessions];
      const grouped = groupByProject(all);
      const aliases: string[] = [];
      for (const [, sessions] of grouped) {
        const name = sessions[0].projectName;
        const alias = name.toLowerCase().replace(/[^a-z0-9]/g, "_");
        if (!aliases.includes(alias)) aliases.push(alias);
      }
      setDetectedProjectAliases(aliases);
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
    let ok = false;
    if (tool === "claude") {
      ok = await installSkillToClaude();
    } else if (tool === "codex") {
      ok = await installSkillToCodex();
    }
    if (ok) {
      setSkillStatus((prev) => ({ ...prev, [tool]: true }));
    }
  };

  const toggleSyncProject = (alias: string) => {
    const current = config.syncProjects ?? [];
    const updated = current.includes(alias)
      ? current.filter((a) => a !== alias)
      : [...current, alias];
    setConfig({ ...config, syncProjects: updated });
  };

  const isSyncAll = !config.syncProjects || config.syncProjects.length === 0;

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
          选择需要同步的项目，不勾选则同步全部检测到的项目
        </p>

        <div className="space-y-1.5">
          <label className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-secondary/50 cursor-pointer hover:bg-secondary">
            <input
              type="checkbox"
              checked={isSyncAll}
              onChange={() => {
                if (isSyncAll) {
                  // Unchecking "all" → switch to selecting individual projects (start with all selected)
                  setConfig({ ...config, syncProjects: [...detectedProjectAliases] });
                } else {
                  // Checking "all" → clear the list (empty = all)
                  setConfig({ ...config, syncProjects: [] });
                }
              }}
              className="accent-primary"
            />
            <span className="text-sm font-medium">全部同步</span>
          </label>

          {detectedProjectAliases.map((alias) => (
            <label
              key={alias}
              className="flex items-center gap-2 py-1.5 px-3 rounded-lg bg-secondary/50 cursor-pointer hover:bg-secondary"
            >
              <input
                type="checkbox"
                checked={isSyncAll || (config.syncProjects ?? []).includes(alias)}
                disabled={isSyncAll}
                onChange={() => toggleSyncProject(alias)}
                className="accent-primary"
              />
              <span className="text-sm">{alias}</span>
            </label>
          ))}

          {detectedProjectAliases.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">
              未检测到项目，请先在概览页面执行一次同步
            </p>
          )}
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
          安装 /allmem 和 /allmem-undo skill 到你的AI工具中
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
                {skillStatus[agent.id] ? (
                  <span className="flex items-center gap-1 text-xs text-green-600">
                    <CheckCircle2 size={12} />
                    已安装
                  </span>
                ) : (
                  <button
                    onClick={() => handleInstallSkill(agent.id)}
                    className="flex items-center gap-1 text-xs text-primary hover:opacity-80"
                  >
                    <Download size={12} />
                    安装
                  </button>
                )}
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
