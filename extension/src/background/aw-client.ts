import { AW_BUCKET_ID } from "../shared/config";
import type { AwEvent, LighthouseEventData } from "../shared/types";

export const AW_BUFFER_KEY = "lighthouse_aw_buffer";
export const AW_BUFFER_CAP = 1000;
export const PULSETIME_SECONDS = 30;
const MAX_BACKOFF_MS = 60_000;
const REQUEST_TIMEOUT_MS = 4000;

interface AwRuntime {
  buffer: AwEvent[];
  loaded: boolean;
  bucketReady: boolean;
  online: boolean;
  failures: number;
  nextAttemptAt: number;
  flushing: Promise<void> | null;
}

const rt: AwRuntime = {
  buffer: [],
  loaded: false,
  bucketReady: false,
  online: true,
  failures: 0,
  nextAttemptAt: 0,
  flushing: null,
};

export function resetAwClientForTests(): void {
  rt.buffer = [];
  rt.loaded = false;
  rt.bucketReady = false;
  rt.online = true;
  rt.failures = 0;
  rt.nextAttemptAt = 0;
  rt.flushing = null;
}

export interface AwStatus {
  online: boolean;
  buffered: number;
}

export const awStatus = (): AwStatus => ({ online: rt.online, buffered: rt.buffer.length });

async function load(): Promise<void> {
  if (rt.loaded) return;
  const raw = (await chrome.storage.local.get(AW_BUFFER_KEY))[AW_BUFFER_KEY] as AwEvent[] | undefined;
  rt.buffer = Array.isArray(raw) ? raw : [];
  rt.loaded = true;
}

async function save(): Promise<void> {
  await chrome.storage.local.set({ [AW_BUFFER_KEY]: rt.buffer });
}

async function request(url: string, init: RequestInit): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Creates the bucket if needed (idempotent: aw-server answers 304 when it exists). */
export async function ensureBucket(awUrl: string): Promise<boolean> {
  if (rt.bucketReady) return true;
  const res = await request(`${awUrl}/api/0/buckets/${AW_BUCKET_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: AW_BUCKET_ID,
      client: "lighthouse-extension",
      type: "web.tab.current",
      hostname: "lighthouse",
    }),
  });
  if (res.ok || res.status === 304) {
    rt.bucketReady = true;
    return true;
  }
  throw new Error(`aw-server bucket creation failed (${res.status})`);
}

export function buildEvent(at: number, data: LighthouseEventData): AwEvent {
  return { timestamp: new Date(at).toISOString(), duration: 0, data };
}

async function postHeartbeat(awUrl: string, event: AwEvent): Promise<void> {
  const res = await request(`${awUrl}/api/0/buckets/${AW_BUCKET_ID}/heartbeat?pulsetime=${PULSETIME_SECONDS}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(event),
  });
  if (!res.ok) throw new Error(`heartbeat failed (${res.status})`);
}

function dataChanged(a: LighthouseEventData, b: LighthouseEventData): boolean {
  return (
    a.url !== b.url ||
    a.title !== b.title ||
    a.audible !== b.audible ||
    a.goal_active !== b.goal_active ||
    a.ai_score !== b.ai_score ||
    a.ai_category !== b.ai_category
  );
}

/** Events for one heartbeat; double-heartbeat when data changed (prev at now-1ms, new at now). */
export function planHeartbeat(
  now: number,
  data: LighthouseEventData,
  prev: LighthouseEventData | null,
): AwEvent[] {
  if (prev && dataChanged(prev, data)) return [buildEvent(now - 1, prev), buildEvent(now, data)];
  return [buildEvent(now, data)];
}

/** Sends buffered events in order. Stops (and backs off) on first failure. */
export async function flush(awUrl: string, opts: { force?: boolean; now?: number } = {}): Promise<AwStatus> {
  await load();
  if (rt.flushing) {
    await rt.flushing;
    return awStatus();
  }
  const now = opts.now ?? Date.now();
  if (!opts.force && now < rt.nextAttemptAt) return awStatus();
  if (rt.buffer.length === 0 && rt.online) return awStatus();

  rt.flushing = (async () => {
    try {
      await ensureBucket(awUrl);
      while (rt.buffer.length > 0) {
        const next = rt.buffer[0];
        if (!next) break;
        await postHeartbeat(awUrl, next);
        rt.buffer.shift();
      }
      rt.online = true;
      rt.failures = 0;
      rt.nextAttemptAt = 0;
    } catch {
      rt.online = false;
      rt.bucketReady = false;
      rt.failures += 1;
      rt.nextAttemptAt = now + Math.min(MAX_BACKOFF_MS, 2000 * 2 ** (rt.failures - 1));
    }
    await save();
  })();
  try {
    await rt.flushing;
  } finally {
    rt.flushing = null;
  }
  return awStatus();
}

/** Queue events (capped, oldest dropped) and try to deliver them. */
export async function submit(awUrl: string, events: AwEvent[], now = Date.now()): Promise<AwStatus> {
  await load();
  rt.buffer.push(...events);
  if (rt.buffer.length > AW_BUFFER_CAP) rt.buffer.splice(0, rt.buffer.length - AW_BUFFER_CAP);
  await save();
  return flush(awUrl, { now });
}
