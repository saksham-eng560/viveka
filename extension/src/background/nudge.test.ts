import { describe, expect, it, vi } from "vitest";
import { installChrome } from "../test/chrome-mock";
import { DEFAULT_SETTINGS } from "../shared/config";
import { MSG } from "../shared/messages";
import { nudgeHeadline } from "../shared/format";
import { evaluateNudge, handleNudgeAction, buildNudgePayload, pickReturnTab, shouldTriggerNudge, trackLowScore } from "./nudge";
import { loadState, mutate } from "./state";
import { nudgePhrase, speakNudge } from "./tts";

const T0 = 1_000_000;
const check = (over: Partial<Parameters<typeof shouldTriggerNudge>[0]> = {}) => ({
  lowScoreSince: T0,
  now: T0 + 61_000,
  thresholdSeconds: 60,
  cooldownUntil: 0,
  hasGoal: true,
  ...over,
});

describe("nudge decision", () => {
  it("fires after 60 s below 40 but not before", () => {
    expect(shouldTriggerNudge(check())).toBe(true);
    expect(shouldTriggerNudge(check({ now: T0 + 59_000 }))).toBe(false);
  });
  it("demo mode threshold of 5 s fires at 6 s", () => {
    expect(shouldTriggerNudge(check({ thresholdSeconds: 5, now: T0 + 6_000 }))).toBe(true);
    expect(shouldTriggerNudge(check({ thresholdSeconds: 5, now: T0 + 4_000 }))).toBe(false);
  });
  it("score >= 40 resets lowScoreSince; staying low keeps it", () => {
    expect(trackLowScore(null, 10, T0)).toBe(T0);
    expect(trackLowScore(T0, 10, T0 + 5000)).toBe(T0);
    expect(trackLowScore(T0, 40, T0 + 5000)).toBeNull();
    expect(trackLowScore(T0, 39, T0 + 5000)).toBe(T0);
  });
  it("respects cooldown and requires a goal", () => {
    expect(shouldTriggerNudge(check({ cooldownUntil: T0 + 120_000 }))).toBe(false);
    expect(shouldTriggerNudge(check({ hasGoal: false }))).toBe(false);
    expect(shouldTriggerNudge(check({ lowScoreSince: null }))).toBe(false);
  });
  it("builds the payload and the headline text", () => {
    const p = buildNudgePayload(
      { tabId: 1, url: "https://www.reddit.com/r/funny", title: "t", score: 10, category: "Distraction", reasoning: "r", source: "llm" },
      "Building a React dashboard",
      25,
    );
    expect(p).toMatchObject({ hostname: "reddit.com", minutesLeft: 25, score: 10 });
    expect(nudgeHeadline(p)).toBe("reddit.com may be drawing you away from 'Building a React dashboard'.");
  });
  it("pickReturnTab chooses the most recently used relevant tab", () => {
    const pick = pickReturnTab(
      [
        { tabId: 1, lastAccessed: 100, score: 90 },
        { tabId: 2, lastAccessed: 300, score: 20 },
        { tabId: 3, lastAccessed: 200, score: 75 },
        { tabId: 4, lastAccessed: 400, score: 95 },
      ],
      4,
    );
    expect(pick?.tabId).toBe(3);
    expect(pickReturnTab([{ tabId: 1, lastAccessed: 1, score: 59 }], null)).toBeNull();
  });
});

async function seedLowTab(demo = true) {
  await mutate((s) => {
    s.snapshot.currentGoal = "Building a React dashboard";
    s.snapshot.settings = { ...DEFAULT_SETTINGS, demoMode: demo };
    s.snapshot.currentTab = { tabId: 7, url: "https://reddit.com/r/funny", title: "funny", score: 10, category: "Distraction", reasoning: "r", source: "heuristic" };
    s.snapshot.lowScoreSince = T0;
  });
}

