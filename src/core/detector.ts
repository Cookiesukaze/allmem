// Detector: auto-detect installed AI coding tools

import { exists } from "@tauri-apps/plugin-fs";
import { join, homeDir } from "@tauri-apps/api/path";
import type { AgentDef } from "./types";

export async function detectAgents(): Promise<AgentDef[]> {
  const home = await homeDir();

  const claudeDir = await join(home, ".claude", "projects");
  const codexDir = await join(home, ".codex", "sessions");

  const defs: Omit<AgentDef, "detected">[] = [
    {
      id: "claude",
      name: "Claude Code",
      checkDir: claudeDir,
      logDir: claudeDir,
      logPattern: /\.jsonl$/,
    },
    {
      id: "codex",
      name: "Codex CLI",
      checkDir: codexDir,
      logDir: codexDir,
      logPattern: /rollout-.*\.jsonl$/,
    },
  ];

  const results: AgentDef[] = [];
  for (const def of defs) {
    let detected = false;
    try {
      detected = await exists(def.checkDir);
    } catch (err) {
      console.warn(`[detector] Failed to check ${def.id} at ${def.checkDir}:`, err);
      detected = false;
    }
    results.push({ ...def, detected });
  }

  return results;
}

export async function getDetectedAgentIds(): Promise<string[]> {
  const agents = await detectAgents();
  return agents.filter((a) => a.detected).map((a) => a.id);
}
