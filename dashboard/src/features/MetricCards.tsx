import type { ReactNode } from "react";
import { Card } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { formatDuration, formatPercent } from "../lib/format";
import { cn } from "../lib/utils";
import type { DailySummaryResponse } from "../lib/types";

type Tone = "productive" | "distraction" | "neutral";

const toneClasses: Record<Tone, { value: string; icon: string }> = {
  productive: { value: "text-accent", icon: "bg-tint-saffron text-ink" },
  distraction: { value: "text-heading", icon: "bg-tint-maroon text-heading" },
  neutral: { value: "text-ink", icon: "bg-bg text-muted" },
};

interface MetricProps {
  label: string;
  value: string;
  hint: string;
  tone: Tone;
  icon: ReactNode;
}

function Metric({ label, value, hint, tone, icon }: MetricProps) {
  return (
    <Card className="p-5" data-tone={tone} data-testid={`metric-${label}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-muted">{label}</p>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", toneClasses[tone].icon)} aria-hidden="true">
          {icon}
        </span>
      </div>
      <p className={cn("mt-3 font-serif text-[30px] leading-9 font-semibold tabular-nums", toneClasses[tone].value)}>{value}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </Card>
  );
}

const svgProps = {
  width: 16,
  height: 16,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

const icons = {
  clock: (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  ),
  alert: (
    <svg {...svgProps}>
      <path d="M12 3l10 18H2z" />
      <path d="M12 10v4M12 17.5v.01" />
    </svg>
  ),
  target: (
    <svg {...svgProps}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
    </svg>
  ),
  shuffle: (
    <svg {...svgProps}>
      <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
    </svg>
  ),
};

export function MetricCards({ summary, loading }: { summary: DailySummaryResponse | null; loading: boolean }) {
  if (loading || !summary) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-busy="true" aria-label="Loading metrics">
        {Array.from({ length: 4 }, (_, i) => (
          <Card key={i} className="p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="mt-4 h-8 w-28" />
            <Skeleton className="mt-3 h-3 w-32" />
          </Card>
        ))}
      </div>
    );
  }
  const total = summary.totalActiveSeconds;
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Metric
        label="Active time"
        value={formatDuration(summary.activeSeconds)}
        hint={`${formatPercent(summary.activeSeconds, total)} of tracked time`}
        tone="productive"
        icon={icons.clock}
      />
      <Metric
        label="Distraction time"
        value={formatDuration(summary.distractionSeconds)}
        hint={`${formatPercent(summary.distractionSeconds, total)} of tracked time`}
        tone="distraction"
        icon={icons.alert}
      />
      <Metric
        label="Avg focus score"
        value={summary.averageFocusScore.toFixed(1)}
        hint="Duration-weighted, out of 100"
        tone="neutral"
        icon={icons.target}
      />
      <Metric
        label="Context switches"
        value={String(summary.contextSwitches)}
        hint="Changes between sites"
        tone="neutral"
        icon={icons.shuffle}
      />
    </div>
  );
}
