import type { ClassifiedResult, ContextResetSummary, Settings } from "../shared/types";
import { LOW_SCORE_LIMIT } from "./constants";
import { hostnameOf, isBrowserInternal, shortGoal } from "./heuristic";
import { classify, generate } from "./llm-client";
import { getSnapshot, noteAiResult } from "./state";

type GroupColor = `${chrome.tabGroups.Color}`;

export const GROUP_COLORS: Record<string, GroupColor> = {
  Coding: "blue",
  Research: "cyan",
  Learning: "cyan",
  Planning: "purple",
  Communication: "green",
  Search: "grey",
  Browsing: "grey",
  Distraction: "red",
  Entertainment: "red",
  Social: "red",
  Video: "orange",
};

export const groupColorFor = (category: string): GroupColor => GROUP_COLORS[category] ?? "grey";

export interface TabLike {
  id?: number;
  url?: string;
  title?: string;
  windowId?: number;
}

export interface ClassifiedTab {
  tabId: number;
  windowId: number | undefined;
  url: string;
  title: string;
  result: ClassifiedResult;
}

/** Classify http(s) tabs with limited concurrency (cache first; heuristic once the LLM is down). */
export async function classifyTabs(tabs: TabLike[], settings: Settings, goal: string | null): Promise<ClassifiedTab[]> {
  const eligible = tabs.filter((t): t is TabLike & { id: number; url: string } =>
    t.id !== undefined && !!t.url && !isBrowserInternal(t.url));
  const out: ClassifiedTab[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < eligible.length) {
      const t = eligible[cursor++];
      if (!t) break;
      const snap = await getSnapshot();
      const outcome = await classify(
        { goal, url: t.url, title: t.title ?? "" },
        settings,
        { aiAvailable: snap.aiStatus === "online" },
      );
      await noteAiResult(outcome.aiOk);
      out.push({ tabId: t.id, windowId: t.windowId, url: t.url, title: t.title ?? "", result: outcome.result });
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, eligible.length) }, worker));
  return out.sort((a, b) => a.tabId - b.tabId);
}

export function groupByCategory(items: { tabId: number; category: string }[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const it of items) map.set(it.category, [...(map.get(it.category) ?? []), it.tabId]);
  return map;
}

async function addToCategoryGroup(windowId: number, category: string, tabIds: number[]): Promise<void> {
  const existing = await chrome.tabGroups.query({ windowId, title: category });
  const found = existing[0];
  if (found) {
    await chrome.tabs.group({ groupId: found.id, tabIds: tabIds as [number, ...number[]] });
    return;
  }
  const groupId = await chrome.tabs.group({
    tabIds: tabIds as [number, ...number[]],
    createProperties: { windowId },
  });
  await chrome.tabGroups.update(groupId, { title: category, color: groupColorFor(category) as chrome.tabGroups.Color });
}

/** P1: group the current window's web tabs by category. One tabs.group call per category. */
export async function groupTabs(
  settings: Settings,
  goal: string | null,
): Promise<{ groups: number; tabsGrouped: number; failed?: number }> {
  const win = await chrome.windows.getCurrent();
  const windowId = win.id;
  if (windowId === undefined) return { groups: 0, tabsGrouped: 0 };
  const tabs = (await chrome.tabs.query({ windowId })).filter((t) => !t.pinned);
  const classified = await classifyTabs(tabs, settings, goal);
  const byCategory = groupByCategory(classified.map((c) => ({ tabId: c.tabId, category: c.result.category })));
  let tabsGrouped = 0;
  let groups = 0;
  let failed = 0;
  for (const [category, ids] of byCategory) {
    try {
      await addToCategoryGroup(windowId, category, ids);
      tabsGrouped += ids.length;
      groups += 1;
    } catch {
      failed += ids.length; // tab closed mid-way, etc.: keep grouping the other categories
    }
  }
  return failed > 0 ? { groups, tabsGrouped, failed } : { groups, tabsGrouped };
}

/** autoGroupTabs: file one freshly classified tab into its category group. */
export async function groupSingleTab(tab: { id: number; windowId: number }, category: string): Promise<void> {
  try {
    await addToCategoryGroup(tab.windowId, category, [tab.id]);
  } catch {
    /* tab closed or window gone */
  }
}

export function templateContextSummary(goal: string | null, tabs: ContextResetSummary["tabs"]): string {
  const relevant = tabs.filter((t) => t.relevant);
  const off = tabs.length - relevant.length;
  const cats = Object.entries(
    relevant.reduce<Record<string, number>>((acc, t) => ({ ...acc, [t.category]: (acc[t.category] ?? 0) + 1 }), {}),
  )
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([c]) => c.toLowerCase());
  const head = goal
    ? `You were working on "${shortGoal(goal, 10)}".`
    : "No goal is set, so here is a quick look at your tabs.";
  const body = tabs.length
    ? ` ${relevant.length} of ${tabs.length} open tabs look relevant${cats.length ? `, mostly ${cats.join(" and ")}` : ""}.`
    : " There are no open web tabs.";
  const tail = off > 0 ? ` ${off} ${off === 1 ? "tab looks" : "tabs look"} unrelated and can be closed to clear your head.` : "";
  return head + body + tail;
}

const CONTEXT_SYSTEM =
  "You help a user regain focus. From the goal and open tab titles, say in 1 or 2 plain sentences what the user was most likely doing. Be kind and concrete. No markdown.";

/** P0: summarize what the user was doing across all open tabs and suggest which to close. */
export async function buildContextReset(settings: Settings, goal: string | null): Promise<ContextResetSummary> {
  const all = (await chrome.tabs.query({})).slice(0, 60);
  // Never suggest closing a tab the user is looking at, has pinned, or is playing audio.
  const protectedIds = new Set(all.filter((t) => t.active || t.pinned || t.audible).map((t) => t.id));
  const classified = await classifyTabs(all, settings, goal);
  const tabs = classified.map((c) => ({
    tabId: c.tabId,
    title: c.title,
    url: c.url,
    score: c.result.score,
    category: c.result.category,
    relevant: c.result.score >= LOW_SCORE_LIMIT,
  }));
  const suggestedCloseTabIds = tabs.filter((t) => t.score < LOW_SCORE_LIMIT && !protectedIds.has(t.tabId)).map((t) => t.tabId);
  const snap = await getSnapshot();
  if (snap.aiStatus === "online" && tabs.length > 0) {
    try {
      const list = tabs
        .slice(0, 25)
        .map((t) => `- ${t.title.slice(0, 80)} (${hostnameOf(t.url)}) [${t.relevant ? "relevant" : "unrelated"}]`)
        .join("\n");
      const text = (
        await generate(settings, CONTEXT_SYSTEM, `Goal: ${goal ?? "not set"}\nOpen tabs:\n${list}\nSummary:`, {
          numPredict: 120,
          temperature: 0.2,
          timeoutMs: 20_000,
        })
      ).trim();
      if (text) return { goal, tabs, summary: text, suggestedCloseTabIds, generatedBy: "llm" };
    } catch {
      await noteAiResult(false);
    }
  }
  return { goal, tabs, summary: templateContextSummary(goal, tabs), suggestedCloseTabIds, generatedBy: "heuristic" };
}
