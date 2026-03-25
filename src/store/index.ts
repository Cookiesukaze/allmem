import { create } from "zustand";
import type { AllMemConfig, ProjectMeta, ScannedProjectCard, SyncResult } from "../core/types";
import { DEFAULT_CONFIG } from "../core/types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AppState {
  // Navigation
  activePage: "dashboard" | "projects" | "experiences" | "user" | "settings" | "chat";
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

  // Project-level sync state
  projectSyncing: boolean;
  projectSyncStatus: string;
  setProjectSyncing: (syncing: boolean) => void;
  setProjectSyncStatus: (status: string) => void;

  // Agents
  detectedAgents: { id: string; name: string; detected: boolean }[];
  setDetectedAgents: (agents: AppState["detectedAgents"]) => void;

  // Scanned projects (from transcripts) for selection UI
  scannedProjectCards: ScannedProjectCard[];
  scannedProjectAliases: string[];
  scannedAliasEditorsMap: Record<string, string[]>;
  setScannedIndex: (cards: ScannedProjectCard[]) => void;

  // Chat
  chatMessages: ChatMessage[];
  chatLoading: boolean;
  setChatLoading: (loading: boolean) => void;
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

  projectSyncing: false,
  projectSyncStatus: "",
  setProjectSyncing: (syncing) => set({ projectSyncing: syncing }),
  setProjectSyncStatus: (status) => set({ projectSyncStatus: status }),

  detectedAgents: [],
  setDetectedAgents: (agents) => set({ detectedAgents: agents }),

  scannedProjectCards: [],
  scannedProjectAliases: [],
  scannedAliasEditorsMap: {},
  setScannedIndex: (cards) => {
    const normalizedCards = cards.map((c) => {
      const fallbackKey = c.key?.trim()
        ? c.key
        : c.projectPath?.trim()
          ? `path:${c.projectPath.replace(/\//g, "\\").trim().toLowerCase()}`
          : c.cursorProjectId
            ? `cursor:${c.cursorProjectId}`
            : `alias:${c.alias}`;
      return { ...c, key: c.key || fallbackKey };
    });
    const aliasList = normalizedCards.map((c) => c.alias).sort();
    const editorsMap: Record<string, string[]> = {};
    for (const c of normalizedCards) editorsMap[c.key] = c.ides;
    set({ scannedProjectCards: normalizedCards, scannedProjectAliases: aliasList, scannedAliasEditorsMap: editorsMap });
  },

  chatMessages: [],
  chatLoading: false,
  setChatLoading: (loading) => set({ chatLoading: loading }),
  addChatMessage: (msg) =>
    set((state) => ({ chatMessages: [...state.chatMessages, msg] })),
  clearChat: () => set({ chatMessages: [], chatLoading: false }),
}));
