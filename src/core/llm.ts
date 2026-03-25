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
  const systemPrompt = `你不是在写普通摘要，而是在提取“项目推进记录”。

请把这段对话压缩成 1-4 条高密度记录，每条都尽量像一个小型状态更新，优先体现时间、触发原因、采取动作、结果和下一步。

严格格式：
- 时间/阶段：...｜触发：...｜处理：...｜结果：...｜后续：...

规则：
1. 每条都必须包含“触发”和“处理”，如果能判断结果也必须写结果
2. 如果对话里没有明确日期，可以写“本轮同步”“近期”“当前阶段”等时间标记
3. 优先记录版本推进、路线调整、关键问题、资料路径、用户偏好、重要错误与修正
4. 对未闭环事项，结果写“未完成”或“待验证”，后续写明确下一步
5. 不要写闲聊、普通重启、一次性小报错、样式微调、机械操作
6. 总长度尽量控制在 280 字内，不要加标题`;

  const userPrompt = `项目: ${projectName}\n\n对话记录:\n${conversationText}\n\n请输出推进记录。`;

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
  const systemPrompt = `你是一个项目长期记忆整理助手。目标不是写好看的总结，而是把项目整理成“之后继续推进时真的有用的长期状态文档”。

输出格式（Markdown）必须严格使用下面结构：

# 项目总览

## 目标与定位
- 只保留稳定目标、任务边界、项目定位

## 稳定设定与约束
- 只保留长期有效的用户偏好、协作规则、稳定约束、红线

## 关键资料索引
- 只保留之后会反复查用的路径、命令、文档、数据集、环境信息

# 当前推进

## 当前状态
- 目前做到哪一步、整体局面如何

## 未闭环事项
- 还没做完、待验证、存在风险或阻塞的事项

# 关键事件

### [时间/阶段] 事件标题
- 触发：为什么会开始这件事
- 处理：采取了哪些关键动作
- 结果：现在达成了什么结果
- 影响：后续推进因此发生了什么变化，或还有什么尾巴

规则：
1. “关键事件”只保留 3-6 个真正重要的大事件：版本推进、重要路线切换、完整实验闭环、复杂问题解决
2. 不要记录普通重启、一次性报错、样式修改、零碎命令执行、机械操作
3. “稳定设定与约束”里不要放临时开关、当前默认值、本轮策略、小 bug 补偿器
4. 如果旧记忆里有高价值事件/资料/偏好而近期记录没再提到，也要保留
5. 如果近期记录与旧记忆冲突，以时间更近且更明确的内容为准
6. 保持信息密度高，宁缺毋滥，不要为了凑栏目硬写`;

  const userPrompt = latestMemory
    ? `项目: ${projectName}\n\n已有长期记忆:\n${latestMemory}\n\n近期动态记录:\n${recentEntries}\n\n请合并输出更新后的长期记忆。`
    : `项目: ${projectName}\n\n近期动态记录:\n${recentEntries}\n\n请整理为长期记忆。`;

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
  evidenceText: string,
  config: AllMemConfig["llm"],
  existingObjects?: ProjectObjects | null
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
    { "content": "不要自动 push 到远程，除非用户明确确认", "rationale": "长期协作边界" }
  ],
  "resources": [
    { "label": "训练代码", "kind": "path", "value": "E:/Project3s/css_dev/my_wan22a14b_v5", "note": "当前使用的训练代码，基于 ai-toolkit 的量化+精度恢复版本", "relatedCommand": "python -m accelerate.commands.launch --num_processes 3 run.py train.yaml", "importance": 1 },
    { "label": "训练命令", "kind": "command", "value": "python -m accelerate.commands.launch --num_processes 3 --main_process_port 29501 run.py train_ffgo_bicycle_20000.yaml", "note": "当前正在服务器上运行的训练", "importance": 1 }
  ],
  "events": [
    {
      "title": "选择 FFGO 方法而不是 cross-attn",
      "time": "2026-03",
      "background": "项目需要将多视角参考图的细节注入到生成视频中，使用 Wan2.2 作为基座模型",
      "trigger": "尝试 cross-attn 方法失败：像加了滤镜，细节没注入成功，视频质量变差",
      "actions": [
        "参考 VACE/FFGO 论文，发现大家都依赖 Wan2.2 的自注意力机制",
        "采用 FFGO 逻辑：将参考图拼接到视频前4帧",
        "使用 LoRA 微调，rank=32，训练 40000 步"
      ],
      "result": "细节注入成功，视频质量保持，但仍存在几何稳定性问题",
      "status": "已完成，成为当前主方法",
      "nextStep": "在 FFGO 基础上解决几何稳定性问题",
      "lesson": "不要用 cross-attn 注入细节到视频生成模型，会破坏生成质量。正确做法：利用模型自身的注意力机制",
      "refs": ["E:/Project3s/css_dev/my_wan22a14b_v5"]
    }
  ]
}

