import { effectiveCooldownSeconds, effectiveThresholdSeconds } from "../shared/config";
import { MSG, type ContentMessage, type NudgeActionKind } from "../shared/messages";
import type { CurrentTab, NudgePayload } from "../shared/types";
import { LOW_SCORE_LIMIT } from "./constants";
import { heuristicClassify, hostnameOf, isBrowserInternal } from "./heuristic";
import { peekCache } from "./llm-client";
import { minutesLeft } from "./session";
import { loadState, mutate } from "./state";
import { speakNudge } from "./tts";

export const RETURN_MIN_SCORE = 60;

/** lowScoreSince bookkeeping: set when score<40, kept while low, cleared otherwise. */
export function trackLowScore(prev: number | null, score: number, now: number): number | null {
  return score < LOW_SCORE_LIMIT ? (prev ?? now) : null;
}

export interface NudgeCheck {
  lowScoreSince: number | null;
  now: number;
  thresholdSeconds: number;
  cooldownUntil: number;
  hasGoal: boolean;
}

export function shouldTriggerNudge(c: NudgeCheck): boolean {
  if (!c.hasGoal || c.lowScoreSince === null) return false;
  if (c.now < c.cooldownUntil) return false;
  return c.now - c.lowScoreSince > c.thresholdSeconds * 1000;
}

export function buildNudgePayload(tab: CurrentTab, goal: string, minsLeft: number | null): NudgePayload {
  return {
    score: tab.score,
    category: tab.category,
    reasoning: tab.reasoning,
    goal,
    url: tab.url,
    hostname: hostnameOf(tab.url) || tab.url,
    minutesLeft: minsLeft,
  };
}

export interface ReturnCandidate {
  tabId: number;
  windowId?: number;
  lastAccessed: number;
  score: number;
}

/** Most recently used tab that is clearly on-task (score >= 60). */
export function pickReturnTab(candidates: ReturnCandidate[], excludeTabId: number | null): ReturnCandidate | null {
  const ok = candidates.filter((c) => c.tabId !== excludeTabId && c.score >= RETURN_MIN_SCORE);
  ok.sort((a, b) => b.lastAccessed - a.lastAccessed);
  return ok[0] ?? null;
}

async function sendToTab(tabId: number, message: ContentMessage): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    return false; // no content script on this page (e.g. chrome:// or not yet injected)
  }
}

/** Inject the manifest content scripts into one tab (e.g. a tab opened before the extension was installed/reloaded). */
async function reinjectContentScript(tabId: number): Promise<boolean> {
  try {
    const files = chrome.runtime.getManifest().content_scripts?.flatMap((c) => c.js ?? []) ?? [];
    if (files.length === 0) return false;
    await chrome.scripting.executeScript({ target: { tabId }, files });
    return true;
  } catch {
    return false; // restricted page
  }
}

export const hideNudge = (tabId: number) => sendToTab(tabId, { type: MSG.HIDE_NUDGE });

let evaluating = false;

/** Fire the overlay when the user has been off-task past the threshold and no cooldown is active. */
export async function evaluateNudge(now = Date.now()): Promise<boolean> {
  if (evaluating) return false;
  evaluating = true;
  try {
    const st = await loadState();
    const snap = st.snapshot;
    const tab = snap.currentTab;
    if (!tab || !snap.currentGoal) return false;
    const due = shouldTriggerNudge({
      lowScoreSince: snap.lowScoreSince,
      now,
      thresholdSeconds: effectiveThresholdSeconds(snap.settings),
      cooldownUntil: st.cooldownUntil,
      hasGoal: true,
    });
    if (!due) return false;
    const goal = snap.currentGoal;
    const payload = buildNudgePayload(tab, goal, minutesLeft(st.session, now));
    const message: ContentMessage = { type: MSG.TRIGGER_NUDGE, payload };
    let sent = await sendToTab(tab.tabId, message);
    if (!sent && (await reinjectContentScript(tab.tabId))) sent = await sendToTab(tab.tabId, message);
    if (!sent) return false; // nudge not shown: no cooldown, so the next tick retries
    await mutate((s) => {
      s.cooldownUntil = now + effectiveCooldownSeconds(s.snapshot.settings) * 1000;
      s.nudgeVisibleTabId = tab.tabId;
    }, { broadcast: false });
    void speakNudge(goal, snap.settings, tab.tabId);
    return true;
  } finally {
    evaluating = false;
  }
}

async function collectReturnCandidates(goal: string | null): Promise<ReturnCandidate[]> {
  const tabs = await chrome.tabs.query({});
  const out: ReturnCandidate[] = [];
  for (const t of tabs) {
    if (t.id === undefined || !t.url || isBrowserInternal(t.url)) continue;
    const cached = await peekCache(goal, t.url);
    const score = (cached ?? heuristicClassify(goal, t.url, t.title ?? "")).score;
    out.push({ tabId: t.id, windowId: t.windowId, lastAccessed: t.lastAccessed ?? 0, score });
  }
  return out;
}

/** Overlay buttons. Both actions hide the overlay and start the cooldown. */
export async function handleNudgeAction(action: NudgeActionKind, now = Date.now()): Promise<void> {
  const st = await loadState();
  const fromTab = st.nudgeVisibleTabId ?? st.snapshot.currentTab?.tabId ?? null;
  if (action === "back_to_work") {
    const target = pickReturnTab(await collectReturnCandidates(st.snapshot.currentGoal), fromTab);
    if (target) {
      try {
        await chrome.tabs.update(target.tabId, { active: true });
        if (target.windowId !== undefined) await chrome.windows.update(target.windowId, { focused: true });
      } catch {
        /* tab vanished; the dismissal below still applies */
      }
    }
  }
  await mutate((s) => {
    s.cooldownUntil = now + effectiveCooldownSeconds(s.snapshot.settings) * 1000;
    s.nudgeVisibleTabId = null;
  }, { broadcast: false });
  if (fromTab !== null) await hideNudge(fromTab);
}

/** Existing tabs do not get manifest content scripts after install; inject them once. */
export async function injectContentScripts(): Promise<number> {
  const files = chrome.runtime.getManifest().content_scripts?.flatMap((c) => c.js ?? []) ?? [];
  if (files.length === 0) return 0;
  let injected = 0;
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  for (const t of tabs) {
    if (t.id === undefined) continue;
    try {
      await chrome.scripting.executeScript({ target: { tabId: t.id }, files });
      injected += 1;
    } catch {
      /* restricted page (e.g. Web Store) */
    }
  }
  return injected;
}
