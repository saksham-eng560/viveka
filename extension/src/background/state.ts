import { DEFAULT_SETTINGS } from "../shared/config";
import { MSG } from "../shared/messages";
import type { AppStateSnapshot, Settings, StoredState } from "../shared/types";

export const STATE_KEY = "lighthouse_state";

export function defaultSnapshot(): AppStateSnapshot {
  return {
    currentGoal: null,
    sessionStartTime: null,
    sessionDurationMinutes: null,
    currentFocusScore: 50,
    sessionAverageScore: 0,
    currentTab: null,
    recentDistractions: [],
    lowScoreSince: null,
    aiStatus: "online",
    awStatus: "online",
    bufferedEvents: 0,
    settings: { ...DEFAULT_SETTINGS },
    lastReceipt: null,
    brain: null,
  };
}

export function defaultStored(): StoredState {
  return { snapshot: defaultSnapshot(), session: null, cooldownUntil: 0, nudgeVisibleTabId: null };
}

let current: StoredState | null = null;
let loading: Promise<StoredState> | null = null;
let writeChain: Promise<void> = Promise.resolve();

/** Test hook: forget the in-memory copy. */
export function resetStateForTests(): void {
  current = null;
  loading = null;
  writeChain = Promise.resolve();
}

export async function loadState(): Promise<StoredState> {
  if (current) return current;
  loading ??= (async () => {
    const raw = (await chrome.storage.local.get(STATE_KEY))[STATE_KEY] as Partial<StoredState> | undefined;
    const base = defaultStored();
    const merged: StoredState = {
      ...base,
      ...raw,
      snapshot: {
        ...base.snapshot,
        ...(raw?.snapshot ?? {}),
        settings: { ...DEFAULT_SETTINGS, ...(raw?.snapshot?.settings ?? {}) },
      },
    };
    current = merged;
    return merged;
  })();
  return loading;
}

function persist(state: StoredState): void {
  const copy = JSON.parse(JSON.stringify(state)) as StoredState;
  writeChain = writeChain
    .then(() => chrome.storage.local.set({ [STATE_KEY]: copy }))
    .catch(() => undefined);
}

export function snapshotOf(state: StoredState): AppStateSnapshot {
  return JSON.parse(JSON.stringify(state.snapshot)) as AppStateSnapshot;
}

function broadcast(state: StoredState): void {
  try {
    const p = chrome.runtime.sendMessage({ type: MSG.STATE_UPDATED, state: snapshotOf(state) });
    // No receiver (panel closed) rejects; that is expected.
    Promise.resolve(p).catch(() => undefined);
  } catch {
    /* no receivers */
  }
}

/** Mutate state, persist it and broadcast a STATE_UPDATED snapshot to UI pages. */
export async function mutate(fn: (s: StoredState) => void, opts: { broadcast?: boolean } = {}): Promise<StoredState> {
  const state = await loadState();
  fn(state);
  persist(state);
  if (opts.broadcast !== false) broadcast(state);
  return state;
}

export async function getSnapshot(): Promise<AppStateSnapshot> {
  return snapshotOf(await loadState());
}

export async function getSettings(): Promise<Settings> {
  return { ...(await loadState()).snapshot.settings };
}

export function sanitizeSettings(patch: Partial<Settings>, prev: Settings): Settings {
  const next: Settings = { ...prev };
  const url = (v: unknown, fb: string) =>
    typeof v === "string" && /^https?:\/\//.test(v.trim()) ? v.trim().replace(/\/+$/, "") : fb;
  const int = (v: unknown, fb: number, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fb;
  if (patch.ollamaUrl !== undefined) next.ollamaUrl = url(patch.ollamaUrl, prev.ollamaUrl);
  if (patch.awUrl !== undefined) next.awUrl = url(patch.awUrl, prev.awUrl);
  if (typeof patch.model === "string" && patch.model.trim()) next.model = patch.model.trim();
  if (patch.nudgeThresholdSeconds !== undefined)
    next.nudgeThresholdSeconds = int(patch.nudgeThresholdSeconds, prev.nudgeThresholdSeconds, 5, 3600);
  if (patch.nudgeCooldownSeconds !== undefined)
    next.nudgeCooldownSeconds = int(patch.nudgeCooldownSeconds, prev.nudgeCooldownSeconds, 10, 7200);
  if (typeof patch.demoMode === "boolean") next.demoMode = patch.demoMode;
  if (typeof patch.voiceNudges === "boolean") next.voiceNudges = patch.voiceNudges;
  if (typeof patch.autoGroupTabs === "boolean") next.autoGroupTabs = patch.autoGroupTabs;
  return next;
}

/** Record an LLM outcome: true/false flips the badge; null (LLM not involved) is ignored. */
export async function noteAiResult(aiOk: boolean | null): Promise<void> {
  if (aiOk === null) return;
  const status = aiOk ? "online" : "heuristic";
  const st = await loadState();
  if (st.snapshot.aiStatus !== status) await mutate((s) => void (s.snapshot.aiStatus = status));
}
