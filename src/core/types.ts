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
    maxTurns: number;        // max conversation turns to process per project
    maxCharsPerTurn: number; // truncate each turn to this many chars
    lastSyncTimestamp?: number; // epoch ms of last sync
  };
  agents: string[];          // enabled agent ids: ["claude", "codex"]
  syncProjects: string[];    // project aliases to sync (empty = all)
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

export const DEFAULT_CONFIG: AllMemConfig = {
  llm: {
    apiKey: "sk-e2bdf509aaca48a58d049b181829e273",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen3.5-plus",
  },
  sync: {
    mode: "manual",
    intervalMinutes: 30,
    maxTurns: 80,
    maxCharsPerTurn: 800,
  },
  agents: ["claude", "codex"],
  syncProjects: [], // empty = sync all detected
};
