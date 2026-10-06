import { describe, expect, it, vi } from "vitest";
import { installChrome, jsonResponse } from "../test/chrome-mock";
import { brainOnline, getShownAlert, parseReply, resetBrainForTests } from "./brain";
import { evaluateNudge, handleNudgeAction } from "./nudge";
import { getSnapshot, mutate } from "./state";
import { refreshActiveTab, startSession, tick } from "./tracker";

const ALERT = {
  id: 7, kind: "distraction", mood: "alert", title: "Psst!", text: "Instagram is cute, but DSA is cuter.", source: "",
  actions: [{ id: "back_to_work", label: "Back to work" }, { id: "snooze", label: "2 more min" }], alert: true, level: 1, label: "Instagram",
};

function brainReply(over: Record<string, unknown> = {}) {
  return {
    verdict: { kind: "distraction", score: 15, category: "Social", reason: "You listed this as a usual distraction.", source: "profile" },
    buddyOnline: false,
    alert: null,
    commands: [],
    profile: { name: "Saksham", firstName: "Saksham", goals: ["Crack DSA"], pace: "demo" },
    ...over,
  };
}

function stubBrain(reply: () => unknown) {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (url.includes(":8000/")) return jsonResponse(reply());
    throw new TypeError("offline");
  }));
  return calls;
}

describe("brain reply parsing", () => {
  it("accepts a well-formed reply and clamps the score", () => {
    const r = parseReply({ ...brainReply({ alert: ALERT }), verdict: { kind: "focus", score: 140, category: "Coding", reason: "ok", source: "llm" } });
    expect(r?.verdict).toEqual({ kind: "focus", score: 100, category: "Coding", reason: "ok", source: "llm" });
    expect(r?.alert?.actions.map((a) => a.id)).toEqual(["back_to_work", "snooze"]);
    expect(r?.profile?.goals).toEqual(["Crack DSA"]);
  });

  it("treats anything unexpected as offline", () => {
    expect(parseReply({})).toBeNull();
    expect(parseReply(null)).toBeNull();
    expect(parseReply({ buddyOnline: true, verdict: { kind: "maybe", score: 3 } })?.verdict).toBeNull();
  });
});

