// LLM client: OpenAI-compatible API

import type { AllMemConfig, Experience, ProjectObjects } from "./types";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export async function callLLM(
  messages: ChatMessage[],
  config: AllMemConfig["llm"]
): Promise<string> {
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.3,
      max_tokens: 4096,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM API error ${response.status}: ${body}`);
  }

  const data: ChatResponse = await response.json();
  return data.choices[0]?.message?.content ?? "";
}

export async function extractStructured(
  rawConversation: string,
  projectName: string,
  existingMemory: string | null,
  config: AllMemConfig["llm"]
): Promise<string> {
  const systemPrompt = `你是一个记忆整理助手。你的任务是从AI对话记录中提取结构化的项目记忆。

输出分为两大部分：「项目概况」是稳定不常变的信息，「最近动态」是近期对话中正在做的事。

输出格式（Markdown）:

# 项目概况

## 项目简介
- （项目是什么、目标、定位，2-3条）

## 技术栈与架构
- （语言、框架、关键依赖、部署方式）

## 关键决策
- （重要的技术选型、架构决策、方向变更）

## 经验教训
- （踩过的坑、解决的问题、有用的发现）

## 用户偏好（项目相关）
- （用户在这个项目中表现出的偏好、习惯）

# 最近动态

## 当前进展
- （最近几轮对话在做什么、完成了什么）

## 进行中的工作
- （正在实现/调试的功能、未完成的任务）

## 待办/下一步
- （明确提到的待办事项或计划）

规则:
1. 只提取有价值的信息，去掉闲聊和重复内容
2. 如果有已有记忆，合并新旧信息，去重，保留最新状态
3. 「项目概况」部分保持稳定，除非有根本性变化否则不大改
4. 「最近动态」部分反映最新对话内容，旧的已完成事项移除或归入概况
5. 矛盾信息以时间更近的为准
6. 保持简洁，每条一行`;

  const userPrompt = existingMemory
    ? `项目: ${projectName}\n\n已有记忆:\n${existingMemory}\n\n新对话记录:\n${rawConversation}\n\n请合并已有记忆和新对话中的信息，输出更新后的完整项目记忆。`
    : `项目: ${projectName}\n\n对话记录:\n${rawConversation}\n\n请从对话中提取结构化的项目记忆。`;

  return callLLM(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    config
  );
}

export async function extractUserInfo(
  rawConversation: string,
  existingProfile: string | null,
  config: AllMemConfig["llm"]
): Promise<string> {
  const systemPrompt = `你是一个用户画像整理助手。从AI对话中提取关于用户本人的信息（不是项目信息）。

输出格式（Markdown）:
## 身份
- （姓名、职业、学校、研究方向等）

## 技术栈
- （擅长的语言、框架、工具）

## 偏好
- （编码风格、沟通习惯、工具选择偏好）

## 设备环境
- （操作系统、开发环境、常用工具）

## 其他
- （任何其他有价值的个人信息）

规则:
1. 只提取关于用户本人的信息，不要项目细节
2. 合并已有画像和新发现，去重
3. 矛盾信息以时间更近的为准`;

  const userPrompt = existingProfile
    ? `已有用户画像:\n${existingProfile}\n\n新对话记录:\n${rawConversation}\n\n请合并输出更新后的用户画像。`
    : `对话记录:\n${rawConversation}\n\n请提取用户画像。`;

  return callLLM(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    config
  );
}

export async function generateVersionSummary(
  oldMemory: string | null,
  newMemory: string,
  config: AllMemConfig["llm"]
): Promise<string> {
  const prompt = oldMemory
    ? `旧版记忆:\n${oldMemory}\n\n新版记忆:\n${newMemory}\n\n用一句简短中文描述这次更新的主要变化（10字以内）。只输出这一句话，不要其他内容。`
    : `记忆内容:\n${newMemory}\n\n用一句简短中文描述这份记忆的主题（10字以内）。只输出这一句话，不要其他内容。`;

  return callLLM([{ role: "user", content: prompt }], config);
}

export async function summarizeSingleConversation(
  conversationText: string,
  projectName: string,
  config: AllMemConfig["llm"]
): Promise<string> {
  const systemPrompt = `你是一个对话摘要助手。用3-5条要点概括这段AI对话的核心内容。

格式要求：
- 每条一行，用 - 开头
- 重点记录：做了什么、遇到了什么问题、做了什么决策、下一步计划
- 不要废话，不要重复，不要格式标题
- 总共不超过200字`;

  const userPrompt = `项目: ${projectName}\n\n对话记录:\n${conversationText}\n\n请概括这段对话的核心内容。`;

  return callLLM(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    config
  );
}

export async function compactMemory(
  latestMemory: string | null,
  recentEntries: string,
  projectName: string,
  config: AllMemConfig["llm"]
): Promise<string> {
  const systemPrompt = `你是一个记忆整理助手。你需要将「长期记忆」和「近期动态记录」合并为一份完整的项目记忆。

输出格式（Markdown）:

# 项目概况

## 项目简介
- （项目是什么、目标、定位，2-3条）

## 技术栈与架构
- （语言、框架、关键依赖、部署方式）

## 关键决策
- （重要的技术选型、架构决策、方向变更）

## 经验教训
- （踩过的坑、解决的问题、有用的发现）

## 用户偏好（项目相关）
- （用户在这个项目中表现出的偏好、习惯）

# 最近动态

## 当前进展
- （最近几轮对话在做什么、完成了什么）

## 进行中的工作
- （正在实现/调试的功能、未完成的任务）

## 待办/下一步
- （明确提到的待办事项或计划）

规则:
1.「项目概况」保持稳定，只在有根本性变化时更新
2.「最近动态」从近期记录中提炼，已完成的旧事项可归入概况或删除
3. 去重、去过时信息，矛盾以更近的为准
4. 保持简洁，每条一行`;

  const userPrompt = latestMemory
    ? `项目: ${projectName}\n\n长期记忆:\n${latestMemory}\n\n近期动态记录:\n${recentEntries}\n\n请合并输出更新后的完整项目记忆。`
    : `项目: ${projectName}\n\n近期动态记录:\n${recentEntries}\n\n请整理为结构化的项目记忆。`;

  return callLLM(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    config
  );
}

export async function generateProjectDescription(
  rawConversation: string,
  projectName: string,
  config: AllMemConfig["llm"]
): Promise<string> {
  const descPrompt = `根据以下AI对话记录，生成这个项目的简短描述（3-5句话）。包含：
1. 项目是什么
2. 技术栈
3. 当前在做什么
4. 开发/运行环境

项目名: ${projectName}

对话摘要:
${rawConversation.slice(0, 3000)}

只输出描述，不要标题和格式符号。`;

  return callLLM([{ role: "user", content: descPrompt }], config);
}

export async function narrateCausalChains(
  conversationText: string,
  projectName: string,
  config: AllMemConfig["llm"]
): Promise<string> {
  const systemPrompt = `你是一个因果链叙事助手。你的任务是从AI对话记录中提取「因果链」——即 问题→尝试→结果 的完整故事。

输出格式（Markdown）:

对于对话中每一个有意义的问题/任务，提取一条因果链：

### [简短标题]
- **问题**: 用户遇到了什么问题 / 想做什么
- **尝试**: 做了哪些尝试（包括失败的，用"✗"标记失败，"✓"标记成功）
- **结果**: 最终怎么解决的 / 当前状态（已解决/未解决/搁置）
- **关键信息**: 涉及的技术细节、文件路径、配置项等

规则:
1. 每个因果链必须有完整的 问题→尝试→结果 结构，不要只列要点
2. 保留失败的尝试，这些往往更有价值
3. 包含具体的技术细节（错误信息、解决方案、代码片段关键部分）
4. 如果对话中没有明确的因果链（纯闲聊/简单问答），输出"无因果链"
5. 通常3-8个因果链，不超过10个
6. 每个因果链总共不超过150字`;

  const userPrompt = `项目: ${projectName}\n\n对话记录:\n${conversationText}\n\n请提取因果链。`;

  return callLLM(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    config
  );
}

export async function extractProjectObjects(
  projectName: string,
  memoryMarkdown: string | null,
  recentMarkdown: string | null,
  causalNarrative: string,
  config: AllMemConfig["llm"]
): Promise<ProjectObjects> {
  const systemPrompt = `你是一个项目记忆结构化助手。你的目标不是生成漂亮摘要，而是把项目记忆整理成真正可用的项目状态系统。

输出严格 JSON，不要 markdown 代码块，格式如下：
{
  "state": {
    "goal": "项目当前的核心目标",
    "currentStatus": "目前做到哪一步、整体状态如何",
    "currentFocus": "当前最重要的工作焦点",
    "nextSteps": ["下一步1", "下一步2"],
    "risks": ["风险1", "阻塞1"]
  },
  "rules": [
    { "content": "不要自动 push 到远程，除非用户明确确认", "rationale": "用户习惯/安全边界" }
  ],
  "resources": [
    { "label": "开发目录", "kind": "path", "value": "E:/Project3s/aipro/allmem", "note": "主工作目录" },
    { "label": "启动命令", "kind": "command", "value": "npm run dev", "note": "前端开发" },
    { "label": "关键说明文档", "kind": "doc", "value": "README.md", "note": "项目入口文档" }
  ],
  "events": [
    {
      "title": "把项目记忆模型改为 state/rules/resources/events",
      "trigger": "用户认为旧结构过碎、过虚",
      "actions": ["分析用户手工状态文档中的高价值信息", "删除中间层对象", "重写提取和展示逻辑"],
      "result": "项目对象更少，边界更清楚，更适合状态管理",
      "lesson": "项目记忆优先服务当前推进和可复用资料，而不是抽象分类",
      "refs": ["memo_sample/css_dev/state.txt", "allmem/src/core/types.ts"]
    }
  ]
}

对象定义：
1. state: 当前局面。它不是项目简介，而是“现在项目在干什么、接下来做什么、卡在哪”。goal / currentStatus / currentFocus 都要简短明确。
2. rules: 长期有效的规则、偏好、协作习惯、约束、红线。它们应该是以后还要继续记住的东西。
3. resources: 真正有用的路径、命令、URL、文档、环境信息。必须是未来会查、会用、会复用的资料。
4. events: 重要闭环事件。必须体现 触发 -> 处理 -> 结果，优先保留关键版本推进、重大问题修复、路线调整、重要错误与修正。

严格要求：
1. 不要提取低价值噪音，例如普通重启、一次性小报错、纯装饰改动、机械操作。
2. 要尽量捕捉用户习惯、重要路径、关键资料、重要错误、因果链和闭环结果。
3. 不要为了凑类别硬塞内容；没有就返回空字符串或空数组。
4. state 最多 5 个 nextSteps、5 个 risks；rules 最多 8 条；resources 最多 12 条；events 最多 8 条。
5. 输出必须可被 JSON.parse 直接解析。`;

  const userPrompt = `项目: ${projectName}

长期记忆:
${memoryMarkdown ?? "（暂无）"}

近期动态:
${recentMarkdown ?? "（暂无）"}

因果链:
${causalNarrative}

请输出结构化对象 JSON。`;

  const raw = await callLLM(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    config
  );

  try {
    const cleaned = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<ProjectObjects> & Record<string, unknown>;
    return normalizeExtractedProjectObjects(parsed);
  } catch {
    console.warn("[objects] Failed to parse LLM response as JSON:", raw);
    return createEmptyProjectObjects();
  }
}

export async function distillExperiences(
  causalNarrative: string,
  projectAlias: string,
  existingExperiences: Experience[],
  config: AllMemConfig["llm"]
): Promise<{ newExperiences: Omit<Experience, "id" | "created" | "updated" | "confidence" | "sources">[]; reinforced: string[] }> {
  const existingSummary = existingExperiences.length > 0
    ? existingExperiences.map((e) => `[${e.id}] ${e.title}: ${e.content} (标签: ${e.tags.join(",")})`).join("\n")
    : "（暂无已有经验）";

  const systemPrompt = `你是一个经验蒸馏专家。从因果链叙事中判断是否存在值得长期保留的高价值经验。

已有经验列表:
${existingSummary}

你需要输出严格的JSON（不要markdown代码块），格式如下:
{
  "new": [
    {
      "title": "一句话标题",
      "content": "2-3句描述，包含因果关系（因为X所以Y，解决方法是Z）",
      "context": "从什么场景学到的",
      "tags": ["标签1", "标签2"],
      "scope": "global"
    }
  ],
  "reinforced": ["exp-xxx", "exp-yyy"]
}

一条信息值得成为经验，当且仅当：
1. 高价值：它对应大版本推进、关键问题攻克或关键路线取舍，而不是零碎操作
2. 可迁移：换一个项目遇到类似场景仍然适用
3. 非显然：不是任何开发者都天然知道的常识
4. 有因果：不只是"做了X"，而是"因为Y所以应该做X"

不应该成为经验的：
- 项目特有的业务逻辑 → 这属于项目记忆
- 一次性的debug过程（端口冲突、重启服务、临时改路径等） → 没有迁移价值
- 常识性的东西或一条命令就能完成的简单动作 → AI本来就知道
- 纯事实记录 → 这是记忆不是经验

规则:
1. "new" 只包含已有经验中没有的全新经验
2. "reinforced" 列出已有经验中被这次因果链再次印证的经验ID
3. scope=global: 跨项目通用; scope=project: 仅限当前项目类型
4. 标签用英文小写，2-4个
5. 大多数对话不会产生新经验，这是正常的。如果没有值得记录的，返回 {"new": [], "reinforced": []}
6. 如果只是完成了简单操作、普通命令执行、常规重启，不要提取
7. 每次最多提取3条新经验`;

  const userPrompt = `项目: ${projectAlias}\n\n因果链:\n${causalNarrative}\n\n请提取可复用经验。`;

  const raw = await callLLM(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    config
  );

  try {
    const cleaned = raw.replace(/```json?\n?/g, "").replace(/```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return {
      newExperiences: parsed.new ?? [],
      reinforced: parsed.reinforced ?? [],
    };
  } catch {
    console.warn("[distiller] Failed to parse LLM response as JSON:", raw);
    return { newExperiences: [], reinforced: [] };
  }
}

export function mergeExperiences(
  existing: Experience[],
  distilled: { newExperiences: Omit<Experience, "id" | "created" | "updated" | "confidence" | "sources">[]; reinforced: string[] },
  projectAlias: string
): Experience[] {
  const now = new Date().toISOString();
  const updated = existing.map((e) => ({ ...e }));

  for (const id of distilled.reinforced) {
    const exp = updated.find((e) => e.id === id);
    if (exp) {
      exp.confidence += 1;
      exp.updated = now;
      const src = exp.sources.find((s) => s.project === projectAlias);
      if (src) {
        src.count++;
        src.lastSeen = now;
      } else {
        exp.sources.push({ project: projectAlias, count: 1, lastSeen: now });
      }
    }
  }

  for (const ne of distilled.newExperiences) {
    const id = `exp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    updated.push({
      id,
      title: ne.title,
      content: ne.content,
      context: ne.context,
      kind: ne.kind,
      tags: ne.tags ?? [],
      scope: (ne.scope as "global" | "project") ?? "global",
      sources: [{ project: projectAlias, count: 1, lastSeen: now }],
      confidence: 1,
      trigger: ne.trigger,
      steps: ne.steps,
      verification: ne.verification,
      whyItWorks: ne.whyItWorks,
      created: now,
      updated: now,
    });
  }

  return updated;
}

