import { useEffect, useMemo, useState } from "react";
import {
  Lightbulb,
  Search,
  Trash2,
  ChevronDown,
  ChevronUp,
  Wrench,
  Wand2,
  Save,
  Undo2,
} from "lucide-react";
import { confirm as confirmDialog } from "@tauri-apps/plugin-dialog";
import { loadExperiences, saveExperiences } from "../core/storage";
import type { Experience } from "../core/types";

type KindFilter = "all" | "experience" | "skill";

interface SkillDraft {
  trigger: string;
  steps: string;
  verification: string;
  whyItWorks: string;
}

export function ExperiencesPage() {
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<"all" | "global" | "project">("all");
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [skillDraft, setSkillDraft] = useState<SkillDraft>({
    trigger: "",
    steps: "",
    verification: "",
    whyItWorks: "",
  });
  const confirmDanger = (message: string) => confirmDialog(message);

  useEffect(() => {
    loadExperiences().then(setExperiences).catch(console.error);
  }, []);

  const stats = useMemo(() => {
    const skillCount = experiences.filter((exp) => exp.kind === "skill").length;
    return {
      total: experiences.length,
      skillCount,
      experienceCount: experiences.length - skillCount,
    };
  }, [experiences]);

  const filtered = experiences
    .filter((exp) => {
      const kind = exp.kind ?? "experience";
      if (scopeFilter !== "all" && exp.scope !== scopeFilter) return false;
      if (kindFilter !== "all" && kind !== kindFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        exp.title.toLowerCase().includes(q) ||
        exp.content.toLowerCase().includes(q) ||
        exp.tags.some((t) => t.toLowerCase().includes(q)) ||
        exp.trigger?.toLowerCase().includes(q) ||
        exp.steps?.some((step) => step.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => {
      const kindA = a.kind ?? "experience";
      const kindB = b.kind ?? "experience";
      if (kindA !== kindB) return kindA === "skill" ? -1 : 1;
      return b.confidence - a.confidence;
    });

  const saveAll = async (updated: Experience[], summary: string) => {
    await saveExperiences(updated, summary);
    setExperiences(updated);
  };

  const handleDelete = async (id: string) => {
    await saveAll(experiences.filter((e) => e.id !== id), "手动删除经验或技能候选");
  };

  const handleStartPromote = (exp: Experience) => {
    setExpandedId(exp.id);
    setEditingSkillId(exp.id);
    setSkillDraft({
      trigger: exp.trigger ?? exp.context ?? exp.title,
      steps: (exp.steps ?? splitContentToSteps(exp.content)).join("\n"),
      verification: exp.verification ?? "",
      whyItWorks: exp.whyItWorks ?? exp.content,
    });
  };

  const handleSaveSkill = async (id: string) => {
    const updated = experiences.map((exp) => {
      if (exp.id !== id) return exp;
      return {
        ...exp,
        kind: "skill" as const,
        trigger: skillDraft.trigger.trim(),
        steps: skillDraft.steps
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
        verification: skillDraft.verification.trim(),
        whyItWorks: skillDraft.whyItWorks.trim(),
        updated: new Date().toISOString(),
      };
    });
    await saveAll(updated, "提升经验为技能候选");
    setEditingSkillId(null);
  };

  const handleDemote = async (id: string) => {
    const updated = experiences.map((exp) => {
      if (exp.id !== id) return exp;
      const { trigger, steps, verification, whyItWorks, ...rest } = exp;
      return {
        ...rest,
        kind: "experience" as const,
        updated: new Date().toISOString(),
      };
    });
    await saveAll(updated, "将技能候选还原为经验");
  };

  return (
    <div className="h-full overflow-y-auto p-6 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">经验与技能</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            这里只保留高价值沉淀：经验是大版本/关键问题/关键决策，技能候选是复杂且可复用的一整轮流程。
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <MiniStat label="全部" value={stats.total} />
          <MiniStat label="经验" value={stats.experienceCount} />
          <MiniStat label="技能候选" value={stats.skillCount} />
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索高价值经验、技能候选、触发条件或步骤..."
              className="w-full rounded-xl border border-border bg-secondary py-2 pl-9 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>
          <select
            value={scopeFilter}
            onChange={(e) => setScopeFilter(e.target.value as typeof scopeFilter)}
            className="rounded-xl border border-border bg-secondary px-3 py-2 text-sm outline-none"
          >
            <option value="all">全部范围</option>
            <option value="global">全局</option>
            <option value="project">项目</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          {(["all", "experience", "skill"] as KindFilter[]).map((value) => (
            <button
              key={value}
              onClick={() => setKindFilter(value)}
              className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                kindFilter === value
                  ? "bg-primary/10 text-primary"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              {value === "all" ? "全部" : value === "experience" ? "经验" : "技能候选"}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {filtered.map((exp) => {
          const kind = exp.kind ?? "experience";
          const isSkill = kind === "skill";
          const isExpanded = expandedId === exp.id;
          const isEditing = editingSkillId === exp.id;

          return (
            <div
              key={exp.id}
              className={`rounded-2xl border bg-card p-4 transition-colors ${
                isSkill ? "border-amber-500/30" : "border-border hover:border-primary/20"
              }`}
            >
              <div
                className="flex cursor-pointer items-start justify-between gap-4"
                onClick={() => setExpandedId(isExpanded ? null : exp.id)}
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className={`mt-0.5 rounded-xl p-2 ${isSkill ? "bg-amber-500/12 text-amber-700" : "bg-primary/10 text-primary"}`}>
                    {isSkill ? <Wrench size={15} /> : <Lightbulb size={15} />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
                      <h3 className="truncate text-sm font-medium">{exp.title}</h3>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${isSkill ? "bg-amber-500/12 text-amber-700" : "bg-primary/10 text-primary"}`}>
                        {isSkill ? "技能候选" : "经验"}
                      </span>
                    </div>
                    {!isExpanded && (
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{exp.content}</p>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground whitespace-nowrap">
                    confidence: {exp.confidence}
                  </span>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground whitespace-nowrap">
                    {exp.scope === "global" ? "全局" : "项目"}
                  </span>
                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              </div>

              {isExpanded && (
                <div className="mt-4 space-y-4 border-t border-border pt-4">
                  <div className="rounded-xl bg-secondary/40 p-3">
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">高价值摘要</div>
                    <p className="mt-1 text-sm leading-6">{exp.content}</p>
                  </div>

                  {exp.context && (
                    <div className="rounded-xl bg-secondary/40 p-3">
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">适用背景</div>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">{exp.context}</p>
                    </div>
                  )}

                  {isEditing ? (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-3">
                      <div>
                        <label className="text-[11px] text-muted-foreground">触发条件</label>
                        <input
                          value={skillDraft.trigger}
                          onChange={(e) => setSkillDraft((draft) => ({ ...draft, trigger: e.target.value }))}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-muted-foreground">步骤（每行一步）</label>
                        <textarea
                          value={skillDraft.steps}
                          onChange={(e) => setSkillDraft((draft) => ({ ...draft, steps: e.target.value }))}
                          rows={4}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-muted-foreground">验证方式</label>
                        <input
                          value={skillDraft.verification}
                          onChange={(e) => setSkillDraft((draft) => ({ ...draft, verification: e.target.value }))}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-muted-foreground">为什么有效</label>
                        <textarea
                          value={skillDraft.whyItWorks}
                          onChange={(e) => setSkillDraft((draft) => ({ ...draft, whyItWorks: e.target.value }))}
                          rows={3}
                          className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none"
                        />
                      </div>
                      <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
                        <button
                          onClick={() => handleSaveSkill(exp.id)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90"
                        >
                          <Save size={12} />
                          保存技能候选
                        </button>
                        <button
                          onClick={() => setEditingSkillId(null)}
                          className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs hover:bg-secondary"
                        >
                          <Undo2 size={12} />
                          取消
                        </button>
                      </div>
                    </div>
                  ) : isSkill ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">触发条件</div>
                        <p className="mt-1 text-xs leading-5">{exp.trigger || "未填写"}</p>
                      </div>
                      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">验证方式</div>
                        <p className="mt-1 text-xs leading-5">{exp.verification || "未填写"}</p>
                      </div>
                      <div className="col-span-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">步骤</div>
                        <div className="mt-2 space-y-2">
                          {(exp.steps ?? []).length > 0 ? (
                            (exp.steps ?? []).map((step, index) => (
                              <div key={`${exp.id}-${index}`} className="rounded-lg bg-background/80 px-3 py-2 text-xs leading-5">
                                <span className="mr-2 font-medium text-amber-700">{index + 1}.</span>
                                {step}
                              </div>
                            ))
                          ) : (
                            <p className="text-xs text-muted-foreground">还没有结构化步骤。</p>
                          )}
                        </div>
                      </div>
                      {exp.whyItWorks && (
                        <div className="col-span-2 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">为什么有效</div>
                          <p className="mt-1 text-xs leading-5">{exp.whyItWorks}</p>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="text-sm font-medium">把这条经验提升成技能候选</div>
                          <p className="mt-1 text-xs leading-5 text-muted-foreground">
                            如果这条经验已经具备明确触发条件和稳定做法，把它整理成 skill card 会更适合检索、展示和后续自动化。
                          </p>
                        </div>
                        <button
                          onClick={() => handleStartPromote(exp)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90"
                        >
                          <Wand2 size={12} />
                          提升为技能候选
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    {exp.tags.map((tag) => (
                      <span key={tag} className={`rounded-full px-2 py-1 text-[10px] ${isSkill ? "bg-amber-500/12 text-amber-700" : "bg-primary/10 text-primary"}`}>
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-3">
                      <span>来源: {exp.sources.map((s) => `${s.project}(${s.count}次)`).join(", ")}</span>
                      <span>创建: {new Date(exp.created).toLocaleDateString()}</span>
                      <span>更新: {new Date(exp.updated).toLocaleDateString()}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 whitespace-nowrap">
                      {isSkill && (
                        <button
                          onClick={() => handleDemote(exp.id)}
                          className="rounded-lg border border-border px-2 py-1 text-[11px] hover:bg-secondary"
                        >
                          还原为经验
                        </button>
                      )}
                      <button
                        onClick={async () => {
                          if (await confirmDanger(`确定删除 "${exp.title}"？`)) {
                            handleDelete(exp.id).catch(console.error);
                          }
                        }}
                        className="rounded-lg p-1 text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-500"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="rounded-2xl border border-border bg-card py-14 text-center">
            <Lightbulb size={32} className="mx-auto mb-3 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">
              {experiences.length === 0
                ? "暂无经验。执行同步后，系统会自动蒸馏经验；也可以先去概览页加载演示数据。"
                : "没有匹配的经验或技能候选。"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
    </div>
  );
}

function splitContentToSteps(content: string): string[] {
  return content
    .split(/[。；\n]/)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .slice(0, 5);
}



