import type { BrainStatus, NudgePayload } from "../shared/types";
import { browserName, getShownAlert, reportTab, setShownAlert, type BrainReply } from "./brain";
import { hostnameOf } from "./heuristic";
import { hideNudge, showNudge } from "./nudge";
import { loadState, mutate } from "./state";

export interface TabInfo {
  id: number;
  url: string;
  title: string;
  audible: boolean;
  incognito: boolean;
}

/** Report a tab to Leo's brain and act on the reply (status, commands, overlay alerts). */
export async function syncTab(tab: TabInfo, focused: boolean, now = Date.now()): Promise<BrainReply | null> {
  const reply = await reportTab(
    { url: tab.url, title: tab.title, audible: tab.audible, focused, incognito: tab.incognito, tabId: tab.id, browser: browserName() },
    now,
  );
  await applyReply(reply, tab, now);
  return reply;
}

function statusOf(reply: BrainReply, tab: TabInfo, now: number): BrainStatus {
  return {
    online: true,
    buddyOnline: reply.buddyOnline,
    firstName: reply.profile?.firstName ?? null,
    goals: reply.profile?.goals ?? [],
    verdict: reply.verdict?.kind ?? null,
    label: hostnameOf(tab.url) || null,
    checkedAt: now,
  };
}

async function focusUrl(url: string): Promise<void> {
  const strip = (u: string) => u.split("#")[0];
  const tabs = await chrome.tabs.query({});
  const target = tabs.find((t) => t.url && strip(t.url) === strip(url)) ?? tabs.find((t) => t.url && hostnameOf(t.url) === hostnameOf(url));
  try {
    if (target?.id !== undefined) {
      await chrome.tabs.update(target.id, { active: true });
      if (target.windowId !== undefined) await chrome.windows.update(target.windowId, { focused: true });
    } else {
      await chrome.tabs.create({ url });
    }
  } catch {
    /* tab vanished */
  }
}

async function applyReply(reply: BrainReply | null, tab: TabInfo, now: number): Promise<void> {
  const before = (await loadState()).snapshot.brain;
  if (!reply) {
    if (before?.online) await mutate((s) => void (s.snapshot.brain = { ...before, online: false, checkedAt: now }));
    return;
  }
  const next = statusOf(reply, tab, now);
  const changed =
    !before || before.online !== next.online || before.buddyOnline !== next.buddyOnline || before.verdict !== next.verdict ||
    before.label !== next.label || before.firstName !== next.firstName || before.goals.join("|") !== next.goals.join("|");
  await mutate((s) => void (s.snapshot.brain = next), { broadcast: changed });

  for (const c of reply.commands) if (c.type === "focusUrl" && c.url) await focusUrl(c.url);

  const alert = reply.alert;
  if (alert && !reply.buddyOnline) {
    if (alert.id === getShownAlert()) return;
    const payload: NudgePayload = {
      score: reply.verdict?.score ?? 15,
      category: reply.verdict?.category ?? "Distraction",
      reasoning: reply.verdict?.reason ?? "",
      goal: reply.profile?.goals[0] ?? "your goal",
      url: tab.url,
      hostname: hostnameOf(tab.url) || tab.url,
      minutesLeft: null,
      brain: { id: alert.id, kind: alert.kind, title: alert.title, text: alert.text, level: alert.level, actions: alert.actions },
    };
    if (await showNudge(tab.id, payload)) {
      setShownAlert(alert.id);
      await mutate((s) => void (s.nudgeVisibleTabId = tab.id), { broadcast: false });
    }
  } else if (getShownAlert() !== null) {
    // resolved (back to work, snoozed) or the desktop buddy took over
    setShownAlert(null);
    const st = await loadState();
    if (st.nudgeVisibleTabId !== null) {
      await hideNudge(st.nudgeVisibleTabId);
      await mutate((s) => void (s.nudgeVisibleTabId = null), { broadcast: false });
    }
  }
}
