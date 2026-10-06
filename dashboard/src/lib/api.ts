import axios, { isAxiosError } from "axios";
import type {
  DailySummaryResponse,
  HealthResponse,
  StandupNotesResponse,
  StandupRequest,
  TimelineResponse,
} from "./types";

export const API_URL: string = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

export const client = axios.create({ baseURL: API_URL, timeout: 180_000 });

export function localTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export async function getSummary(date: string, tz: string = localTimeZone()): Promise<DailySummaryResponse> {
  const { data } = await client.get<DailySummaryResponse>("/api/summary", { params: { date, tz } });
  return data;
}

export async function getTimeline(date: string, tz: string = localTimeZone()): Promise<TimelineResponse> {
  const { data } = await client.get<TimelineResponse>("/api/timeline", { params: { date, tz } });
  return data;
}

export async function generateStandup(date: string, tz: string = localTimeZone()): Promise<StandupNotesResponse> {
  const body: StandupRequest = { date, tz };
  const { data } = await client.post<StandupNotesResponse>("/api/generate-standup", body);
  return data;
}

export async function getHealth(): Promise<HealthResponse> {
  const { data } = await client.get<HealthResponse>("/api/health");
  return data;
}

/** Backend `detail` if present, otherwise a connectivity message. */
export function apiErrorMessage(e: unknown): string {
  if (isAxiosError(e)) {
    const detail = (e.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === "string" && detail) return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string };
      if (first?.msg) return first.msg;
    }
    if (e.response) return `Pulse backend returned ${e.response.status}`;
    return `Cannot reach Pulse backend at ${API_URL}`;
  }
  if (e instanceof Error && e.message) return e.message;
  return `Cannot reach Pulse backend at ${API_URL}`;
}
