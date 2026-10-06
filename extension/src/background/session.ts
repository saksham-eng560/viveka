import type { CurrentTab, SessionReceipt, SessionStats, Settings } from "../shared/types";
import { hostnameOf } from "./heuristic";
import { generate } from "./llm-client";

export const FOCUS_THRESHOLD = 40;
const MAX_ACCRUE_GAP_SECONDS = 30;

export function newSession(goal: string, durationMinutes: number | null, now: number): SessionStats {
  return {
    goal,
    startedAt: now,
    durationMinutes,
    lastAccountAt: now,
    focusedSeconds: 0,
    distractedSeconds: 0,
    weightedScoreSum: 0,
    scoredSeconds: 0,
    categories: {},
    switches: 0,
    lastHost: null,
  };
}

/** Attribute time since the last accounting point to the current tab. Mutates and returns stats. */
export function accrue(stats: SessionStats, tab: CurrentTab | null, now: number, paused = false): SessionStats {
  const gap = Math.max(0, (now - stats.lastAccountAt) / 1000);
  stats.lastAccountAt = now;
  if (!tab || paused) return stats;
  const dt = Math.min(gap, MAX_ACCRUE_GAP_SECONDS);
  if (tab.score < FOCUS_THRESHOLD) stats.distractedSeconds += dt;
  else stats.focusedSeconds += dt;
  stats.weightedScoreSum += tab.score * dt;
  stats.scoredSeconds += dt;
  stats.categories[tab.category] = (stats.categories[tab.category] ?? 0) + dt;
  return stats;
}

export function noteSwitch(stats: SessionStats, url: string): void {
  const host = hostnameOf(url) || url;
  if (stats.lastHost !== null && stats.lastHost !== host) stats.switches += 1;
  stats.lastHost = host;
}

export function sessionAverage(stats: SessionStats): number {
  return stats.scoredSeconds > 0 ? Math.round((stats.weightedScoreSum / stats.scoredSeconds) * 10) / 10 : 0;
}

export function minutesLeft(stats: SessionStats | null, now: number): number | null {
  if (!stats || stats.durationMinutes === null) return null;
  const leftMs = stats.startedAt + stats.durationMinutes * 60_000 - now;
  return Math.max(0, Math.ceil(leftMs / 60_000));
}

export function topCategories(stats: SessionStats, limit = 5): Record<string, number> {
  return Object.fromEntries(
    Object.entries(stats.categories)
      .map(([k, v]) => [k, Math.round(v)] as const)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit),
  );
}

export function formatDuration(seconds: number): string {
  const m = Math.round(seconds / 60);
  if (m < 1) return `${Math.round(seconds)} seconds`;
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"}`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h} hour${h === 1 ? "" : "s"}`;
}

export function templateSummary(r: Omit<SessionReceipt, "summary" | "generatedBy">): string {
  const cats = Object.keys(r.topCategories).slice(0, 2);
  const focusPct = r.focusedSeconds + r.distractedSeconds > 0
    ? Math.round((r.focusedSeconds / (r.focusedSeconds + r.distractedSeconds)) * 100)
    : 0;
  const first = `You spent ${formatDuration(r.durationSeconds)} on "${r.goal}" and stayed on track ${focusPct}% of the time.`;
  const second = cats.length ? ` Most of your time went to ${cats.join(" and ").toLowerCase()}.` : "";
  const third = r.distractedSeconds >= 60 ? ` You took about ${formatDuration(r.distractedSeconds)} of breaks, which is totally normal.` : " Nicely focused!";
  return first + second + third;
}

export function buildReceiptBase(stats: SessionStats, now: number): Omit<SessionReceipt, "summary" | "generatedBy"> {
  return {
    goal: stats.goal,
    startedAt: stats.startedAt,
    endedAt: now,
    durationSeconds: Math.max(0, Math.round((now - stats.startedAt) / 1000)),
    focusedSeconds: Math.round(stats.focusedSeconds),
    distractedSeconds: Math.round(stats.distractedSeconds),
    averageScore: Math.round(sessionAverage(stats)),
    topCategories: topCategories(stats),
    switches: stats.switches,
  };
}

const SUMMARY_SYSTEM =
  "You write warm, encouraging, non-judgmental summaries of focus sessions. Reply with 1 to 3 plain sentences, no markdown, no lists.";

/** Final receipt: local LLM summary with a deterministic template fallback. */
export async function buildReceipt(
  stats: SessionStats,
  now: number,
  settings: Settings,
  opts: { aiAvailable?: boolean } = {},
): Promise<SessionReceipt> {
  const base = buildReceiptBase(stats, now);
  if (opts.aiAvailable !== false && base.durationSeconds >= 30) {
    try {
      const prompt =
        `Goal: ${base.goal}\nDuration: ${formatDuration(base.durationSeconds)}\n` +
        `Focused: ${formatDuration(base.focusedSeconds)}, off-task: ${formatDuration(base.distractedSeconds)}\n` +
        `Average focus score: ${base.averageScore}/100\nContext switches: ${base.switches}\n` +
        `Top categories: ${Object.entries(base.topCategories).map(([k, v]) => `${k} (${formatDuration(v)})`).join(", ") || "none"}\n` +
        "Write the session summary.";
      const text = (await generate(settings, SUMMARY_SYSTEM, prompt, { numPredict: 160, temperature: 0.3, timeoutMs: 20_000 })).trim();
      if (text) return { ...base, summary: text, generatedBy: "llm" };
    } catch {
      /* fall through to template */
    }
  }
  return { ...base, summary: templateSummary(base), generatedBy: "template" };
}
