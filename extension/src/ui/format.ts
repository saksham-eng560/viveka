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
  productive: { stroke: "#4f46e5", text: "text-indigo-600", chip: "bg-indigo-50 text-indigo-700" },
  neutral: { stroke: "#64748b", text: "text-slate-600", chip: "bg-slate-100 text-slate-700" },
  distraction: { stroke: "#f43f5e", text: "text-rose-600", chip: "bg-rose-50 text-rose-700" },
};
