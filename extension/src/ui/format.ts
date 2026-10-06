export function clock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function minutesText(seconds: number): string {
  const m = Math.round(seconds / 60);
  return m < 1 ? `${Math.round(seconds)}s` : `${m}m`;
}

export type Tone = "productive" | "neutral" | "distraction";

export function toneFor(score: number): Tone {
  if (score >= 70) return "productive";
  if (score >= 40) return "neutral";
  return "distraction";
}

export const TONE_COLORS: Record<Tone, { stroke: string; text: string; chip: string }> = {
  productive: { stroke: "var(--lh-productive)", text: "text-heading", chip: "bg-tint-saffron text-ink" },
  neutral: { stroke: "var(--lh-neutral)", text: "text-heading", chip: "bg-surface text-ink border border-line" },
  distraction: { stroke: "var(--lh-distraction)", text: "text-heading", chip: "bg-tint-maroon text-heading" },
};
