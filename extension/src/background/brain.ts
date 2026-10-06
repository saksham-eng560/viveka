// Bridge to Sheru's brain (the backend coach on :8000).
// When it answers, the backend owns judging and nudging (it also sees desktop apps);
// when it does not, the extension falls back to its own standalone engine.

const env = import.meta.env as Record<string, string | undefined>;
export const BRAIN_URL = (env["VITE_BRAIN_URL"] || "http://127.0.0.1:8000").replace(/\/+$/, "");
export const DASHBOARD_URL = (env["VITE_DASHBOARD_URL"] || "http://localhost:3000").replace(/\/+$/, "");
const TIMEOUT_MS = 2500;
/** A reply older than this no longer counts as "brain online". */
export const BRAIN_FRESH_MS = 30_000;

export type BrainVerdictKind = "focus" | "neutral" | "distraction";

export interface BrainVerdict {
  kind: BrainVerdictKind;
  score: number;
  category: string;
  reason: string;
  source: string;
}

export interface BrainAction {
  id: string;
  label: string;
}

export interface BrainMessage {
  id: number;
  kind: string;
  mood: string;
  title: string;
  text: string;
  source: string;
  actions: BrainAction[];
  alert: boolean;
  level: number;
  label: string;
}

export interface BrainProfile {
  name: string;
  firstName: string;
  goals: string[];
  pace: string;
}

export interface BrainReply {
  verdict: BrainVerdict | null;
  buddyOnline: boolean;
  alert: BrainMessage | null;
  commands: { type: string; url?: string }[];
  profile: BrainProfile | null;
}

export interface BrowserSample {
  url: string;
  title: string;
  audible: boolean;
  focused: boolean;
  incognito: boolean;
  tabId: number;
  browser: string;
}

let lastReplyAt = 0;
let lastReply: BrainReply | null = null;
/** Id of the brain alert currently shown as an in-page overlay (only when the desktop buddy is offline). */
let shownAlertId: number | null = null;

export function resetBrainForTests(): void {
  lastReplyAt = 0;
  lastReply = null;
  shownAlertId = null;
}

export const getShownAlert = (): number | null => shownAlertId;
export function setShownAlert(id: number | null): void {
  shownAlertId = id;
}

export function brainOnline(now = Date.now()): boolean {
  return lastReply !== null && now - lastReplyAt < BRAIN_FRESH_MS;
}

export function lastBrainReply(): BrainReply | null {
  return lastReply;
}

/** Validate the backend reply; anything unexpected counts as "brain offline". */
export function parseReply(raw: unknown): BrainReply | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r["buddyOnline"] !== "boolean") return null;
  const v = r["verdict"] as Record<string, unknown> | null | undefined;
  const verdict =
    v && typeof v === "object" && (v["kind"] === "focus" || v["kind"] === "neutral" || v["kind"] === "distraction") &&
    typeof v["score"] === "number"
      ? {
          kind: v["kind"] as BrainVerdictKind,
          score: Math.max(0, Math.min(100, Math.round(v["score"] as number))),
          category: typeof v["category"] === "string" ? (v["category"] as string) : "Other",
          reason: typeof v["reason"] === "string" ? (v["reason"] as string) : "",
          source: typeof v["source"] === "string" ? (v["source"] as string) : "rule",
        }
      : null;
  const a = r["alert"] as Record<string, unknown> | null | undefined;
  const alert =
    a && typeof a === "object" && typeof a["id"] === "number" && typeof a["text"] === "string"
      ? {
          id: a["id"] as number,
          kind: String(a["kind"] ?? "distraction"),
          mood: String(a["mood"] ?? "alert"),
          title: String(a["title"] ?? ""),
          text: a["text"] as string,
          source: String(a["source"] ?? ""),
          actions: Array.isArray(a["actions"])
            ? (a["actions"] as unknown[])
                .filter((x): x is BrainAction => typeof x === "object" && x !== null && typeof (x as BrainAction).id === "string")
                .map((x) => ({ id: x.id, label: String(x.label ?? x.id) }))
            : [],
          alert: a["alert"] !== false,
          level: typeof a["level"] === "number" ? (a["level"] as number) : 1,
          label: String(a["label"] ?? ""),
        }
      : null;
  const commands = Array.isArray(r["commands"])
    ? (r["commands"] as unknown[]).filter(
        (c): c is { type: string; url?: string } => typeof c === "object" && c !== null && typeof (c as { type?: unknown }).type === "string",
      )
    : [];
  const p = r["profile"] as Record<string, unknown> | null | undefined;
  const profile =
    p && typeof p === "object" && typeof p["name"] === "string"
      ? {
          name: p["name"] as string,
          firstName: String(p["firstName"] ?? p["name"]),
          goals: Array.isArray(p["goals"]) ? (p["goals"] as unknown[]).map(String) : [],
          pace: String(p["pace"] ?? "balanced"),
        }
      : null;
  return { verdict, buddyOnline: r["buddyOnline"] as boolean, alert, commands, profile };
}

async function post(path: string, body: unknown): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BRAIN_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`brain responded ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function browserName(): string {
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands ?? [];
  const names = brands.map((b) => b.brand);
  if (names.some((n) => /Brave/i.test(n))) return "Brave Browser";
  if (names.some((n) => /Edge/i.test(n))) return "Microsoft Edge";
  return "Google Chrome";
}

/** Report the active tab. Returns the brain's judgement, or null when the brain is unreachable. */
export async function reportTab(sample: BrowserSample, now = Date.now()): Promise<BrainReply | null> {
  try {
    const reply = parseReply(await post("/api/browser/sample", sample));
    if (reply) {
      lastReply = reply;
      lastReplyAt = now;
    }
    return reply;
  } catch {
    return null;
  }
}

export async function brainAction(action: string, messageId?: number | null): Promise<boolean> {
  try {
    await post("/api/buddy/action", { action, messageId: messageId ?? null });
    return true;
  } catch {
    return false;
  }
}
