import { describe, expect, it, vi } from "vitest";
import { installChrome } from "../test/chrome-mock";
import { DEFAULT_SETTINGS } from "../shared/config";
import { mutate } from "./state";
import { buildContextReset, groupByCategory, groupColorFor, groupTabs, templateContextSummary } from "./tabs";

const GOAL = "Building a React dashboard for the hackathon";
const tabs = [
  { id: 1, windowId: 1, url: "https://github.com/a/b", title: "GitHub", active: true },
  { id: 2, windowId: 1, url: "https://github.com/a/c", title: "PR", active: false },
  { id: 3, windowId: 1, url: "https://www.reddit.com/r/funny", title: "funny", active: false },
  { id: 4, windowId: 1, url: "chrome://extensions", title: "Extensions", active: false },
];

async function offlineAi() {
  await mutate((s) => void (s.snapshot.aiStatus = "heuristic"));
}

describe("tab grouping", () => {
  it("calls tabs.group once per category and titles each group", async () => {
    const mock = installChrome(tabs);
    await offlineAi();
    const res = await groupTabs(DEFAULT_SETTINGS, GOAL);
    expect(res).toEqual({ groups: 2, tabsGrouped: 3 });
    expect(mock.api.tabs.group).toHaveBeenCalledTimes(2);
    const titles = vi.mocked(mock.api.tabGroups.update).mock.calls.map((c) => (c[1] as { title: string }).title).sort();
    expect(titles).toEqual(["Coding", "Distraction"]);
    expect(vi.mocked(mock.api.tabGroups.update).mock.calls.find((c) => (c[1] as { title: string }).title === "Distraction")?.[1]).toMatchObject({ color: "red" });
  });

  it("skips pinned tabs and survives one failing category, reporting partial counts (R-4)", async () => {
    const mock = installChrome([
      ...tabs,
      { id: 5, windowId: 1, url: "https://github.com/a/pinned", title: "pinned", pinned: true },
    ]);
    await offlineAi();
    const real = mock.api.tabs.group;
    let n = 0;
    mock.api.tabs.group = vi.fn(async (...a: Parameters<typeof real>) => {
      n += 1;
      if (n === 1) throw new Error("tab closed");
      return real(...a);
    }) as never;
    const res = await groupTabs(DEFAULT_SETTINGS, GOAL);
    expect(res).toEqual({ groups: 1, tabsGrouped: 1, failed: 2 });
    expect(mock.tabs.find((t) => t.id === 5)?.groupId).toBeUndefined();
  });

  it("groupByCategory and colors", () => {
    const m = groupByCategory([{ tabId: 1, category: "A" }, { tabId: 2, category: "B" }, { tabId: 3, category: "A" }]);
    expect(m.get("A")).toEqual([1, 3]);
    expect(groupColorFor("Unknown")).toBe("grey");
  });
});

describe("context reset", () => {
  it("falls back to a heuristic summary and suggests closing low-score tabs", async () => {
    installChrome(tabs);
    await offlineAi();
    const r = await buildContextReset(DEFAULT_SETTINGS, GOAL);
    expect(r.generatedBy).toBe("heuristic");
    expect(r.suggestedCloseTabIds).toEqual([3]);
    expect(r.tabs.find((t) => t.tabId === 3)?.relevant).toBe(false);
    expect(r.summary).toContain("Building a React dashboard");
  });

  it("never suggests closing active, pinned or audible tabs (R-3)", async () => {
    installChrome([
      { id: 1, windowId: 1, url: "https://github.com/a/b", title: "GitHub" },
      { id: 3, windowId: 1, url: "https://www.reddit.com/r/funny", title: "funny" },
      { id: 6, windowId: 1, url: "https://www.reddit.com/r/active", title: "active", active: true },
      { id: 7, windowId: 1, url: "https://www.reddit.com/r/pinned", title: "pinned", pinned: true },
      { id: 8, windowId: 1, url: "https://www.reddit.com/r/audible", title: "audible", audible: true },
    ]);
    await offlineAi();
    const r = await buildContextReset(DEFAULT_SETTINGS, GOAL);
    expect(r.suggestedCloseTabIds).toEqual([3]);
    expect(r.tabs.find((t) => t.tabId === 6)?.relevant).toBe(false);
  });

  it("template handles empty tab lists", () => {
    expect(templateContextSummary(null, [])).toContain("no open web tabs");
  });
});
