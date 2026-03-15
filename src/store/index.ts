import { create } from "zustand";
import type { AllMemConfig, ProjectMeta, SyncResult } from "../core/types";
import { DEFAULT_CONFIG } from "../core/types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AppState {
  // Navigation
  activePage: "dashboard" | "projects" | "user" | "settings" | "chat";
  setActivePage: (page: AppState["activePage"]) => void;

  // Selected project
  selectedProject: string | null;
  setSelectedProject: (alias: string | null) => void;

  // Config
  config: AllMemConfig;
  setConfig: (config: AllMemConfig) => void;

  // Projects list
  projects: ProjectMeta[];
  setProjects: (projects: ProjectMeta[]) => void;

  // Sync state
  isSyncing: boolean;
  syncProgress: { stage: string; detail: string; progress: number } | null;
  lastSyncResults: SyncResult[] | null;
  setIsSyncing: (syncing: boolean) => void;
  setSyncProgress: (progress: AppState["syncProgress"]) => void;
  setLastSyncResults: (results: SyncResult[] | null) => void;

  // Agents
  detectedAgents: { id: string; name: string; detected: boolean }[];
  setDetectedAgents: (agents: AppState["detectedAgents"]) => void;

  // Chat
  chatMessages: ChatMessage[];
  addChatMessage: (msg: ChatMessage) => void;
  clearChat: () => void;
}

export const useAppStore = create<AppState>((set) => ({
  activePage: "dashboard",
  setActivePage: (page) => set({ activePage: page }),

  selectedProject: null,
  setSelectedProject: (alias) => set({ selectedProject: alias }),

  config: DEFAULT_CONFIG,
  setConfig: (config) => set({ config }),

  projects: [],
  setProjects: (projects) => set({ projects }),

  isSyncing: false,
  syncProgress: null,
  lastSyncResults: null,
  setIsSyncing: (syncing) => set({ isSyncing: syncing }),
  setSyncProgress: (progress) => set({ syncProgress: progress }),
  setLastSyncResults: (results) => set({ lastSyncResults: results }),

  detectedAgents: [],
  setDetectedAgents: (agents) => set({ detectedAgents: agents }),

  chatMessages: [],
  addChatMessage: (msg) =>
    set((state) => ({ chatMessages: [...state.chatMessages, msg] })),
  clearChat: () => set({ chatMessages: [] }),
}));