function createEmptyProjectObjects(): ProjectObjects {
  return {
    state: {
      goal: "",
      currentStatus: "",
      currentFocus: "",
      nextSteps: [],
      risks: [],
    },
    rules: [],
    resources: [],
    events: [],
    updatedAt: new Date().toISOString(),
  };
}

function normalizeExtractedProjectObjects(parsed: Partial<ProjectObjects> & Record<string, unknown>): ProjectObjects {
  const state = parsed.state as Partial<ProjectObjects["state"]> | undefined;
  const rules = Array.isArray(parsed.rules) ? parsed.rules : [];
  const resources = Array.isArray(parsed.resources) ? parsed.resources : [];
  const events = Array.isArray(parsed.events) ? parsed.events : [];

  return {
    state: {
      goal: typeof state?.goal === "string" ? state.goal.trim() : "",
      currentStatus: typeof state?.currentStatus === "string" ? state.currentStatus.trim() : "",
      currentFocus: typeof state?.currentFocus === "string" ? state.currentFocus.trim() : "",
      nextSteps: Array.isArray(state?.nextSteps)
        ? state.nextSteps.map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
        : [],
      risks: Array.isArray(state?.risks)
        ? state.risks.map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
        : [],
    },
    rules: rules
      .slice(0, 8)
      .map((rule, index) => {
        const candidate = rule as { content?: string; rationale?: string };
        return {
          id: `rule-${index + 1}`,
          content: (candidate.content ?? "").trim(),
          rationale: (candidate.rationale ?? "").trim() || undefined,
        };
      })
      .filter((rule) => rule.content.length > 0),
    resources: resources
      .slice(0, 12)
      .map((resource, index) => {
        const candidate = resource as { label?: string; kind?: string; value?: string; note?: string };
        return {
          id: `resource-${index + 1}`,
          label: (candidate.label ?? "").trim(),
          kind: normalizeResourceKind(candidate.kind),
          value: (candidate.value ?? "").trim(),
          note: (candidate.note ?? "").trim() || undefined,
        };
      })
      .filter((resource) => resource.label.length > 0 && resource.value.length > 0),
    events: events
      .slice(0, 8)
      .map((event, index) => {
        const candidate = event as {
          title?: string;
          trigger?: string;
          actions?: string[];
          result?: string;
          lesson?: string;
          refs?: string[];
        };
        return {
          id: `event-${index + 1}`,
          title: (candidate.title ?? "").trim(),
          trigger: (candidate.trigger ?? "").trim(),
          actions: Array.isArray(candidate.actions)
            ? candidate.actions.map((item) => String(item).trim()).filter(Boolean).slice(0, 6)
            : [],
          result: (candidate.result ?? "").trim(),
          lesson: (candidate.lesson ?? "").trim() || undefined,
          refs: Array.isArray(candidate.refs)
            ? candidate.refs.map((item) => String(item).trim()).filter(Boolean).slice(0, 6)
            : [],
        };
      })
      .filter((event) => event.title.length > 0 || event.result.length > 0),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeResourceKind(kind: unknown): ProjectObjects["resources"][number]["kind"] {
  return kind === "path" || kind === "command" || kind === "url" || kind === "doc" || kind === "env"
    ? kind
    : "doc";
}
