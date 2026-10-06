import type { Settings } from "./types";

const env = import.meta.env as Record<string, string | undefined>;

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return value !== undefined && value !== "" && Number.isFinite(n) && n > 0 ? n : fallback;
}

export const AW_BUCKET_ID = "aw-watcher-web-lighthouse";
export const DEMO_THRESHOLD_SECONDS = 5;
export const DEMO_COOLDOWN_SECONDS = 30;

export const DEFAULT_SETTINGS: Settings = {
  ollamaUrl: env["VITE_OLLAMA_URL"] || "http://localhost:11434",
  awUrl: env["VITE_AW_URL"] || "http://localhost:5600",
  model: env["VITE_LLM_MODEL"] || "qwen3.5:4b",
  nudgeThresholdSeconds: num(env["VITE_NUDGE_THRESHOLD_SECONDS"], 60),
  demoMode: false,
  nudgeCooldownSeconds: 300,
  voiceNudges: false,
  autoGroupTabs: false,
};

export function effectiveThresholdSeconds(s: Settings): number {
  return s.demoMode ? DEMO_THRESHOLD_SECONDS : s.nudgeThresholdSeconds;
}

export function effectiveCooldownSeconds(s: Settings): number {
  return s.demoMode ? DEMO_COOLDOWN_SECONDS : s.nudgeCooldownSeconds;
}