对象定义：
1. state: 当前局面（全量输出）。不是项目简介，而是”现在项目在做什么、下一步是什么、卡在哪”。
2. rules: 长期规则（智能合并）。保留仍然有效的旧规则 + 新增规则，删除已过时的规则。
3. resources: 关键资料（智能合并）。保留仍然在用的旧资料 + 新增资料，删除已废弃的路径/命令。
   - 代码路径：必须包含 label + kind + value + note + relatedCommand（如果有）+ importance
   - 命令：必须是完整的可执行命令
   - importance: 1=每天都用（训练代码、主命令），2=每周用几次（测试代码、文档），3=偶尔用（参考资料）
   - 必须提取：训练/运行/测试的代码路径和命令、数据集路径、配置文件路径、设计文档路径、服务器资源信息
   - 不要提取：临时文件路径、一次性测试命令、系统默认路径、node_modules/.git 等标准目录
4. events: 重要事件（智能合并）。保留仍然重要的旧事件 + 新增事件，删除已完成且无经验价值的事件。必须尽量体现 时间/阶段 + 背景 + 触发 + 处理 + 结果 + 当前状态/下一步。
   - 决策类事件：必须包含 background（具体的项目背景和技术栈）+ trigger（为什么做这个决策）+ actions（具体做了什么：方法、参数、步骤）+ result + lesson（可复用的经验教训）
   - 问题类事件：必须包含具体现象（不是”性能问题”，而是”旋转时几何形变”）+ 根因分析 + 尝试过的解决方案和效果（失败的也要记录）
   - 讨论/问答类事件：必须包含问题和结论
   - 核心原则：AI 和人类都能看懂、脱离上下文也能理解、包含足够的技术细节、可以直接用于指导后续工作

严格要求：
1. 不要提取低价值噪音，例如普通重启、一次性小报错、样式微调、favicon 404、端口冲突、机械操作。
2. rules 里绝不能放临时开关、当前默认值、一次性的错误补偿器、某次小 bug 的应急说法。
3. 如果一条规则不是未来多半还会用到的长期协作规范或稳定偏好，就不要写进 rules。
4. events 不要切得太碎；修一个小错误不叫重要事件。一个版本、一条完整实验链、一轮重要重构、一次关键路线变更，才更像事件。
5. 每个 event 必须尽量做到“脱离上下文也能看懂”。不要写只有作者自己才懂的简称、模糊代词或悬空名词；如果出现 PersonaScope、v9、某方案 这类词，必须在 background 或 trigger 里交代它是什么、为什么重要。
6. event 不能只像一句新闻标题。至少要让人和 LLM 看完后知道：这是在解决什么问题、为什么开始、做了什么、现在处于什么状态、下一步是什么。
7. background 不是一句空泛评价，而是给陌生读者补齐最少必要上下文。写完后，人和 LLM 不应再追问“这个方案/版本/名词到底是什么”。
8. 如果某个事件只能写出一句短标题，说明它还不够格进入 events；宁可不写，也不要塞进来。
9. 不要为了凑类别硬塞内容；没有就返回空字符串或空数组。
10. state 最多 5 个 nextSteps、5 个 risks；rules 最多 8 条；resources 最多 12 条；events 最多 8 条。
11. 输出必须可被 JSON.parse 直接解析。`;

  const existingDataText = existingObjects
    ? `
现有数据（请智能合并）:
- 现有规则: ${existingObjects.rules?.length || 0} 条
- 现有资料: ${existingObjects.resources?.length || 0} 条
- 现有事件: ${existingObjects.events?.length || 0} 条

现有规则:
${existingObjects.rules?.map(r => `- ${r.content}${r.rationale ? ` (${r.rationale})` : ''}`).join('\n') || '（无）'}

现有资料:
${existingObjects.resources?.map(r => `- ${r.label} (${r.kind}): ${r.value}${r.note ? ` - ${r.note}` : ''}`).join('\n') || '（无）'}

现有事件:
${existingObjects.events?.map(e => `- ${e.title} (${e.time || '未知'}, ${e.status || '未知状态'})`).join('\n') || '（无）'}

请输出合并后的完整数据：保留仍然有效/重要的 + 新增的，删除已过时/已完成无价值的。
`
    : '';

  const userPrompt = `项目: ${projectName}
${existingDataText}
长期记忆:
${memoryMarkdown ?? "（暂无）"}

近期动态:
${recentMarkdown ?? "（暂无）"}

