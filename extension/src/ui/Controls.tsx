import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { Quote } from "../shared/quotes";
import type { AppStateSnapshot } from "../shared/types";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-[10px] border border-line bg-surface p-4 text-ink ${className}`}
      style={{ boxShadow: "var(--lh-shadow)" }}
    >
      {children}
    </section>
  );
}

/** Serif section heading with a short saffron rule beneath. */
export function SectionTitle({ children, rule = true }: { children: ReactNode; rule?: boolean }) {
  return (
    <div className="mb-2">
      <h2 className="m-0 font-serif text-[17px] font-semibold leading-6 text-heading">{children}</h2>
      {rule && <div className="mt-1 h-px w-6" style={{ background: "var(--lh-saffron)" }} aria-hidden="true" />}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "ghost";

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    "border-0 bg-primary text-primary-fg hover:bg-[var(--lh-primary-hover)] disabled:opacity-50 disabled:cursor-not-allowed",
  secondary:
    "border border-line-strong bg-transparent text-ink hover:bg-surface disabled:opacity-50 disabled:cursor-not-allowed",
  ghost: "border-0 bg-transparent text-ink underline-offset-2 hover:underline disabled:opacity-50 disabled:cursor-not-allowed",
};

export function Button({
  variant = "secondary",
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type={type}
      className={`min-h-9 rounded-[8px] px-3 py-2 text-sm font-semibold transition-colors ${BUTTON_STYLES[variant]} ${className}`}
      {...rest}
    />
  );
}

/** Accessible on/off switch (44x24 track inside a 32px-high hit area). */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
  describedBy,
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
  describedBy?: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-disabled={disabled || undefined}
      aria-describedby={describedBy}
      title={title}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative flex h-8 w-11 shrink-0 items-center border-0 bg-transparent p-0 ${disabled ? "cursor-not-allowed opacity-[0.45]" : ""}`}
    >
      <span
        className={`block h-6 w-11 rounded-full transition-colors ${checked ? "bg-accent" : "bg-line-strong"}`}
        aria-hidden="true"
      />
      <span
        className="absolute left-0.5 top-1/2 -mt-[10px] h-5 w-5 rounded-full transition-transform"
        style={{ background: "var(--lh-knob)", transform: checked ? "translateX(20px)" : "translateX(0)" }}
        aria-hidden="true"
      />
    </button>
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
    <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </label>
  );
}

function Pill({ tone, dot, testId, children }: { tone: "neutral" | "warn"; dot: string; testId: string; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium leading-[15px] text-ink ${
        tone === "warn" ? "bg-tint-saffron" : "bg-surface"
      }`}
      data-testid={testId}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} aria-hidden="true" />
      {children}
    </span>
  );
}

export function StatusBadges({ state }: { state: AppStateSnapshot }) {
  const modelOnline = state.aiStatus === "online";
  const awOnline = state.awStatus === "online";
  return (
    <div className="flex flex-wrap gap-1.5">
      <Pill tone={modelOnline ? "neutral" : "warn"} dot={modelOnline ? "var(--lh-ok)" : "var(--lh-saffron)"} testId="model-badge">
        {modelOnline ? "Local model ready" : "Offline rules in use"}
      </Pill>
      <Pill tone={awOnline ? "neutral" : "warn"} dot={awOnline ? "var(--lh-ok)" : "var(--lh-saffron)"} testId="aw-badge">
        {awOnline ? "ActivityWatch online" : `ActivityWatch offline${state.bufferedEvents ? ` · ${state.bufferedEvents} buffered` : ""}`}
      </Pill>
    </div>
  );
}

/** Quiet inline notice (role=status). */
export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 rounded-[8px] bg-tint-saffron px-3 py-2 text-xs text-ink" role="status">
      {children}
    </p>
  );
}

/** Error block (role=alert). */
export function ErrorBlock({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 rounded-[8px] bg-tint-maroon px-3 py-2 text-xs text-heading" role="alert">
      {children}
    </p>
  );
}

export function QuoteBlock({ quote, size = "md" }: { quote: Quote; size?: "md" | "sm" }) {
  return (
    <figure className="m-0 border-0 border-l-[3px] border-solid pl-3" style={{ borderLeftColor: "var(--lh-saffron)" }} data-testid="quote">
      <blockquote
        className={`m-0 font-serif italic text-heading ${size === "sm" ? "text-sm leading-[21px]" : "text-[15px] leading-[23px]"}`}
      >
        {quote.text}
      </blockquote>
      <figcaption className="mt-1.5 text-[11px] leading-[15px] text-muted">— Swami Vivekananda, {quote.source}</figcaption>
    </figure>
  );
}

export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="12" fill="#7A2E1D" />
      <path d="M10 8h4l1.4 9h-6.8L10 8z" fill="#FBF3E4" />
      <rect x="9.5" y="5.5" width="5" height="2.5" rx="0.6" fill="#E8730C" />
      <rect x="9.3" y="11" width="5.4" height="1.6" fill="#B8860B" />
    </svg>
  );
}
