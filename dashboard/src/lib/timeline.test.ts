import { describe, expect, it } from "vitest";
import { binTimeline } from "./timeline";
import type { TimelineEvent } from "./types";

const ev = (iso: string, durationSeconds: number, score: number): TimelineEvent => ({
  timestamp: iso,
  durationSeconds,
  url: "https://x.com",
  hostname: "x.com",
  title: "t",
  score,
  category: "Coding",
  reasoning: "",
  goal: null,
});

describe("binTimeline", () => {
  it("returns [] for empty input and zero-duration events", () => {
    expect(binTimeline([])).toEqual([]);
    expect(binTimeline([ev("2026-10-06T09:00:00Z", 0, 80)])).toEqual([]);
  });

  it("puts an event within one bin", () => {
    const bins = binTimeline([ev("2026-10-06T09:01:00Z", 120, 80)], 5);
    expect(bins).toHaveLength(1);
    expect(bins[0].score).toBe(80);
    expect(bins[0].seconds).toBe(120);
  });

  it("splits events across bin boundaries", () => {
    const bins = binTimeline([ev("2026-10-06T09:04:00Z", 120, 60)], 5);
    expect(bins).toHaveLength(2);
    expect(bins.map((b) => b.seconds)).toEqual([60, 60]);
    expect(bins[1].start - bins[0].start).toBe(300_000);
  });

  it("weights by duration", () => {
    const bins = binTimeline([ev("2026-10-06T09:00:00Z", 60, 100), ev("2026-10-06T09:01:00Z", 180, 20)], 5);
    expect(bins[0].score).toBe(40);
  });

  it("emits null-score bins for gaps", () => {
    const bins = binTimeline([ev("2026-10-06T09:00:00Z", 60, 90), ev("2026-10-06T09:12:00Z", 60, 10)], 5);
    expect(bins.map((b) => b.score)).toEqual([90, null, 10]);
  });
});
