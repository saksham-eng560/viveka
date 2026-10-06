import type { TimelineEvent } from "./types";

export interface TimelineBin {
  /** Bin start, epoch ms. */
  start: number;
  /** Duration-weighted mean focus score within the bin, or null if no activity. */
  score: number | null;
  seconds: number;
}

/**
 * Bin events into fixed-width buckets. Events spanning bin boundaries are split
 * proportionally, so each bin's score is the duration-weighted mean of the
 * overlapping portions. Bins between the first and last event are included
 * (null score when idle) so the chart shows gaps.
 */
export function binTimeline(events: TimelineEvent[], binMinutes = 5): TimelineBin[] {
  const binMs = Math.max(1, binMinutes) * 60_000;
  const spans = events
    .map((e) => {
      const start = Date.parse(e.timestamp);
      return { start, end: start + e.durationSeconds * 1000, score: e.score };
    })
    .filter((s) => Number.isFinite(s.start) && s.end > s.start);
  if (spans.length === 0) return [];

  const min = Math.min(...spans.map((s) => s.start));
  const max = Math.max(...spans.map((s) => s.end));
  const first = Math.floor(min / binMs) * binMs;
  const count = Math.ceil((max - first) / binMs);

  const weighted = new Array<number>(count).fill(0);
  const ms = new Array<number>(count).fill(0);

  for (const s of spans) {
    let i = Math.floor((s.start - first) / binMs);
    while (i < count) {
      const bStart = first + i * binMs;
      const bEnd = bStart + binMs;
      if (bStart >= s.end) break;
      const overlap = Math.min(s.end, bEnd) - Math.max(s.start, bStart);
      if (overlap > 0) {
        weighted[i] += overlap * s.score;
        ms[i] += overlap;
      }
      i++;
    }
  }

  return Array.from({ length: count }, (_, i) => ({
    start: first + i * binMs,
    score: ms[i] > 0 ? Math.round((weighted[i] / ms[i]) * 10) / 10 : null,
    seconds: Math.round(ms[i] / 1000),
  }));
}
