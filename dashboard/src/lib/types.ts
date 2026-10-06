// Mirrors the Pulse backend REST contract (C3). Keep in sync with pulse-backend/models.py.
export type Source = "aw" | "sample" | "local";

export interface DailySummaryResponse {
  date: string;
  totalActiveSeconds: number;
  activeSeconds: number;
  distractionSeconds: number;
  averageFocusScore: number;
  topCategories: Record<string, number>;
  contextSwitches: number;
  source: Source;
}

export interface TimelineEvent {
  timestamp: string;
  durationSeconds: number;
  url: string;
  hostname: string;
  title: string;
  score: number;
  category: string;
  reasoning: string;
  goal: string | null;
}

export interface TimelineResponse {
  date: string;
  source: Source;
  events: TimelineEvent[];
}

export interface StandupRequest {
  date: string;
  tz?: string;
}

export interface StandupNotesResponse {
  markdown: string;
  generatedBy: "llm" | "template";
  model: string | null;
  source: Source;
}

export interface HealthResponse {
  status: "ok";
  dataSource: "aw" | "sample" | "auto" | "local";
  aw: { reachable: boolean; url: string };
  ollama: { reachable: boolean; url: string; model: string; modelAvailable: boolean };
}

export interface ErrorBody {
  detail: string;
}

// ---- Sheru (coach) contract: pulse-backend/main.py, profile_store.py, coach.py
export type Pace = "gentle" | "balanced" | "demo";
export type QuoteFrequency = "often" | "sometimes" | "rarely";

export interface ProfileInput {
  name: string;
  age: number | null;
  goals: string[];
  workTools: string[];
  distractions: string[];
  pace: Pace;
  quotes: QuoteFrequency;
  voice: boolean;
  sounds: boolean;
}

export interface Profile extends ProfileInput {
  overrides: Record<string, "focus" | "neutral" | "distraction">;
  createdAt: string;
  updatedAt: string;
}

export interface ProfileResponse {
  exists: boolean;
  profile: Profile | null;
}

export interface Chip {
  id: string;
  label: string;
}

export interface Catalog {
  workTools: Chip[];
  distractions: Chip[];
  goalIdeas: string[];
}

export interface BuddyMessage {
  id: number;
  kind: string;
  mood: string;
  title: string;
  text: string;
  source: string;
  ts: number;
  alert: boolean;
  level: number;
  label: string;
}

export interface BuddyState {
  profile: { name: string; firstName: string; goals: string[]; pace: Pace; voice: boolean; sounds: boolean; quotes: QuoteFrequency } | null;
  mood: string;
  now: {
    label: string;
    app: string;
    title: string;
    domain: string;
    verdict: "focus" | "neutral" | "distraction";
    category: string;
    reason: string;
    source: string;
    writing: boolean;
    keyIdle: number | null;
  } | null;
  messages: BuddyMessage[];
  lastId: number;
  activeAlertId: number | null;
  away: boolean;
  breakUntil: number | null;
  hushUntil: number | null;
  buddyOnline: boolean;
  extensionOnline: boolean;
  axTrusted: boolean;
  llmOnline: boolean | null;
  stallLevel: number;
  today: { focusSeconds: number; distractionSeconds: number; alertCount: number };
}

export interface TodayAlert {
  ts: string;
  kind: string;
  level: number;
  label: string;
  text: string;
}

export interface TodayResponse {
  focusSeconds: number;
  neutralSeconds: number;
  distractionSeconds: number;
  topFocus: { label: string; seconds: number }[];
  topDistractions: { label: string; seconds: number }[];
  alerts: TodayAlert[];
  alertCount: number;
  state: BuddyState;
}
