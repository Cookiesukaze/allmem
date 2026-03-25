import { useEffect, useRef, useState } from "react";
import { Send, Trash2 } from "lucide-react";
import { MarkdownView } from "../components/MarkdownView";
import { callLLM } from "../core/llm";
import {
  listProjects,
  loadProjectInstructions,
  loadProjectMemory,
  loadProjectObjects,
  loadProjectRecent,
  loadUserInstructions,
  loadUserMemory,
} from "../core/storage";
import type { ProjectMeta, ProjectObjects } from "../core/types";
import { useAppStore } from "../store";

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
    setSelectedProjects((prev) => (prev.includes(alias) ? prev.filter((item) => item !== alias) : [...prev, alias]));
  };

  const appendProjectContext = async (alias: string, contextParts: string[]) => {
    const [instructions, objects, recent, memory] = await Promise.all([
      loadProjectInstructions(alias),
      loadProjectObjects(alias),
      loadProjectRecent(alias),
      loadProjectMemory(alias),
    ]);

    if (instructions) {
      contextParts.push(`## ${alias} 手工补充\n${instructions}`);
    }
    if (objects) {
      contextParts.push(`## ${alias} 结构化记忆\n${formatProjectObjects(alias, objects)}`);
    } else if (memory) {
      contextParts.push(`## ${alias} 长期记忆\n${memory}`);
    }
    if (recent) {
      contextParts.push(`## ${alias} 近期动态\n${recent}`);
    }
  };

  const handleSend = async () => {
    const query = input.trim();
    if (!query || loading) return;

    addChatMessage({ role: "user", content: query });
    setInput("");
    setLoading(true);

    try {
      const contextParts: string[] = [];
      const userInstructions = await loadUserInstructions();
      const userProfile = await loadUserMemory();

      if (userInstructions) contextParts.push(`## 用户全局说明\n${userInstructions}`);
      if (userProfile) contextParts.push(`## 用户画像\n${userProfile}`);

      for (const alias of selectedProjects) {
        await appendProjectContext(alias, contextParts);
      }

      if (selectedProjects.length === 0) {
        for (const project of projects) {
          if (query.includes(project.alias) || (project.path && query.includes(project.path.split("/").pop() ?? ""))) {
            await appendProjectContext(project.alias, contextParts);
          }
        }
      }

      const systemPrompt = `你是 AllMem 记忆助手。你面对的是一个项目状态系统，而不是零碎摘要。

${contextParts.length > 0 ? `=== 记忆上下文 ===\n${contextParts.join("\n\n---\n\n")}` : "（暂无已加载的记忆上下文）"}

回答规则：
1. 优先依据结构化对象回答，不要优先复述长篇摘要。
2. 如果问题问当前推进，优先看 state 和 recent。
3. 如果问题问习惯、边界、协作方式，优先看 rules。
4. 如果问题问路径、命令、资料位置，优先看 resources。
5. 如果问题问过去发生过什么、为什么这么做，优先看 events。
6. 如果上下文里没有答案，就直接说不知道，不要编造。`;

      const response = await callLLM(
        [
          { role: "system", content: systemPrompt },
          ...chatMessages.slice(-6).map((message) => ({ role: message.role as "user" | "assistant", content: message.content })),
          { role: "user", content: query },
        ],
        config.llm
      );

      addChatMessage({ role: "assistant", content: response });
    } catch (error) {
      addChatMessage({ role: "assistant", content: `[错误] ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend().catch(console.error);
    }
  };

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <h1 className="text-xl font-semibold">对话</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">基于项目状态、规则、资料和事件回答问题</p>
        </div>
        <button onClick={clearChat} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
          <Trash2 size={12} />
          清空对话
        </button>
      </div>

      <div className="rounded-xl border border-border bg-card p-3 flex-shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">加载项目:</span>
          {projects.map((project) => (
            <button
              key={project.alias}
              onClick={() => toggleProject(project.alias)}
              className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${selectedProjects.includes(project.alias) ? "border-primary/30 bg-primary/10 font-medium text-primary" : "border-border text-muted-foreground hover:bg-secondary hover:border-primary/20"}`}
            >
              {project.alias}
            </button>
          ))}
          {projects.length === 0 && <span className="text-xs text-muted-foreground">暂无项目，请先同步</span>}
        </div>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {chatMessages.length === 0 && (
            <div className="space-y-4 py-12 text-center">
              <p className="text-sm text-muted-foreground">还没有对话</p>
              <div className="mx-auto max-w-md space-y-2 text-xs text-muted-foreground">
                <p>选中项目后，可以直接问：</p>
                <div className="space-y-1.5 text-left">
                  <div className="rounded-lg bg-secondary/50 px-3 py-2 text-foreground">这个项目现在做到哪了？下一步是什么？</div>
                  <div className="rounded-lg bg-secondary/50 px-3 py-2 text-foreground">这个项目有哪些长期规则和协作习惯？</div>
                  <div className="rounded-lg bg-secondary/50 px-3 py-2 text-foreground">这个问题之前有没有处理过？当时是怎么解决的？</div>
                </div>
              </div>
            </div>
          )}

          {chatMessages.map((message, index) => (
            <div key={index} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-xl px-4 py-3 text-sm ${message.role === "user" ? "bg-primary text-primary-foreground" : "border border-border bg-secondary/70"}`}>
                {message.role === "user" ? <p className="whitespace-pre-wrap leading-relaxed">{message.content}</p> : <MarkdownView content={message.content} />}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="rounded-xl border border-border bg-secondary/70 px-4 py-3 text-sm text-muted-foreground">思考中...</div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        <div className="border-t border-border p-3">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入问题... (Enter 发送, Shift+Enter 换行)"
              rows={1}
              className="flex-1 resize-none rounded-xl border border-border bg-secondary px-4 py-2.5 text-sm outline-none focus:border-primary"
            />
            <button onClick={() => handleSend().catch(console.error)} disabled={!input.trim() || loading} className="rounded-xl bg-primary px-4 py-2.5 text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50">
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatProjectObjects(alias: string, objects: ProjectObjects): string {
  const state = [
    `- goal: ${objects.state.goal || "无"}`,
    `- current status: ${objects.state.currentStatus || "无"}`,
    `- current focus: ${objects.state.currentFocus || "无"}`,
    `- next steps: ${objects.state.nextSteps.length > 0 ? objects.state.nextSteps.join("；") : "无"}`,
    `- risks: ${objects.state.risks.length > 0 ? objects.state.risks.join("；") : "无"}`,
  ].join("\n");

  const rules = objects.rules.slice(0, 8).map((rule) => `- ${rule.content}${rule.rationale ? `｜说明：${rule.rationale}` : ""}`).join("\n");
  const resources = objects.resources.slice(0, 10).map((resource) => `- [${resource.kind}] ${resource.label}: ${resource.value}${resource.note ? `｜说明：${resource.note}` : ""}`).join("\n");
  const events = objects.events.slice(0, 6).map((event) => `- ${event.time ? `[${event.time}] ` : ""}${event.title}｜背景：${event.background || "无"}｜触发：${event.trigger || "无"}｜结果：${event.result || "无"}${event.status ? `｜状态：${event.status}` : ""}${event.nextStep ? `｜下一步：${event.nextStep}` : ""}${event.lesson ? `｜结论：${event.lesson}` : ""}`).join("\n");

  return [
    `### ${alias} state`,
    state,
    `### ${alias} rules`,
    rules || "- 无",
    `### ${alias} resources`,
    resources || "- 无",
    `### ${alias} events`,
    events || "- 无",
  ].join("\n");
}


