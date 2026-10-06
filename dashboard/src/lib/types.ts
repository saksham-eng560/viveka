// Mirrors the Pulse backend REST contract (C3). Keep in sync with pulse-backend/models.py.
export type Source = "aw" | "sample";

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
  dataSource: "aw" | "sample" | "auto";
  aw: { reachable: boolean; url: string };
  ollama: { reachable: boolean; url: string; model: string; modelAvailable: boolean };
}

export interface ErrorBody {
  detail: string;
}
