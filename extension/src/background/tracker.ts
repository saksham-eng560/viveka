import { effectiveThresholdSeconds } from "../shared/config";
import type { CurrentTab, LighthouseEventData, SessionReceipt } from "../shared/types";
import { flush, planHeartbeat, submit } from "./aw-client";
import { syncTab } from "./brain-sync";
import { LOW_SCORE_LIMIT } from "./constants";
import { classify, probeOllama } from "./llm-client";
import { evaluateNudge, hideNudge, trackLowScore } from "./nudge";
import { accrue, buildReceipt, newSession, noteSwitch, sessionAverage } from "./session";
import { getSettings, getSnapshot, loadState, mutate, noteAiResult } from "./state";
import { groupSingleTab } from "./tabs";

export const HEARTBEAT_INTERVAL_MS = 10_000;
export const PROBE_INTERVAL_MS = 30_000;
const MAX_DISTRACTIONS = 20;

interface TrackerRuntime {
  paused: boolean;
  /** True while no browser window has focus (user is in another app). */
  unfocused: boolean;
  lastHeartbeatAt: number;
  lastData: LighthouseEventData | null;
  lastProbeAt: number;
  lowTimer: ReturnType<typeof setTimeout> | null;
  refreshing: Promise<void> | null;
}

const rt: TrackerRuntime = {
  paused: false,
  unfocused: false,
  lastHeartbeatAt: 0,
  lastData: null,
  lastProbeAt: 0,
  lowTimer: null,
  refreshing: null,
};

export function resetTrackerForTests(): void {
  if (rt.lowTimer) clearTimeout(rt.lowTimer);
  rt.paused = false;
  rt.unfocused = false;
  rt.lastHeartbeatAt = 0;
  rt.lastData = null;
  rt.lastProbeAt = 0;
  rt.lowTimer = null;
  rt.refreshing = null;
}

export const isPaused = () => rt.paused;
const isInactive = () => rt.paused || rt.unfocused;

const FLAGS_KEY = "lighthouse_tracker_flags";
/** chrome.storage.session clears on browser restart; fall back to local where it is unavailable. */
const flagStore = () => chrome.storage.session ?? chrome.storage.local;

async function persistFlags(): Promise<void> {
  try {
    await flagStore().set({ [FLAGS_KEY]: { paused: rt.paused, unfocused: rt.unfocused } });
  } catch {
    /* best effort: flags only protect against a service-worker restart */
  }
}

/** Restore paused/unfocused after a service-worker restart (call before the first refresh). */
export async function restoreTrackerFlags(): Promise<void> {
  try {
    const got = (await flagStore().get(FLAGS_KEY))[FLAGS_KEY] as { paused?: unknown; unfocused?: unknown } | undefined;
    rt.paused = got?.paused === true;
    rt.unfocused = got?.unfocused === true;
  } catch {
    /* keep defaults */
  }
}

function scheduleLowTimer(lowSince: number | null, thresholdSeconds: number, now: number): void {
  if (rt.lowTimer) clearTimeout(rt.lowTimer);
  rt.lowTimer = null;
  if (lowSince === null) return;
  const delay = Math.max(0, lowSince + thresholdSeconds * 1000 - now) + 250;
  rt.lowTimer = setTimeout(() => {
    if (!isInactive()) void evaluateNudge();
  }, delay);
}

async function heartbeat(now: number): Promise<void> {
  const snap = await getSnapshot();
  const cur = snap.currentTab;
  if (!cur) return;
  let audible = false;
  let incognito = false;
  let tabCount = 1;
  try {
    const t = await chrome.tabs.get(cur.tabId);
    audible = !!t.audible;
    incognito = !!t.incognito;
    tabCount = (await chrome.tabs.query({ windowId: t.windowId })).length;
  } catch {
    /* tab closed between events */
  }
  const data: LighthouseEventData = {
    url: cur.url,
    title: cur.title,
    audible,
    incognito,
    tabCount,
    goal_active: snap.currentGoal,
    ai_score: cur.score,
    ai_category: cur.category,
    ai_reasoning: cur.reasoning,
    ai_source: cur.source,
  };
  const events = planHeartbeat(now, data, rt.lastData);
  rt.lastData = data;
  rt.lastHeartbeatAt = now;
  const status = await submit(snap.settings.awUrl, events, now);
  const awStatus = status.online ? "online" : "offline";
  if (snap.awStatus !== awStatus || snap.bufferedEvents !== status.buffered) {
    await mutate((s) => {
      s.snapshot.awStatus = awStatus;
      s.snapshot.bufferedEvents = status.buffered;
    });
  }
}

interface ActiveTab {
  id: number;
  url: string;
  title: string;
  windowId: number;
  groupId: number;
  audible: boolean;
  incognito: boolean;
}

