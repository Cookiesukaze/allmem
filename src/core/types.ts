// AllMem core types

export interface AllMemConfig {
  llm: {
    apiKey: string;
    baseUrl: string;
    model: string;
    curatorModel?: string;
  };
  sync: {
    mode: "manual" | "auto";
    intervalMinutes: number;
    maxTurns: number;
    maxCharsPerTurn: number;
    lastSyncTimestamp?: number;
    compactionThreshold: number;
  };
  agents: string[];
  syncAll: boolean;
  syncProjects: string[];
  enableDistiller: boolean;
  privacy: {
    enabled: boolean;
    sensitiveWords: string[];
    replacement: string;
  };
}

export interface ProjectMeta {
  alias: string;
  path: string;
  description: string;
  notes: string;
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

export interface ProjectState {
  goal: string;
  currentStatus: string;
  currentFocus: string;
  nextSteps: string[];
  risks: string[];
}

export interface ProjectRule {
  id: string;
  content: string;
  rationale?: string;
}

export interface ProjectResource {
  id: string;
  label: string;
  kind: "path" | "command" | "url" | "doc" | "env";
  value: string;
  note?: string;
}

export interface ProjectEvent {
  id: string;
  title: string;
  trigger: string;
  actions: string[];
  result: string;
  lesson?: string;
  refs: string[];
}

export interface ProjectObjects {
  state: ProjectState;
  rules: ProjectRule[];
  resources: ProjectResource[];
  events: ProjectEvent[];
  updatedAt: string;
}

export interface Experience {
  id: string;
  title: string;
  content: string;
  context?: string;
  kind?: "experience" | "skill";
  tags: string[];
  scope: "global" | "project";
  sources: Array<{ project: string; count: number; lastSeen: string }>;
  confidence: number;
  trigger?: string;
  steps?: string[];
  verification?: string;
  whyItWorks?: string;
  created: string;
  updated: string;
}

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
    apiKey: "",
    baseUrl: "",
    model: "",
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
  enableDistiller: false,
  privacy: {
    enabled: false,
    sensitiveWords: [],
    replacement: "[***]",
  },
};

