import axios, { isAxiosError } from "axios";
import type {
  BuddyState,
  Catalog,
  DailySummaryResponse,
  ProfileInput,
  ProfileResponse,
  TodayResponse,
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

export async function getProfile(): Promise<ProfileResponse> {
  const { data } = await client.get<ProfileResponse>("/api/profile", { timeout: 8000 });
  return data;
}

export async function saveProfile(profile: ProfileInput): Promise<ProfileResponse> {
  const { data } = await client.put<ProfileResponse>("/api/profile", profile, { timeout: 8000 });
  return data;
}

export async function getCatalog(): Promise<Catalog> {
  const { data } = await client.get<Catalog>("/api/catalog", { timeout: 8000 });
  return data;
}

export async function getBuddyState(): Promise<BuddyState> {
  const { data } = await client.get<BuddyState>("/api/buddy/state", { params: { since: 1_000_000_000 }, timeout: 5000 });
  return data;
}

export async function getToday(): Promise<TodayResponse> {
  const { data } = await client.get<TodayResponse>("/api/today", { timeout: 8000 });
  return data;
}

export async function buddyAction(action: string, minutes?: number): Promise<void> {
  await client.post("/api/buddy/action", { action, minutes: minutes ?? null }, { timeout: 8000 });
}

/** Backend `detail` if present, otherwise a connectivity message. */
export function apiErrorMessage(e: unknown): string {
  if (isAxiosError(e)) {
    const detail = (e.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === "string" && detail) return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string };
      if (first?.msg) return first.msg.replace(/^Value error, /, "");
    }
    if (e.response) return `Pulse backend returned ${e.response.status}`;
    return `Cannot reach Pulse backend at ${API_URL}`;
  }
  if (e instanceof Error && e.message) return e.message;
  return `Cannot reach Pulse backend at ${API_URL}`;
}
