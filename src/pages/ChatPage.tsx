import { useState, useRef, useEffect } from "react";
import { Send, Trash2 } from "lucide-react";
import { useAppStore } from "../store";
import { MarkdownView } from "../components/MarkdownView";
import { loadProjectMemory, loadProjectRecent, loadUserMemory, loadUserInstructions, loadProjectInstructions, listProjects } from "../core/storage";
import { callLLM } from "../core/llm";
import type { ProjectMeta } from "../core/types";

export function ChatPage() {
  const { config, chatMessages, addChatMessage, clearChat, chatLoading: loading, setChatLoading: setLoading } = useAppStore();
  const [input, setInput] = useState("");
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listProjects().then(setProjects).catch(console.error);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const toggleProject = (alias: string) => {
    setSelectedProjects((prev) =>
      prev.includes(alias) ? prev.filter((a) => a !== alias) : [...prev, alias]
    );
  };

  const handleSend = async () => {
    const query = input.trim();
    if (!query || loading) return;

    addChatMessage({ role: "user", content: query });
    setInput("");
    setLoading(true);

    try {
      const contextParts: string[] = [];

      // Load global user instructions
      const userInstructions = await loadUserInstructions();
      if (userInstructions) {
        contextParts.push(`## 用户全局说明\n${userInstructions}`);
      }

      const userProfile = await loadUserMemory();
      if (userProfile) {
        contextParts.push(`## 用户画像\n${userProfile}`);
      }

      for (const alias of selectedProjects) {
        const mem = await loadProjectMemory(alias);
        const recent = await loadProjectRecent(alias);
        const instr = await loadProjectInstructions(alias);
        if (instr) {
          contextParts.push(`## 项目说明: ${alias}\n${instr}`);
        }
        if (mem) {
          contextParts.push(`## 项目长期记忆: ${alias}\n${mem}`);
        }
        if (recent) {
          contextParts.push(`## 项目近期动态: ${alias}\n${recent}`);
        }
      }

      // Auto-detect project from query
      if (selectedProjects.length === 0) {
        for (const p of projects) {
          if (query.includes(p.alias) || (p.path && query.includes(p.path.split("/").pop() ?? ""))) {
            const mem = await loadProjectMemory(p.alias);
            const recent = await loadProjectRecent(p.alias);
            const instr = await loadProjectInstructions(p.alias);
            if (instr) {
              contextParts.push(`## 项目说明: ${p.alias}\n${instr}`);
            }
            if (mem) {
              contextParts.push(`## 项目长期记忆: ${p.alias}\n${mem}`);
            }
            if (recent) {
              contextParts.push(`## 项目近期动态: ${p.alias}\n${recent}`);
            }
          }
        }
      }

      const systemPrompt = `你是AllMem记忆助手。用户已积累了跨AI工具的项目记忆和个人画像。
根据以下记忆上下文，回答用户的问题。

${contextParts.length > 0 ? "=== 记忆上下文 ===\n" + contextParts.join("\n\n---\n\n") : "（暂无已加载的记忆上下文）"}

规则:
1. 基于记忆上下文回答，如果信息不在上下文中，如实告知
2. 如果用户要求生成初始记忆/上下文，整理出结构化的Markdown输出
3. 回答简洁有用`;

      const response = await callLLM(
        [
          { role: "system", content: systemPrompt },
          ...chatMessages.slice(-6).map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
          { role: "user" as const, content: query },
        ],
        config.llm
      );

      addChatMessage({ role: "assistant", content: response });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addChatMessage({ role: "assistant", content: `[错误] ${msg}` });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="p-6 flex flex-col h-full gap-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-semibold">对话</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            基于项目记忆回答问题、生成上下文
          </p>
        </div>
        <button
          onClick={clearChat}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <Trash2 size={12} />
          清空对话
        </button>
      </div>

      {/* Project Selection */}
      <div className="bg-card rounded-xl border border-border p-3 flex-shrink-0 shadow-sm transition-shadow hover:shadow-md">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">加载记忆:</span>
          {projects.map((p) => (
            <button
              key={p.alias}
              onClick={() => toggleProject(p.alias)}
              className={`px-2.5 py-1 text-xs rounded-lg border transition-colors ${
                selectedProjects.includes(p.alias)
                  ? "bg-primary/10 border-primary/30 text-primary font-medium"
                  : "border-border text-muted-foreground hover:border-primary/20 hover:bg-secondary"
              }`}
            >
              {p.alias}
            </button>
          ))}
          {projects.length === 0 && (
            <span className="text-xs text-muted-foreground">暂无项目，请先同步</span>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="bg-card rounded-xl border border-border flex-1 flex flex-col overflow-hidden shadow-sm transition-shadow hover:shadow-md">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {chatMessages.length === 0 && (
            <div className="text-center py-12 space-y-4">
              <p className="text-sm text-muted-foreground">还没有对话</p>
              <div className="space-y-2 text-xs text-muted-foreground max-w-sm mx-auto">
                <p>选择上方的项目标签加载记忆，然后试试:</p>
                <div className="space-y-1.5">
                  <div className="bg-secondary/50 rounded-lg px-3 py-2 text-foreground text-left">
                    "帮我总结一下 aipro 项目的当前状态"
                  </div>
                  <div className="bg-secondary/50 rounded-lg px-3 py-2 text-foreground text-left">
                    "给我生成这个项目的初始上下文，用于新对话"
                  </div>
                  <div className="bg-secondary/50 rounded-lg px-3 py-2 text-foreground text-left">
                    "我之前在哪个项目遇到了路径拼接的问题？"
                  </div>
                </div>
              </div>
            </div>
          )}

          {chatMessages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary/70 border border-border"
                }`}
              >
                {msg.role === "user" ? (
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                ) : (
                  <MarkdownView content={msg.content} />
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="bg-secondary/70 border border-border rounded-xl px-4 py-3 text-sm text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="animate-pulse">思考中</span>
                  <span className="animate-bounce" style={{ animationDelay: "0.1s" }}>.</span>
                  <span className="animate-bounce" style={{ animationDelay: "0.2s" }}>.</span>
                  <span className="animate-bounce" style={{ animationDelay: "0.3s" }}>.</span>
                </span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-3 border-t border-border">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入问题... (Enter 发送, Shift+Enter 换行)"
              rows={1}
              className="flex-1 px-4 py-2.5 text-sm bg-secondary rounded-xl border border-border outline-none focus:border-primary resize-none"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="px-4 py-2.5 bg-primary text-primary-foreground rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
