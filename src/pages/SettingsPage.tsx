import { useEffect, useMemo, useRef, useState } from "react";
import { Download, CheckCircle2, RefreshCw, Trash2 } from "lucide-react";
import { useAppStore } from "../store";
import { loadConfig, saveConfig } from "../core/storage";
import {
  installSkillToClaude,
  installSkillToCodex,
  installSkillToCursor,
  isSkillInstalled,
  uninstallSkillFromClaude,
  uninstallSkillFromCodex,
  uninstallSkillFromCursor,
} from "../core/installer";
import { detectAgents } from "../core/detector";

export function SettingsPage() {
  const {
    config,
    setConfig,
    setDetectedAgents,
    detectedAgents,
  } = useAppStore();
  const [skillStatus, setSkillStatus] = useState<Record<string, boolean>>({});
  const [installingSkill, setInstallingSkill] = useState<string | null>(null);
  const [uninstallingSkill, setUninstallingSkill] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [llmDirty, setLlmDirty] = useState(false);
  const [syncParamsDirty, setSyncParamsDirty] = useState(false);
  const [privacyDirty, setPrivacyDirty] = useState(false);

  const [showLLMSavedHint, setShowLLMSavedHint] = useState(false);
  const [showSyncParamsSavedHint, setShowSyncParamsSavedHint] = useState(false);
  const [showPrivacySavedHint, setShowPrivacySavedHint] = useState(false);

  const [skillToast, setSkillToast] = useState<{ tool: string; message: string } | null>(null);
  const skillToastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    loadConfig()
      .then((loaded) => {
        setConfig(loaded);
        setLlmDirty(false);
        setSyncParamsDirty(false);
        setPrivacyDirty(false);
        setShowLLMSavedHint(false);
        setShowSyncParamsSavedHint(false);
        setShowPrivacySavedHint(false);
      })
      .catch(console.error);
    detectAgents().then(setDetectedAgents).catch(console.error);
    checkSkillStatus();
  }, []);

  const detectedMap = useMemo(() => {
    const m: Record<string, boolean> = {};
    for (const a of detectedAgents) m[a.id] = a.detected;
    return m;
  }, [detectedAgents]);

  const detectionReady = detectedAgents.length > 0;

  useEffect(() => {
    return () => {
      if (skillToastTimerRef.current) {
        window.clearTimeout(skillToastTimerRef.current);
      }
    };
  }, []);

  const checkSkillStatus = async () => {
    const claude = await isSkillInstalled("claude").catch(() => false);
    const codex = await isSkillInstalled("codex").catch(() => false);
    const cursor = await isSkillInstalled("cursor").catch(() => false);
    setSkillStatus({ claude, codex, cursor });
  };

  const handleSave = async () => {
    const shouldShowLLMHint = llmDirty;
    const shouldShowSyncParamsHint = syncParamsDirty;
    const shouldShowPrivacyHint = privacyDirty;
    setSaving(true);
    await saveConfig(config);

    setLlmDirty(false);
    setSyncParamsDirty(false);
    setPrivacyDirty(false);
    if (shouldShowLLMHint) {
      setShowLLMSavedHint(true);
      setTimeout(() => setShowLLMSavedHint(false), 3000);
    }
    if (shouldShowSyncParamsHint) {
      setShowSyncParamsSavedHint(true);
      setTimeout(() => setShowSyncParamsSavedHint(false), 3000);
    }
    if (shouldShowPrivacyHint) {
      setShowPrivacySavedHint(true);
      setTimeout(() => setShowPrivacySavedHint(false), 3000);
    }
    setTimeout(() => setSaving(false), 1000);
  };

  const handleInstallSkill = async (tool: string) => {
    setInstallingSkill(tool);
    let ok = false;
    if (tool === "claude") {
      ok = await installSkillToClaude();
    } else if (tool === "codex") {
      ok = await installSkillToCodex();
    } else if (tool === "cursor") {
      ok = await installSkillToCursor();
    }
    if (ok) {
      const alreadyInstalled = !!skillStatus[tool];
      setSkillStatus((prev) => ({ ...prev, [tool]: true }));
      setSkillToast({
        tool,
        message:
          tool === "claude"
            ? alreadyInstalled
              ? "Claude skill 已更新!"
              : "Claude skill 已安装!"
            : tool === "codex"
              ? alreadyInstalled
                ? "Codex skill 已更新!"
                : "Codex skill 已安装!"
              : alreadyInstalled
                ? "Cursor skill 已更新!"
                : "Cursor skill 已安装!",
      });
      if (skillToastTimerRef.current) {
        window.clearTimeout(skillToastTimerRef.current);
      }
      skillToastTimerRef.current = window.setTimeout(() => setSkillToast(null), 2500);
      // Refresh from filesystem to ensure UI shows the correct "reinstall" state.
      await checkSkillStatus();
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
    } else if (tool === "cursor") {
      ok = await uninstallSkillFromCursor();
    }
    if (ok) {
      setSkillToast({
        tool,
        message:
          tool === "claude"
            ? "Claude skill 已卸载!"
            : tool === "codex"
              ? "Codex skill 已卸载!"
              : "Cursor skill 已卸载!",
      });
      if (skillToastTimerRef.current) {
        window.clearTimeout(skillToastTimerRef.current);
      }
      skillToastTimerRef.current = window.setTimeout(() => setSkillToast(null), 2500);
      // Refresh from filesystem to ensure UI shows correct status.
      await checkSkillStatus();
    }
    setTimeout(() => setUninstallingSkill(null), 1000);
  };

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      <h1 className="text-xl font-semibold">设置</h1>

      {/* LLM Config */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-4 relative">
        {llmDirty && (
          <div className="absolute top-3 right-3 flex items-center gap-2 text-amber-600">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span className="text-xs">有改动未保存</span>
          </div>
        )}
        <h3 className="text-sm font-medium">LLM 配置</h3>
        {showLLMSavedHint && (
          <p className="text-xs text-green-600/80">
            LLM 配置已更新，下次同步/注入会使用新配置。
          </p>
        )}

        <div className="space-y-3">
          <div>
            <label className="text-xs text-muted-foreground block mb-1">API Base URL</label>
            <input
              type="text"
              value={config.llm.baseUrl}
              onChange={(e) => {
                setConfig({ ...config, llm: { ...config.llm, baseUrl: e.target.value } });
                setLlmDirty(true);
                setShowLLMSavedHint(false);
              }}
              className="w-full px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">API Key</label>
            <input
              type="password"
              value={config.llm.apiKey}
              onChange={(e) => {
                setConfig({ ...config, llm: { ...config.llm, apiKey: e.target.value } });
                setLlmDirty(true);
                setShowLLMSavedHint(false);
              }}
              className="w-full px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary"
            />
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">模型</label>
            <input
              type="text"
              value={config.llm.model}
              onChange={(e) => {
                setConfig({ ...config, llm: { ...config.llm, model: e.target.value } });
                setLlmDirty(true);
                setShowLLMSavedHint(false);
              }}
              className="w-full px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">主模型，用于因果链提取和经验蒸馏</p>
          </div>

          <div>
            <label className="text-xs text-muted-foreground block mb-1">Curator 模型 (廉价模型)</label>
            <input
              type="text"
              value={config.llm.curatorModel ?? ""}
              onChange={(e) => {
                setConfig({ ...config, llm: { ...config.llm, curatorModel: e.target.value } });
                setLlmDirty(true);
                setShowLLMSavedHint(false);
              }}
              placeholder="留空则与主模型相同"
              className="w-full px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">用于记忆压缩和摘要，可用更便宜的模型节省 token</p>
          </div>
        </div>
      </div>

      {/* Sync Config */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-4 relative">
        {syncParamsDirty && (
          <div className="absolute top-3 right-3 flex items-center gap-2 text-amber-600">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span className="text-xs">有改动未保存</span>
          </div>
        )}
        <h3 className="text-sm font-medium">同步设置</h3>
        {showSyncParamsSavedHint && (
          <p className="text-xs text-green-600/80">
            同步参数已更新，下次同步会使用新参数。
          </p>
        )}

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm">同步模式</p>
            <p className="text-xs text-muted-foreground">手动: 需要手动触发; 自动: 定时同步</p>
          </div>
          <select
            value={config.sync.mode}
            onChange={(e) =>
              (setConfig({
                ...config,
                sync: { ...config.sync, mode: e.target.value as "manual" | "auto" },
              }),
              setSyncParamsDirty(true),
              setShowSyncParamsSavedHint(false))
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
                (setConfig({
                  ...config,
                  sync: { ...config.sync, intervalMinutes: parseInt(e.target.value) || 30 },
                }),
                setSyncParamsDirty(true),
                setShowSyncParamsSavedHint(false))
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
                (setConfig({
                  ...config,
                  sync: { ...config.sync, maxTurns: parseInt(e.target.value) || 80 },
                }),
                setSyncParamsDirty(true),
                setShowSyncParamsSavedHint(false))
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
                (setConfig({
                  ...config,
                  sync: { ...config.sync, maxCharsPerTurn: parseInt(e.target.value) || 800 },
                }),
                setSyncParamsDirty(true),
                setShowSyncParamsSavedHint(false))
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
                (setConfig({
                  ...config,
                  sync: { ...config.sync, compactionThreshold: parseInt(e.target.value) || 10 },
                }),
                setSyncParamsDirty(true),
                setShowSyncParamsSavedHint(false))
              }
              className="w-full px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary"
            />
            <p className="text-[10px] text-muted-foreground mt-0.5">近期记录攒够N条后压缩</p>
          </div>
        </div>
      </div>

      {/* Privacy Protection */}
      <div className="bg-card rounded-xl border border-border p-4 space-y-4 relative">
        {privacyDirty && (
          <div className="absolute top-3 right-3 flex items-center gap-2 text-amber-600">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            <span className="text-xs">有改动未保存</span>
          </div>
        )}
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
                (setConfig({
                  ...config,
                  privacy: { ...config.privacy, enabled: e.target.checked },
                }),
                setPrivacyDirty(true),
                setShowPrivacySavedHint(false))
              }
              className="accent-primary"
            />
            <span className="text-xs">启用</span>
          </label>
        </div>

        {showPrivacySavedHint && (
          <p className="text-xs text-green-600/80">
            隐私保护已更新，下次同步/保存会应用生效。
          </p>
        )}

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
                  (setConfig({
                    ...config,
                    privacy: { ...config.privacy, replacement: e.target.value },
                  }),
                  setPrivacyDirty(true),
                  setShowPrivacySavedHint(false))
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
                  (setConfig({
                    ...config,
                    privacy: {
                      ...config.privacy,
                      sensitiveWords: e.target.value.split("\n").filter((s) => s.trim()),
                    },
                  }),
                  setPrivacyDirty(true),
                  setShowPrivacySavedHint(false))
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
        {skillToast && (
          <p className="text-xs text-green-600/80">
            {skillToast.message}
          </p>
        )}

        <div className="space-y-2">
          {[
            { id: "claude", name: "Claude Code" },
            { id: "codex", name: "Codex CLI" },
            { id: "cursor", name: "Cursor IDE" },
          ].map((tool) => (
              <div
              key={tool.id}
                className="flex items-center justify-between py-2 px-3 rounded-lg bg-secondary/50"
              >
              <span className="text-sm">{tool.name}</span>
                <div className="flex items-center gap-2">
                {skillStatus[tool.id] &&
                  installingSkill !== tool.id &&
                  uninstallingSkill !== tool.id && (
                    <span className="flex items-center gap-1 text-xs text-green-600">
                      <CheckCircle2 size={12} />
                      已安装
                    </span>
                  )}
                {installingSkill === tool.id ? (
                    <span className="flex items-center gap-1 text-xs text-green-600">
                    <CheckCircle2 size={12} />
                    {skillStatus[tool.id] ? "已更新!" : "已安装!"}
                    </span>
                ) : uninstallingSkill === tool.id ? (
                    <span className="flex items-center gap-1 text-xs text-red-500">
                      已卸载!
                    </span>
                  ) : detectionReady && detectedMap[tool.id] === false ? (
                    <span className="flex items-center gap-1 text-xs text-amber-600">
                      {skillStatus[tool.id] ? "已安装（但未检测到工具）" : `未检测到工具（建议先安装/启动 ${tool.name}）`}
                    </span>
                  ) : (
                    <>
                      <button
                      onClick={() => handleInstallSkill(tool.id)}
                        className="flex items-center gap-1 text-xs text-primary hover:opacity-80"
                      >
                      {skillStatus[tool.id] ? (
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
                    {skillStatus[tool.id] && (
                        <button
                          onClick={() => handleUninstallSkill(tool.id)}
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
