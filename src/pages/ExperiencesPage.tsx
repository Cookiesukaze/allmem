import { useEffect, useState } from "react";
import { Lightbulb, Search, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { loadExperiences, saveExperiences } from "../core/storage";
import type { Experience } from "../core/types";

export function ExperiencesPage() {
  const [experiences, setExperiences] = useState<Experience[]>([]);
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [scopeFilter, setScopeFilter] = useState<"all" | "global" | "project">("all");

  useEffect(() => {
    loadExperiences().then(setExperiences).catch(console.error);
  }, []);

  const filtered = experiences
    .filter((exp) => {
      if (scopeFilter !== "all" && exp.scope !== scopeFilter) return false;
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        exp.title.toLowerCase().includes(q) ||
        exp.content.toLowerCase().includes(q) ||
        exp.tags.some((t) => t.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => b.confidence - a.confidence);

  const handleDelete = async (id: string) => {
    const updated = experiences.filter((e) => e.id !== id);
    await saveExperiences(updated, "手动删除经验");
    setExperiences(updated);
  };

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">经验库</h1>
          <p className="text-sm text-muted-foreground">
            从对话中蒸馏的可复用经验，共 {experiences.length} 条
          </p>
        </div>
      </div>

      {/* Search & Filter */}
      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索标题、内容或标签..."
            className="w-full pl-9 pr-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none focus:border-primary"
          />
        </div>
        <select
          value={scopeFilter}
          onChange={(e) => setScopeFilter(e.target.value as typeof scopeFilter)}
          className="px-3 py-1.5 text-sm bg-secondary rounded-lg border border-border outline-none"
        >
          <option value="all">全部</option>
          <option value="global">全局</option>
          <option value="project">项目</option>
        </select>
      </div>

      {/* Experience List */}
      <div className="space-y-2">
        {filtered.map((exp) => {
          const isExpanded = expandedId === exp.id;
          return (
            <div
              key={exp.id}
              className="bg-card rounded-xl border border-border p-4 hover:border-purple-500/30 transition-colors"
            >
              <div
                className="flex items-start justify-between cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : exp.id)}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Lightbulb size={14} className="text-purple-500 flex-shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <h3 className="text-sm font-medium truncate">{exp.title}</h3>
                    {!isExpanded && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                        {exp.content}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600">
                    confidence: {exp.confidence}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-muted-foreground">
                    {exp.scope === "global" ? "全局" : "项目"}
                  </span>
                  {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                </div>
              </div>

              {isExpanded && (
                <div className="mt-3 pt-3 border-t border-border space-y-2">
                  <p className="text-xs leading-relaxed">{exp.content}</p>

                  {exp.context && (
                    <div className="bg-secondary/50 rounded-lg p-2">
                      <p className="text-[10px] text-muted-foreground mb-0.5">背景</p>
                      <p className="text-xs text-muted-foreground">{exp.context}</p>
                    </div>
                  )}

                  <div className="flex items-center gap-1 flex-wrap">
                    {exp.tags.map((tag) => (
                      <span
                        key={tag}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-600"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <div className="flex items-center gap-3">
                      <span>来源: {exp.sources.map((s) => `${s.project}(${s.count}次)`).join(", ")}</span>
                      <span>创建: {new Date(exp.created).toLocaleDateString()}</span>
                      <span>更新: {new Date(exp.updated).toLocaleDateString()}</span>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`确定删除经验 "${exp.title}"？`)) {
                          handleDelete(exp.id);
                        }
                      }}
                      className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {filtered.length === 0 && (
          <div className="text-center py-12">
            <Lightbulb size={32} className="mx-auto text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              {experiences.length === 0
                ? "暂无经验。执行同步后，系统会自动从对话中蒸馏可复用经验。"
                : "没有匹配的经验。"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
