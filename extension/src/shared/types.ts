// Shared extension types (contract C2 / C5). Single source of truth for background, UI and content script.

export type AiSource = "llm" | "heuristic";

export interface Classification {
  score: number; // 0-100
  category: string; // single Title-cased word
  reasoning: string; // one short sentence
}

export interface ClassifiedResult extends Classification {
  source: AiSource;
}

export interface LighthouseEventData {
  url: string;
  title: string;
  audible: boolean;
  incognito: boolean;
  tabCount: number;
  goal_active: string | null;
  ai_score: number;
  ai_category: string;
  ai_reasoning: string;
  ai_source?: AiSource;
}

export interface AwEvent {
  timestamp: string;
  duration: number;
  data: LighthouseEventData;
}

export interface BrainAlertPayload {
  id: number;
  kind: string;
  title: string;
  text: string;
  level: number;
  actions: { id: string; label: string }[];
}

export interface NudgePayload {
  score: number;
  category: string;
  reasoning: string;
  goal: string;
  url: string;
  hostname: string;
  minutesLeft: number | null;
  /** Set when the nudge comes from Leo's brain (backend coach) instead of the standalone engine. */
  brain?: BrainAlertPayload;
}

/** What Leo's brain (the backend coach) last said about the active tab. */
export interface BrainStatus {
  online: boolean;
  buddyOnline: boolean;
  firstName: string | null;
  goals: string[];
  verdict: "focus" | "neutral" | "distraction" | null;
  label: string | null;
  checkedAt: number;
}

export interface Settings {
  ollamaUrl: string;
  awUrl: string;
  model: string;
  nudgeThresholdSeconds: number;
  demoMode: boolean;
  nudgeCooldownSeconds: number;
  voiceNudges: boolean;
  autoGroupTabs: boolean;
}

export interface CurrentTab {
  tabId: number;
  url: string;
  title: string;
  score: number;
  category: string;
  reasoning: string;
  source: AiSource;
}

export interface DistractionEvent {
  timestamp: number;
  url: string;
  durationSeconds: number;
}

export interface SessionReceipt {
  goal: string;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
  focusedSeconds: number;
  distractedSeconds: number;
  averageScore: number;
  topCategories: Record<string, number>;
  switches: number;
  summary: string;
  generatedBy: "llm" | "template";
}

export interface AppStateSnapshot {
  currentGoal: string | null;
  sessionStartTime: number | null;
  sessionDurationMinutes: number | null;
  currentFocusScore: number;
  sessionAverageScore: number;
  currentTab: CurrentTab | null;
  recentDistractions: DistractionEvent[];
  lowScoreSince: number | null;
  aiStatus: "online" | "heuristic";
  awStatus: "online" | "offline";
  bufferedEvents: number;
  settings: Settings;
  /** Additive (not in C5): last finished session receipt so the panel can re-show it. */
  lastReceipt: SessionReceipt | null;
  /** Additive: Leo's brain status (null until the first report). */
  brain: BrainStatus | null;
}

export interface ContextResetTab {
  tabId: number;
  title: string;
  url: string;
  score: number;
  category: string;
  relevant: boolean;
}

export interface ContextResetSummary {
  goal: string | null;
  tabs: ContextResetTab[];
  summary: string;
  suggestedCloseTabIds: number[];
  generatedBy: "llm" | "heuristic";
}

/** Internal running totals for the active session (persisted, not part of the snapshot). */
export interface SessionStats {
  goal: string;
  startedAt: number;
  durationMinutes: number | null;
  lastAccountAt: number;
  focusedSeconds: number;
  distractedSeconds: number;
  weightedScoreSum: number;
  scoredSeconds: number;
  categories: Record<string, number>;
  switches: number;
  lastHost: string | null;
}

export interface StoredState {
  snapshot: AppStateSnapshot;
  session: SessionStats | null;
  cooldownUntil: number;
  nudgeVisibleTabId: number | null;
}
