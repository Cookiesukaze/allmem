// LLM client: call ChatAnywhere API (gpt-4o-mini)

import type { AllMemConfig } from "./types";

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

/**
 * Extract structured information from raw conversation text
 */
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

/**
 * Extract user-level information from conversation
 */
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

/**
 * Generate a one-line summary for a memory version
 */
export async function generateVersionSummary(
  oldMemory: string | null,
  newMemory: string,
  config: AllMemConfig["llm"]
): Promise<string> {
  const prompt = oldMemory
    ? `旧版记忆:\n${oldMemory}\n\n新版记忆:\n${newMemory}\n\n用一句简短中文描述这次更新的主要变化（10字以内）。只输出这一句话，不要其他内容。`
    : `记忆内容:\n${newMemory}\n\n用一句简短中文描述这份记忆的主题（10字以内）。只输出这一句话，不要其他内容。`;

  return callLLM(
    [{ role: "user", content: prompt }],
    config
  );
}

/**
 * Lightweight: summarize a single conversation into 3-5 bullet points
 * Used for WAL-style incremental append to recent.md
 */
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

/**
 * Compaction: merge latest.md (long-term) + recent.md (accumulated WAL) into new latest.md
 * Only called when recent.md accumulates enough entries
 */
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

/**
 * Generate a short project description from conversation context
 */
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

  return callLLM(
    [{ role: "user", content: descPrompt }],
    config
  );
}
