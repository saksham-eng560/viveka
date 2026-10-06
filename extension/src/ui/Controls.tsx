import type { ReactNode } from "react";
import type { AppStateSnapshot } from "../shared/types";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm ${className}`}>{children}</section>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1.5">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-700">{label}</span>
        {hint && <span className="block text-xs text-slate-400">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full border-0 transition-colors ${checked ? "bg-indigo-600" : "bg-slate-300"}`}
      >
        <span
          className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
          style={{ transform: checked ? "translateX(20px)" : "translateX(0)" }}
        />
      </button>
    </label>
  );
}

export function StatusBadges({ state }: { state: AppStateSnapshot }) {
  const aiOnline = state.aiStatus === "online";
  const awOnline = state.awStatus === "online";
  return (
    <div className="flex flex-wrap gap-1.5">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
          aiOnline ? "bg-indigo-50 text-indigo-700" : "bg-amber-50 text-amber-700"
        }`}
        data-testid="ai-badge"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${aiOnline ? "bg-indigo-500" : "bg-amber-500"}`} />
        {aiOnline ? "Local AI online" : "AI offline – heuristic mode"}
      </span>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium ${
          awOnline ? "bg-slate-100 text-slate-600" : "bg-amber-50 text-amber-700"
        }`}
        data-testid="aw-badge"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${awOnline ? "bg-emerald-500" : "bg-amber-500"}`} />
        {awOnline ? "ActivityWatch online" : `ActivityWatch offline${state.bufferedEvents ? ` · ${state.bufferedEvents} buffered` : ""}`}
      </span>
    </div>
  );
}

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#4f46e5" />
      <path d="M10 8h4l1.4 9h-6.8L10 8z" fill="#fff" />
      <rect x="9.5" y="5.5" width="5" height="2.5" rx="0.6" fill="#fde047" />
      <rect x="9.3" y="11" width="5.4" height="1.6" fill="#f43f5e" />
    </svg>
  );
}