describe("evaluateNudge / actions", () => {
  it("sends TRIGGER_NUDGE once, then honors the cooldown", async () => {
    const mock = installChrome([{ id: 7, windowId: 1, url: "https://reddit.com/r/funny", title: "funny", active: true }]);
    await seedLowTab();
    expect(await evaluateNudge(T0 + 6_000)).toBe(true);
    const sent = vi.mocked(mock.api.tabs.sendMessage).mock.calls[0] as unknown as [number, { type: string; payload: { goal: string } }];
    expect(sent[0]).toBe(7);
    expect(sent[1].type).toBe(MSG.TRIGGER_NUDGE);
    expect(sent[1].payload.goal).toBe("Building a React dashboard");
    expect(await evaluateNudge(T0 + 12_000)).toBe(false);
    expect(mock.api.tabs.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("a failed send sets no cooldown and the next tick retries (R-2)", async () => {
    const mock = installChrome([{ id: 7, windowId: 1, url: "https://reddit.com/r/funny", title: "funny", active: true }]);
    mock.api.runtime.getManifest = vi.fn(() => ({ content_scripts: [] })) as never;
    await seedLowTab();
    mock.api.tabs.sendMessage = vi.fn(async () => { throw new Error("no receiver"); }) as never;
    expect(await evaluateNudge(T0 + 6_000)).toBe(false);
    const st = await loadState();
    expect(st.cooldownUntil).toBe(0);
    expect(st.nudgeVisibleTabId).toBeNull();
    mock.api.tabs.sendMessage = vi.fn(async () => undefined) as never;
    expect(await evaluateNudge(T0 + 7_000)).toBe(true);
    expect((await loadState()).cooldownUntil).toBeGreaterThan(T0 + 7_000);
  });

  it("reinjects the manifest content scripts and resends once (R-2)", async () => {
    const mock = installChrome([{ id: 7, windowId: 1, url: "https://reddit.com/r/funny", title: "funny", active: true }]);
    await seedLowTab();
    let calls = 0;
    mock.api.tabs.sendMessage = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("no receiver");
      return undefined;
    }) as never;
    expect(await evaluateNudge(T0 + 6_000)).toBe(true);
    expect(mock.api.scripting.executeScript).toHaveBeenCalledWith({ target: { tabId: 7 }, files: ["content.js"] });
    expect(mock.api.tabs.sendMessage).toHaveBeenCalledTimes(2);
    const st = await loadState();
    expect(st.nudgeVisibleTabId).toBe(7);
    expect(st.cooldownUntil).toBeGreaterThan(T0 + 6_000);
  });

  it("gives up without cooldown when reinjection fails (R-2)", async () => {
    const mock = installChrome([{ id: 7, windowId: 1, url: "https://reddit.com/r/funny", title: "funny", active: true }]);
    await seedLowTab();
    mock.api.tabs.sendMessage = vi.fn(async () => { throw new Error("no receiver"); }) as never;
    mock.api.scripting.executeScript = vi.fn(async () => { throw new Error("restricted"); }) as never;
    expect(await evaluateNudge(T0 + 6_000)).toBe(false);
    expect(mock.api.tabs.sendMessage).toHaveBeenCalledTimes(1);
    expect((await loadState()).cooldownUntil).toBe(0);
  });

  it("does not fire before the demo threshold", async () => {
    installChrome([{ id: 7, windowId: 1, url: "https://reddit.com", title: "x", active: true }]);
    await seedLowTab();
    expect(await evaluateNudge(T0 + 3_000)).toBe(false);
  });

  it("Back to Work activates the latest relevant tab and hides the overlay", async () => {
    const mock = installChrome([
      { id: 7, windowId: 1, url: "https://reddit.com/r/funny", title: "funny", active: true, lastAccessed: 900 },
      { id: 8, windowId: 1, url: "https://github.com/a/dashboard", title: "dashboard", lastAccessed: 500 },
      { id: 9, windowId: 2, url: "https://stackoverflow.com/q/1", title: "react question", lastAccessed: 800 },
    ]);
    await seedLowTab();
    await evaluateNudge(T0 + 6_000);
    mock.api.tabs.sendMessage = vi.fn(async () => undefined) as never;
    await handleNudgeAction("back_to_work", T0 + 7_000);
    expect(mock.api.tabs.update).toHaveBeenCalledWith(9, { active: true });
    expect(mock.api.windows.update).toHaveBeenCalledWith(2, { focused: true });
    expect(mock.api.tabs.sendMessage).toHaveBeenCalledWith(7, { type: MSG.HIDE_NUDGE });
  });

  it("Dismiss only hides and starts the cooldown", async () => {
    const mock = installChrome([{ id: 7, windowId: 1, url: "https://reddit.com", title: "x", active: true }]);
    await seedLowTab();
    await handleNudgeAction("dismiss", T0 + 7_000);
    expect(mock.api.tabs.update).not.toHaveBeenCalled();
    expect(await evaluateNudge(T0 + 8_000)).toBe(false);
  });
});

describe("tts", () => {
  it("speaks when voice is on and the tab is silent", async () => {
    const mock = installChrome([{ id: 1, windowId: 1, url: "https://a.com", title: "a", audible: false }]);
    expect(await speakNudge("Building a React dashboard", { ...DEFAULT_SETTINGS, voiceNudges: true }, 1)).toBe(true);
    expect(vi.mocked(mock.api.tts.speak).mock.calls[0]?.[0]).toBe(nudgePhrase("Building a React dashboard"));
  });
  it("stays quiet when voice is off or the tab is audible", async () => {
    const mock = installChrome([{ id: 1, windowId: 1, url: "https://a.com", title: "a", audible: true }]);
    expect(await speakNudge("g", { ...DEFAULT_SETTINGS, voiceNudges: true }, 1)).toBe(false);
    expect(await speakNudge("g", { ...DEFAULT_SETTINGS, voiceNudges: false }, 1)).toBe(false);
    expect(mock.api.tts.speak).not.toHaveBeenCalled();
  });
});
