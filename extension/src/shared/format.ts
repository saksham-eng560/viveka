import type { NudgePayload } from "./types";

export function nudgeHeadline(p: Pick<NudgePayload, "hostname" | "goal" | "score">): string {
  return `${p.hostname} may be drawing you away from '${p.goal}'.`;
}

export function minutesLeftText(minutesLeft: number | null): string | null {
  if (minutesLeft === null) return null;
  return `${minutesLeft} min${minutesLeft === 1 ? "" : "s"} left in your focus block.`;
}