新增证据:
${evidenceText}

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
  } catch (error) {
    console.warn("[objects] Failed to parse LLM response as JSON:", raw);
    console.error("[objects] Parse error:", error);
    // 如果有现有数据就返回，否则抛出错误让用户知道
    if (existingObjects) {
      return existingObjects;
    }
    throw new Error(`结构化提取失败: ${error instanceof Error ? error.message : '无法解析 LLM 响应'}`);
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
      "trigger": "什么触发了这条经验",
      "whyItWorks": "为什么这个判断或做法成立",
      "boundary": "适用边界与不适用情况",
      "evidenceEpisodes": ["支撑这条经验的 episode 标题 1", "episode 标题 2"],
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
      boundary: ne.boundary,
      evidenceEpisodes: ne.evidenceEpisodes,
      created: now,
      updated: now,
    });
  }

  return updated;
}


function normalizeExtractedProjectObjects(parsed: Partial<ProjectObjects> & Record<string, unknown>): ProjectObjects {
  const state = parsed.state as Partial<ProjectObjects["state"]> | undefined;
  const rules = Array.isArray(parsed.rules) ? parsed.rules : [];
  const resources = Array.isArray(parsed.resources) ? parsed.resources : [];
  const events = Array.isArray(parsed.events) ? parsed.events : [];

  const normalizedRules = dedupeBy(
    rules
      .map((rule, index) => {
        const candidate = rule as { content?: string; rationale?: string };
        return {
          id: `rule-${index + 1}`,
          content: normalizeInlineText(candidate.content),
          rationale: normalizeInlineText(candidate.rationale) || undefined,
        };
      })
      .filter((rule) => looksLikeDurableRule(rule.content, rule.rationale)),
    (rule) => rule.content.toLowerCase()
  ).slice(0, 8);

  const normalizedResources = dedupeBy(
    resources
      .map((resource, index) => {
        const candidate = resource as { label?: string; kind?: string; value?: string; note?: string };
        return {
          id: `resource-${index + 1}`,
          label: normalizeInlineText(candidate.label),
          kind: normalizeResourceKind(candidate.kind),
          value: normalizeInlineText(candidate.value),
          note: normalizeInlineText(candidate.note) || undefined,
        };
      })
      .filter((resource) => resource.label.length > 0 && resource.value.length > 0),
    (resource) => `${resource.kind}|${resource.label.toLowerCase()}|${resource.value.toLowerCase()}`
  ).slice(0, 12);

  const normalizedEvents = dedupeBy(
    events
      .map((event, index) => {
        const candidate = event as {
          title?: string;
          time?: string;
          background?: string;
          trigger?: string;
          actions?: string[];
          result?: string;
          status?: string;
          nextStep?: string;
          lesson?: string;
          refs?: string[];
        };
        return {
          id: `event-${index + 1}`,
          title: normalizeInlineText(candidate.title),
          time: normalizeInlineText(candidate.time) || undefined,
          background: normalizeInlineText(candidate.background) || undefined,
          trigger: normalizeInlineText(candidate.trigger),
          actions: Array.isArray(candidate.actions)
            ? candidate.actions.map((item) => normalizeInlineText(item)).filter(Boolean).slice(0, 6)
            : [],
          result: normalizeInlineText(candidate.result),
          status: normalizeInlineText(candidate.status) || undefined,
          nextStep: normalizeInlineText(candidate.nextStep) || undefined,
          lesson: normalizeInlineText(candidate.lesson) || undefined,
          refs: Array.isArray(candidate.refs)
            ? candidate.refs.map((item) => normalizeInlineText(item)).filter(Boolean).slice(0, 6)
            : [],
        };
      })
      .filter((event) => looksLikeImportantEvent(event)),
    (event) => `${event.title.toLowerCase()}|${event.result.toLowerCase()}`
  ).slice(0, 8);

  return {
    state: {
      goal: normalizeInlineText(state?.goal),
      currentStatus: normalizeInlineText(state?.currentStatus),
      currentFocus: normalizeInlineText(state?.currentFocus),
      nextSteps: Array.isArray(state?.nextSteps)
        ? dedupeBy(
            state.nextSteps.map((item) => normalizeInlineText(item)).filter(Boolean),
            (item) => item.toLowerCase()
          ).slice(0, 5)
        : [],
      risks: Array.isArray(state?.risks)
        ? dedupeBy(
            state.risks.map((item) => normalizeInlineText(item)).filter(Boolean),
            (item) => item.toLowerCase()
          ).slice(0, 5)
        : [],
    },
    rules: normalizedRules,
    resources: normalizedResources,
    events: normalizedEvents,
    updatedAt: new Date().toISOString(),
  };
}

function normalizeResourceKind(kind: unknown): ProjectObjects["resources"][number]["kind"] {
  return kind === "path" || kind === "command" || kind === "url" || kind === "doc" || kind === "env"
    ? kind
    : "doc";
}