async function queryActive(): Promise<ActiveTab | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || tab.id === undefined || !tab.url) return null;
  return {
    id: tab.id,
    url: tab.url,
    title: tab.title ?? "",
    windowId: tab.windowId,
    groupId: tab.groupId ?? -1,
    audible: !!tab.audible,
    incognito: !!tab.incognito,
  };
}

async function applyTab(tab: ActiveTab, force: boolean): Promise<void> {
  const st = await loadState();
  const snap = st.snapshot;
  const prev = snap.currentTab;
  const stripHashUrl = (u: string) => u.split("#")[0];
  const unchanged =
    prev && prev.tabId === tab.id && stripHashUrl(prev.url) === stripHashUrl(tab.url) && prev.title === tab.title;
  if (unchanged && !force) return;

  // Sheru's brain judges against the onboarding goals when it is running; otherwise classify locally.
  const reply = await syncTab(tab, !isInactive());
  let r: { score: number; category: string; reasoning: string; source: "llm" | "heuristic" };
  if (reply?.verdict) {
    const v = reply.verdict;
    r = { score: v.score, category: v.category, reasoning: v.reason, source: v.source === "llm" ? "llm" : "heuristic" };
  } else {
    const settings = await getSettings();
    const outcome = await classify(
      { goal: snap.currentGoal, url: tab.url, title: tab.title },
      settings,
      { aiAvailable: snap.aiStatus === "online" },
    );
    await noteAiResult(outcome.aiOk);
    r = outcome.result;
  }
  const now = Date.now();
  const next: CurrentTab = {
    tabId: tab.id,
    url: tab.url,
    title: tab.title,
    score: r.score,
    category: r.category,
    reasoning: r.reasoning,
    source: r.source,
  };
  const tabChanged = !prev || prev.tabId !== tab.id || stripHashUrl(prev.url) !== stripHashUrl(tab.url);
  const hideOn = st.nudgeVisibleTabId !== null && (tabChanged || r.score >= LOW_SCORE_LIMIT) ? st.nudgeVisibleTabId : null;

  await mutate((s) => {
    const sn = s.snapshot;
    if (s.session) {
      accrue(s.session, prev, now, isInactive());
      if (tabChanged) noteSwitch(s.session, tab.url);
      sn.sessionAverageScore = sessionAverage(s.session);
    }
    if (prev && prev.score < LOW_SCORE_LIMIT && tabChanged && sn.lowScoreSince !== null) {
      const dur = Math.round((now - sn.lowScoreSince) / 1000);
      if (dur >= 5) {
        sn.recentDistractions = [
          { timestamp: sn.lowScoreSince, url: prev.url, durationSeconds: dur },
          ...sn.recentDistractions,
        ].slice(0, MAX_DISTRACTIONS);
      }
    }
    sn.currentTab = next;
    sn.currentFocusScore = r.score;
    sn.lowScoreSince = trackLowScore(sn.lowScoreSince, r.score, now);
    if (hideOn !== null) s.nudgeVisibleTabId = null;
  });
  if (hideOn !== null) await hideNudge(hideOn);

  const after = await getSnapshot();
  scheduleLowTimer(after.lowScoreSince, effectiveThresholdSeconds(after.settings), now);
  if (!isInactive()) await heartbeat(now);
  if (after.settings.autoGroupTabs && tabChanged && tab.groupId === -1 && r.category !== "Browser") {
    await groupSingleTab({ id: tab.id, windowId: tab.windowId }, r.category);
  }
}

/** Classify the currently active tab (cache first). Serialized so rapid events do not race. */
export function refreshActiveTab(opts: { force?: boolean } = {}): Promise<void> {
  const run = async () => {
    const tab = await queryActive();
    if (!tab) return;
    await applyTab(tab, opts.force ?? false);
  };
  rt.refreshing = (rt.refreshing ?? Promise.resolve()).then(run, run).catch(() => undefined);
  return rt.refreshing;
}

/** Keep Sheru's brain up to date with the active tab (also delivers its alerts and commands). */
async function pingBrain(cur: CurrentTab | null, focused: boolean): Promise<void> {
  if (!cur) return;
  try {
    const t = await chrome.tabs.get(cur.tabId);
    await syncTab({ id: cur.tabId, url: t.url ?? cur.url, title: t.title ?? cur.title, audible: !!t.audible, incognito: !!t.incognito }, focused);
  } catch {
    /* tab closed between events */
  }
}

