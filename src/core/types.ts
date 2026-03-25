// AllMem core types

export interface AllMemConfig {
  llm: {
    apiKey: string;
    baseUrl: string;
    model: string;
  };
  sync: {
    mode: "manual" | "auto";
    intervalMinutes: number;
    maxTurns: number;
    maxCharsPerTurn: number;
    lastSyncTimestamp?: number;
    compactionThreshold: number;
  };
  syncContent: {
    workspace: { goal: boolean; status: boolean; focus: boolean; nextSteps: boolean; risks: boolean };
    memory: { rules: boolean; resources: boolean };
    events: boolean;
    userProfile: boolean;
  };
  injection: {
    workspace: { goal: boolean; status: boolean; focus: boolean; nextSteps: boolean; risks: boolean };
    memory: { rules: boolean; resources: boolean };
    events: boolean;
    manual: boolean;
    userProfile: boolean;
  };
  agents: string[];
  syncAll: boolean;
  syncProjects: string[];
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
  snapshot: {
    objects: ProjectObjects;
    instructions: string;
  };
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
  time?: string;
  background?: string;
  trigger: string;
  actions: string[];
  result: string;
  status?: string;
  nextStep?: string;
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
  boundary?: string;
  evidenceEpisodes?: string[];
  created: string;
  updated: string;
}

export function getLLMConfigForRole(
  config: AllMemConfig["llm"],
  _role: "narrator" | "curator" | "distiller" | "general"
): AllMemConfig["llm"] {
  return config;
}

export const DEFAULT_CONFIG: AllMemConfig = {
  llm: {
    apiKey: "",
    baseUrl: "",
    model: "",
  },
  sync: {
    mode: "manual",
    intervalMinutes: 30,
    maxTurns: 80,
    maxCharsPerTurn: 800,
    compactionThreshold: 10,
  },
  syncContent: {
    workspace: { goal: true, status: true, focus: true, nextSteps: true, risks: true },
    memory: { rules: true, resources: true },
    events: true,
    userProfile: true,
  },
  injection: {
    workspace: { goal: true, status: true, focus: true, nextSteps: true, risks: true },
    memory: { rules: true, resources: true },
    events: true,
    manual: true,
    userProfile: true,
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