function normalizeInlineText(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

function looksLikeDurableRule(content: string, rationale?: string): boolean {
  if (!content) return false;
  const text = `${content} ${rationale ?? ""}`.trim();
  if (text.length < 6) return false;

  const positive = /不要|必须|优先|避免|除非|习惯|偏好|约束|红线|保持|统一|始终|长期|规范|确认/.test(text);
  const negative = /默认|临时|本次|这次|当前|这轮|今天|刚刚|报错|错误|异常|bug|404|500|端口|重启|favicon|控制台|样式|文案|卡片|按钮|同步功能|经验蒸馏|默认关闭|默认开启|开关|toggle/.test(text);

  if (negative && !positive) return false;
  return positive || !negative;
}
function looksLikeImportantEvent(event: {
  title: string;
  time?: string;
  background?: string;
  trigger: string;
  actions: string[];
  result: string;
  status?: string;
  nextStep?: string;
  lesson?: string;
  refs: string[];
}): boolean {
  const title = event.title;
  const background = event.background ?? "";
  const trigger = event.trigger;
  const result = event.result;
  const actions = event.actions;
  const refs = event.refs;
  const status = event.status ?? "";
  const nextStep = event.nextStep ?? "";
  const lesson = event.lesson ?? "";
  const text = [event.time ?? "", title, background, trigger, result, status, nextStep, lesson, actions.join(" "), refs.join(" ")].join(" ");

  if (!title && !result) return false;
  if ((title + result).length < 16) return false;

  const negative = /404|500|favicon|端口|重启|样式|文案|卡片|按钮|控制台|小错误|小 bug|微调|格式/.test(text);
  const positive = /版本|里程碑|路线|方案|架构|重构|实验|数据集|训练|评测|评估|同步|记忆|抽取|发布|迁移|闭环|实现|完成|验证|决策|方向/.test(text);
  const hasClosure = trigger.length > 0 && result.length > 0;
  const hasProcess = actions.length > 0 && actions.join("").length >= 8;
  const hasContext = background.length >= 12 || refs.length > 0 || (!!event.time && (status.length > 0 || nextStep.length > 0));
  const denseEnough = text.length >= 80;
  const populatedSections = [
    event.time ?? "",
    background,
    trigger,
    actions.length > 0 ? "actions" : "",
    result,
    status,
    nextStep,
    lesson,
    refs.length > 0 ? "refs" : "",
  ].filter(Boolean).length;
  const hasScope = positive || denseEnough || populatedSections >= 5;

  if (negative && !hasScope) return false;
  return hasClosure && hasProcess && hasContext && hasScope;
}

function dedupeBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = getKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

/** 智能导入：用 LLM 将导入内容合并到现有 objects 中 */
export async function importToObjects(
  projectName: string,
  importedContent: string,
  existingObjects: ProjectObjects,
  config: AllMemConfig["llm"]
): Promise<{ objects: ProjectObjects; conflicts: string[] }> {
  const systemPrompt = `你是一个项目记忆合并助手。用户正在导入一段外部内容到项目记忆中。
你需要：
1. 分析导入内容，识别其中属于哪些类别的信息
2. 将信息合并到现有的项目对象中
3. 如果导入内容与现有记忆有严重冲突（比如目标完全不同、规则矛盾），标记冲突

输出严格 JSON，格式：
{
  "objects": {
    "state": { "goal": "...", "currentStatus": "...", "currentFocus": "...", "nextSteps": [...], "risks": [...] },
    "rules": [{ "content": "...", "rationale": "..." }],
    "resources": [{ "label": "...", "kind": "path|command|url|doc|env", "value": "...", "note": "..." }],
    "events": [{ "title": "...", "time": "...", "trigger": "...", "actions": [...], "result": "...", "lesson": "..." }]
  },
  "conflicts": ["冲突描述1", "冲突描述2"]
}

合并规则：
- 保留现有内容中仍然有效的部分
- 追加导入内容中的新信息
- 如果导入内容更新了某个字段（比如更新的状态），用新内容替换旧内容
- 只在严重冲突时才添加 conflicts（比如目标矛盾、规则冲突）
- conflicts 为空数组表示无冲突`;

  const userPrompt = `项目: ${projectName}

现有记忆:
${JSON.stringify(existingObjects, null, 2)}

导入内容:
${importedContent}

请合并并输出 JSON。`;

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
    const objects = normalizeExtractedProjectObjects(parsed.objects ?? parsed);
    return {
      objects,
      conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
    };
  } catch {
    console.warn("[import] Failed to parse LLM response:", raw);
    return { objects: existingObjects, conflicts: ["导入解析失败，内容未变更"] };
  }
}



