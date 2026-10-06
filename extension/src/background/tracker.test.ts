import { describe, expect, it, vi } from "vitest";
import { installChrome, jsonResponse } from "../test/chrome-mock";
import { DEFAULT_SETTINGS } from "../shared/config";
import { getSnapshot, loadState, mutate } from "./state";
import { endSession, refreshActiveTab, restoreTrackerFlags, resetTrackerForTests, setPaused, setUnfocused, startSession, tick } from "./tracker";

const GOAL = "Building a React dashboard for the hackathon";

function activate(mock: ReturnType<typeof installChrome>, id: number) {
  mock.tabs.forEach((t) => (t.active = t.id === id));
}

function stubNetwork(opts: { ollama: boolean; aw: boolean }) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    calls.push(url);
    if (url.includes("11434")) {
      if (!opts.ollama) throw new TypeError("403");
      return jsonResponse({ response: JSON.stringify({ score: 90, category: "Coding", reasoning: "Relevant." }), models: [] });
    }
    if (!opts.aw) throw new TypeError("down");
    return jsonResponse({});
  }));
  return calls;
}

describe("tracker (G1 demo flow with Ollama down)", () => {
  it("scores github high and reddit low, flags heuristic mode and goes offline for AW", async () => {
    const mock = installChrome([
      { id: 1, windowId: 1, url: "https://github.com/acme/app", title: "GitHub - acme/app", active: true },
      { id: 2, windowId: 1, url: "https://www.reddit.com/r/funny", title: "r/funny", active: false },
    ]);
    stubNetwork({ ollama: false, aw: false });
    await startSession(GOAL, 25);
    let snap = await getSnapshot();
    expect(snap.currentTab?.score).toBeGreaterThanOrEqual(85);
    expect(snap.currentTab?.category).toBe("Coding");
    expect(snap.aiStatus).toBe("heuristic");
    expect(snap.awStatus).toBe("offline");
    expect(snap.bufferedEvents).toBeGreaterThan(0);
    expect(snap.lowScoreSince).toBeNull();

    activate(mock, 2);
    await refreshActiveTab();
    snap = await getSnapshot();
    expect(snap.currentTab?.score).toBeLessThanOrEqual(15);
    expect(snap.lowScoreSince).not.toBeNull();
  });

  it("nudges after the demo threshold and records the nudge via tab message", async () => {
    const mock = installChrome([{ id: 2, windowId: 1, url: "https://www.reddit.com/r/funny", title: "r/funny", active: true }]);
    stubNetwork({ ollama: false, aw: true });
    await mutate((s) => void (s.snapshot.settings = { ...DEFAULT_SETTINGS, demoMode: true }));
    await startSession(GOAL, 25);
    const low = (await getSnapshot()).lowScoreSince!;
    await tick(low + 6_000);
    expect(mock.api.tabs.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("sends heartbeats to ActivityWatch when it is up", async () => {
    installChrome([{ id: 1, windowId: 1, url: "https://github.com/acme/app", title: "GitHub", active: true }]);
    const calls = stubNetwork({ ollama: false, aw: true });
    await startSession(GOAL, null);
    expect(calls.some((u) => u.includes("/heartbeat?pulsetime=30"))).toBe(true);
    expect((await getSnapshot()).awStatus).toBe("online");
  });

  it("pauses without ticking and ends a session with a receipt", async () => {
    installChrome([{ id: 1, windowId: 1, url: "https://github.com/acme/app", title: "GitHub", active: true }]);
    stubNetwork({ ollama: false, aw: true });
    await startSession(GOAL, 25);
    await setPaused(true);
    const before = (await loadState()).session?.lastAccountAt;
    await tick(Date.now() + 60_000);
    expect((await loadState()).session?.lastAccountAt).toBe(before);
    await setPaused(false);
    const receipt = await endSession(Date.now() + 90_000);
    expect(receipt.goal).toBe(GOAL);
    expect(receipt.generatedBy).toBe("template");
    const snap = await getSnapshot();
    expect(snap.currentGoal).toBeNull();
    expect(snap.lastReceipt?.goal).toBe(GOAL);
  });

  it("uses Ollama when reachable", async () => {
    installChrome([{ id: 1, windowId: 1, url: "https://example.com/", title: "Example", active: true }]);
    stubNetwork({ ollama: true, aw: true });
    await startSession(GOAL, null);
    const snap = await getSnapshot();
    expect(snap.currentTab).toMatchObject({ score: 90, source: "llm" });
    expect(snap.aiStatus).toBe("online");
  });
});

describe("tracker unfocused / persisted flags (R-1, R-7)", () => {
  it("skips heartbeat, accrual and nudges while no window is focused, then resets clocks on refocus", async () => {
    const mock = installChrome([{ id: 2, windowId: 1, url: "https://www.reddit.com/r/funny", title: "r/funny", active: true }]);
    const calls = stubNetwork({ ollama: false, aw: true });
    await mutate((s) => void (s.snapshot.settings = { ...DEFAULT_SETTINGS, demoMode: true }));
    await startSession(GOAL, 25);
    const low = (await getSnapshot()).lowScoreSince!;
    await setUnfocused(true);
    const before = (await loadState()).session?.lastAccountAt;
    const hbBefore = calls.filter((u) => u.includes("/heartbeat")).length;
    await tick(Date.now() + 3_600_000);
    expect(mock.api.tabs.sendMessage).not.toHaveBeenCalled();
    expect(calls.filter((u) => u.includes("/heartbeat")).length).toBe(hbBefore);
    expect((await loadState()).session?.lastAccountAt).toBe(before);
    // refreshing the tab while unfocused must not heartbeat either
    await refreshActiveTab({ force: true });
    expect(calls.filter((u) => u.includes("/heartbeat")).length).toBe(hbBefore);

    await setUnfocused(false);
    const st = await loadState();
    // the forced refresh re-stamps with the real clock; the point is no hour-long gap was credited
    expect(st.session?.lastAccountAt).toBeGreaterThanOrEqual(before!);
    expect(st.session?.distractedSeconds ?? 0).toBeLessThan(60);
    expect(st.snapshot.lowScoreSince).toBeGreaterThanOrEqual(low);
    expect(mock.api.tabs.sendMessage).not.toHaveBeenCalled();
  });

  it("persists paused/unfocused and restores them after a worker restart", async () => {
    installChrome([{ id: 1, windowId: 1, url: "https://github.com/acme/app", title: "GitHub", active: true }]);
    stubNetwork({ ollama: false, aw: true });
    await setPaused(true);
    await setUnfocused(true);
    resetTrackerForTests(); // simulates the service worker losing memory
    await restoreTrackerFlags();
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
    await refreshActiveTab({ force: true });
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.slice(calls).some((c) => String(c[0]).includes("/heartbeat"))).toBe(false);
    await setUnfocused(false);
    await setPaused(false);
    resetTrackerForTests();
    await restoreTrackerFlags();
    const before = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.length;
    await refreshActiveTab({ force: true });
    expect((globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls.slice(before).some((c) => String(c[0]).includes("/heartbeat"))).toBe(true);
  });

  it("does not heartbeat from refreshActiveTab while paused", async () => {
    installChrome([{ id: 1, windowId: 1, url: "https://github.com/acme/app", title: "GitHub", active: true }]);
    const calls = stubNetwork({ ollama: false, aw: true });
    await setPaused(true);
    await refreshActiveTab({ force: true });
    expect(calls.some((u) => u.includes("/heartbeat"))).toBe(false);
  });
});
