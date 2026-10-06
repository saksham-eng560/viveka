import { describe, expect, it, vi } from "vitest";
import { jsonResponse } from "../test/chrome-mock";
import { DEFAULT_SETTINGS } from "../shared/config";
import type { CurrentTab } from "../shared/types";
import { accrue, buildReceipt, minutesLeft, newSession, noteSwitch, sessionAverage, templateSummary } from "./session";

const tab = (score: number, category: string): CurrentTab => ({
  tabId: 1, url: "https://x.com", title: "t", score, category, reasoning: "r", source: "llm",
});

describe("session math", () => {
  it("accrues focused vs distracted seconds and a time-weighted average", () => {
    const t0 = 1_000_000;
    const s = newSession("Goal", 25, t0);
    accrue(s, tab(90, "Coding"), t0 + 20_000);
    accrue(s, tab(10, "Distraction"), t0 + 30_000);
    expect(s.focusedSeconds).toBe(20);
    expect(s.distractedSeconds).toBe(10);
    expect(sessionAverage(s)).toBe(63.3);
    expect(s.categories).toEqual({ Coding: 20, Distraction: 10 });
  });

  it("caps long gaps (e.g. worker sleep) and ignores paused time", () => {
    const s = newSession("G", null, 0);
    accrue(s, tab(90, "Coding"), 600_000);
    expect(s.focusedSeconds).toBe(30);
    accrue(s, tab(90, "Coding"), 610_000, true);
    expect(s.focusedSeconds).toBe(30);
  });

  it("counts hostname switches and computes minutes left", () => {
    const s = newSession("G", 25, 0);
    noteSwitch(s, "https://a.com/1");
    noteSwitch(s, "https://a.com/2");
    noteSwitch(s, "https://b.com/");
    expect(s.switches).toBe(1);
    expect(minutesLeft(s, 60_000)).toBe(24);
    expect(minutesLeft(s, 99 * 60_000)).toBe(0);
    expect(minutesLeft(newSession("G", null, 0), 1)).toBeNull();
  });
});

describe("receipt", () => {
  const stats = () => {
    const s = newSession("Ship the dashboard", 25, 0);
    accrue(s, tab(90, "Coding"), 30_000);
    s.lastAccountAt = 30_000;
    accrue(s, tab(90, "Coding"), 60_000);
    accrue(s, tab(10, "Distraction"), 90_000);
    return s;
  };

  it("uses the template when the LLM is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
    const r = await buildReceipt(stats(), 120_000, DEFAULT_SETTINGS);
    expect(r).toMatchObject({ goal: "Ship the dashboard", durationSeconds: 120, focusedSeconds: 60, distractedSeconds: 30, generatedBy: "template" });
    expect(r.averageScore).toBe(63);
    expect(r.summary).toContain("Ship the dashboard");
  });

  it("uses the LLM summary when available", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ response: "  Great focus today.  " })));
    const r = await buildReceipt(stats(), 120_000, DEFAULT_SETTINGS);
    expect(r).toMatchObject({ summary: "Great focus today.", generatedBy: "llm" });
  });

  it("template copy is non-punitive", () => {
    const text = templateSummary({
      goal: "G", startedAt: 0, endedAt: 1, durationSeconds: 1800, focusedSeconds: 1200, distractedSeconds: 600,
      averageScore: 70, topCategories: { Coding: 1200 }, switches: 4,
    });
    expect(text).toContain("totally normal");
  });
});