/** Periodic work: session accounting, heartbeat, model probe, AW flush, nudge evaluation. */
export async function tick(now = Date.now()): Promise<void> {
  if (isInactive()) return;
  const snap = await getSnapshot();
  await pingBrain(snap.currentTab, true);
  const st = await loadState();
  if (st.session) {
    await mutate((s) => {
      if (!s.session) return;
      accrue(s.session, s.snapshot.currentTab, now);
      s.snapshot.sessionAverageScore = sessionAverage(s.session);
    });
  }
  if (snap.aiStatus === "heuristic" && now - rt.lastProbeAt >= PROBE_INTERVAL_MS) {
    rt.lastProbeAt = now;
    if (await probeOllama(snap.settings)) {
      await noteAiResult(true);
      await refreshActiveTab({ force: true });
    }
  }
  if (snap.currentTab && now - rt.lastHeartbeatAt >= HEARTBEAT_INTERVAL_MS - 500) {
    await heartbeat(now);
  } else if (snap.bufferedEvents > 0) {
    const status = await flush(snap.settings.awUrl, { now });
    await mutate((s) => {
      s.snapshot.awStatus = status.online ? "online" : "offline";
      s.snapshot.bufferedEvents = status.buffered;
    });
  }
  await evaluateNudge(now);
}

export async function setPaused(paused: boolean, now = Date.now()): Promise<void> {
  if (rt.paused === paused) return;
  const st = await loadState();
  if (paused) {
    if (st.session) await mutate((s) => void (s.session && accrue(s.session, s.snapshot.currentTab, now)), { broadcast: false });
    rt.paused = true;
    await persistFlags();
    return;
  }
  rt.paused = false;
  await persistFlags();
  await resumeClocks(now);
}

/** Restart session accounting and the nudge clock after an inactive stretch. */
async function resumeClocks(now: number): Promise<void> {
  await mutate((s) => {
    if (s.session) s.session.lastAccountAt = now;
    if (s.snapshot.lowScoreSince !== null) s.snapshot.lowScoreSince = now;
  });
  await refreshActiveTab({ force: true });
}

/** No browser window focused (user is in another app): stop heartbeats, accrual and nudges until focus returns. */
export async function setUnfocused(unfocused: boolean, now = Date.now()): Promise<void> {
  if (rt.unfocused === unfocused) return;
  if (unfocused) {
    const st = await loadState();
    if (st.session && !rt.paused) await mutate((s) => void (s.session && accrue(s.session, s.snapshot.currentTab, now)), { broadcast: false });
    rt.unfocused = true;
    if (rt.lowTimer) clearTimeout(rt.lowTimer);
    rt.lowTimer = null;
    await persistFlags();
    void pingBrain((await getSnapshot()).currentTab, false); // tell the brain the browser lost focus
    return;
  }
  rt.unfocused = false;
  await persistFlags();
  await resumeClocks(now);
}

export async function startSession(goal: string, durationMinutes: number | null, now = Date.now()) {
  const clean = goal.trim().slice(0, 200);
  if (!clean) throw new Error("Please enter a goal first.");
  const minutes = durationMinutes !== null && durationMinutes > 0 ? Math.round(durationMinutes) : null;
  await mutate((s) => {
    s.snapshot.currentGoal = clean;
    s.snapshot.sessionStartTime = now;
    s.snapshot.sessionDurationMinutes = minutes;
    s.snapshot.sessionAverageScore = 0;
    s.snapshot.lastReceipt = null;
    s.snapshot.lowScoreSince = null;
    s.session = newSession(clean, minutes, now);
    s.cooldownUntil = 0;
  });
  await refreshActiveTab({ force: true });
  return getSnapshot();
}

export async function setGoal(goal: string) {
  const clean = goal.trim().slice(0, 200);
  if (!clean) throw new Error("Please enter a goal first.");
  await mutate((s) => {
    s.snapshot.currentGoal = clean;
    if (s.session) s.session.goal = clean;
    s.snapshot.lowScoreSince = null;
  });
  await refreshActiveTab({ force: true });
  return getSnapshot();
}

export async function endSession(now = Date.now()): Promise<SessionReceipt> {
  const st = await loadState();
  if (!st.session) throw new Error("There is no active session to end.");
  accrue(st.session, st.snapshot.currentTab, now);
  const receipt = await buildReceipt(st.session, now, st.snapshot.settings, {
    aiAvailable: st.snapshot.aiStatus === "online",
  });
  const hideOn = st.nudgeVisibleTabId;
  await mutate((s) => {
    s.snapshot.lastReceipt = receipt;
    s.snapshot.currentGoal = null;
    s.snapshot.sessionStartTime = null;
    s.snapshot.sessionDurationMinutes = null;
    s.snapshot.lowScoreSince = null;
    s.session = null;
    s.nudgeVisibleTabId = null;
  });
  if (hideOn !== null) await hideNudge(hideOn);
  scheduleLowTimer(null, 0, now);
  return receipt;
}
