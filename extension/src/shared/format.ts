import type { NudgePayload } from "./types";

export function nudgeHeadline(p: Pick<NudgePayload, "hostname" | "goal" | "score">): string {
  return `Taking a break? ${p.hostname} doesn't align with '${p.goal}'. (Score: ${p.score}/100).`;
}

export function minutesLeftText(minutesLeft: number | null): string | null {
  if (minutesLeft === null) return null;
  return `${minutesLeft} min${minutesLeft === 1 ? "" : "s"} left in your Deep Work block.`;
}