describe("tracker with Sheru's brain online", () => {
  it("uses the brain verdict and reports tab details", async () => {
    installChrome([{ id: 3, windowId: 1, url: "https://www.instagram.com/reels/", title: "Instagram", active: true, audible: true }]);
    const calls = stubBrain(() => brainReply());
    await refreshActiveTab({ force: true });
    const snap = await getSnapshot();
    expect(snap.currentTab?.score).toBe(15);
    expect(snap.currentTab?.category).toBe("Social");
    expect(snap.brain).toMatchObject({ online: true, buddyOnline: false, firstName: "Saksham", verdict: "distraction", label: "instagram.com" });
    const sample = calls.find((c) => c.url.endsWith("/api/browser/sample"))?.body as Record<string, unknown>;
    expect(sample).toMatchObject({ url: "https://www.instagram.com/reels/", title: "Instagram", audible: true, focused: true, tabId: 3 });
    expect(brainOnline()).toBe(true);
  });

  it("shows the brain's alert in the tab only when the desktop buddy is offline", async () => {
    const mock = installChrome([{ id: 3, windowId: 1, url: "https://www.instagram.com/", title: "Instagram", active: true }]);
    let reply = brainReply({ alert: ALERT, buddyOnline: true });
    stubBrain(() => reply);
    await refreshActiveTab({ force: true });
    expect(mock.api.tabs.sendMessage).not.toHaveBeenCalled();

    reply = brainReply({ alert: ALERT, buddyOnline: false });
    await tick();
    expect(mock.api.tabs.sendMessage).toHaveBeenCalledTimes(1);
    const [, msg] = (mock.api.tabs.sendMessage as unknown as { mock: { calls: [number, { type: string; payload: { brain: { text: string } } }][] } }).mock.calls[0]!;
    expect(msg.type).toBe("TRIGGER_NUDGE");
    expect(msg.payload.brain.text).toContain("DSA is cuter");
    expect(getShownAlert()).toBe(7);

    await tick(); // same alert again: not re-sent
    expect(mock.api.tabs.sendMessage).toHaveBeenCalledTimes(1);

    reply = brainReply({ alert: null }); // resolved
    await tick();
    expect(mock.api.tabs.sendMessage).toHaveBeenLastCalledWith(3, { type: "HIDE_NUDGE" });
    expect(getShownAlert()).toBeNull();
  });

  it("forwards overlay button presses to the brain", async () => {
    installChrome([{ id: 3, windowId: 1, url: "https://www.instagram.com/", title: "Instagram", active: true }]);
    const calls = stubBrain(() => brainReply({ alert: ALERT }));
    await refreshActiveTab({ force: true });
    await handleNudgeAction("snooze");
    await vi.waitFor(() => expect(calls.some((c) => c.url.endsWith("/api/buddy/action"))).toBe(true));
    expect(calls.find((c) => c.url.endsWith("/api/buddy/action"))?.body).toEqual({ action: "snooze", messageId: 7 });
  });

  it("leaves nudging to the brain while it is online", async () => {
    installChrome([{ id: 3, windowId: 1, url: "https://www.reddit.com/r/funny", title: "r/funny", active: true }]);
    stubBrain(() => brainReply());
    await startSession("Write my thesis", 25);
    await mutate((s) => void (s.snapshot.lowScoreSince = Date.now() - 600_000));
    expect(await evaluateNudge()).toBe(false);
  });

  it("follows a focusUrl command from the brain", async () => {
    const mock = installChrome([
      { id: 3, windowId: 1, url: "https://www.instagram.com/", title: "Instagram", active: true },
      { id: 4, windowId: 2, url: "https://leetcode.com/problems/two-sum/", title: "Two Sum", active: false },
    ]);
    stubBrain(() => brainReply({ commands: [{ type: "focusUrl", url: "https://leetcode.com/problems/two-sum/#desc" }] }));
    await refreshActiveTab({ force: true });
    expect(mock.api.tabs.update).toHaveBeenCalledWith(4, { active: true });
    expect(mock.api.windows.update).toHaveBeenCalledWith(2, { focused: true });
  });

  it("falls back to the standalone engine when the brain is down", async () => {
    resetBrainForTests();
    installChrome([{ id: 1, windowId: 1, url: "https://github.com/acme/app", title: "GitHub", active: true }]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
    await startSession("Building a React dashboard", 25);
    const snap = await getSnapshot();
    expect(snap.currentTab?.category).toBe("Coding");
    expect(brainOnline()).toBe(false);
  });
});

describe("quick follow-ups for the gentle heads-up", () => {
  it("re-checks the brain a few seconds after landing on a distracting tab when the desktop buddy is off", async () => {
    installChrome([{ id: 3, windowId: 1, url: "https://www.instagram.com/", title: "Instagram", active: true }]);
    const calls = stubBrain(() => brainReply({ buddyOnline: false }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await refreshActiveTab({ force: true });
    const samples = () => calls.filter((c) => c.url.endsWith("/api/browser/sample")).length;
    const before = samples();
    await vi.advanceTimersByTimeAsync(3100);
    await vi.waitFor(() => expect(samples()).toBe(before + 1));
    await vi.advanceTimersByTimeAsync(3000);
    await vi.waitFor(() => expect(samples()).toBe(before + 2));
  });

  it("does not poll extra when the desktop buddy is on screen", async () => {
    installChrome([{ id: 3, windowId: 1, url: "https://www.instagram.com/", title: "Instagram", active: true }]);
    const calls = stubBrain(() => brainReply({ buddyOnline: true }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    await refreshActiveTab({ force: true });
    const before = calls.length;
    await vi.advanceTimersByTimeAsync(7000);
    expect(calls.length).toBe(before);
  });
});
