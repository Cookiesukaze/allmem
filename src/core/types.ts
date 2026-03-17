// AllMem core types

export interface AllMemConfig {
  llm: {
    apiKey: string;
    baseUrl: string;
    model: string;
    curatorModel?: string; // 廉价模型用于 Curator（记忆压缩），留空则与主模型相同
  };
  sync: {
    mode: "manual" | "auto";
    intervalMinutes: number;
    maxTurns: number;        // max conversation turns to process per project
    maxCharsPerTurn: number; // truncate each turn to this many chars
    lastSyncTimestamp?: number; // epoch ms of last sync
    compactionThreshold: number; // number of recent entries before compacting into latest.md
  };
  agents: string[];          // enabled agent ids: ["claude", "codex"]
  syncAll: boolean;            // true = sync all detected projects, false = only syncProjects
  syncProjects: string[];    // project aliases to sync (only used when syncAll=false)
  privacy: {
    enabled: boolean;
    sensitiveWords: string[];  // words to redact before LLM processing and in stored memories
    replacement: string;       // replacement text, default "[***]"
  };
}

export interface ProjectMeta {
  alias: string;
  path: string;
  description: string;    // auto-generated: what this project is, tech stack, current state
  notes: string;          // user-editable free-form notes
  created: string;
  lastSync: string | null;
  currentVersion: number;
  status: "active" | "archived";
}

export interface MemoryVersion {
  version: number;
  date: string;
  summary: string;
  filename: string;
}

export interface AgentDef {
  id: string;
  name: string;
  checkDir: string;
  logDir: string;
  logPattern: RegExp;
  detected: boolean;
}

export interface SyncResult {
  agent: string;
  projectsFound: number;
  projectsUpdated: number;
  errors: string[];
  timestamp: string;
}

export interface ExtractedMemory {
  project: string;
  projectPath: string;
  userFacts: string[];
  projectFacts: string[];
  decisions: string[];
  problems: string[];
  preferences: string[];
  rawTurns: number;
}

export interface Experience {
  id: string;
  title: string;
  content: string;
  context?: string;
  tags: string[];
  scope: "global" | "project";
  sources: Array<{ project: string; count: number; lastSeen: string }>;
  confidence: number;
  created: string;
  updated: string;
}

/** 根据角色返回对应的 LLM 配置（Curator 用廉价模型，其余用主模型） */
export function getLLMConfigForRole(
  config: AllMemConfig["llm"],
  role: "narrator" | "curator" | "distiller" | "general"
): AllMemConfig["llm"] {
  if (role === "curator" && config.curatorModel) {
    return { ...config, model: config.curatorModel };
  }
  return config;
}

export const DEFAULT_CONFIG: AllMemConfig = {
  llm: {
    apiKey: "sk-e2bdf509aaca48a58d049b181829e273",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.5-plus",
    curatorModel: "",
  },
  sync: {
    mode: "manual",
    intervalMinutes: 30,
    maxTurns: 80,
    maxCharsPerTurn: 800,
    compactionThreshold: 10,
  },
  agents: ["claude", "codex"],
  syncAll: true,
  syncProjects: [],
  privacy: {
    enabled: false,
    sensitiveWords: [],
    replacement: "[***]",
  },
};
