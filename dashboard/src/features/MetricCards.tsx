import type { ReactNode } from "react";
import { Card } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { formatDuration, formatPercent } from "../lib/format";
import { cn } from "../lib/utils";
import type { DailySummaryResponse } from "../lib/types";

type Tone = "indigo" | "rose" | "zinc";

const toneClasses: Record<Tone, { value: string; icon: string }> = {
  indigo: { value: "text-indigo-600 dark:text-indigo-400", icon: "bg-indigo-50 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300" },
  rose: { value: "text-rose-600 dark:text-rose-400", icon: "bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300" },
  zinc: { value: "text-zinc-900 dark:text-zinc-50", icon: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300" },
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
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
        <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", toneClasses[tone].icon)} aria-hidden="true">
          {icon}
        </span>
      </div>
      <p className={cn("mt-3 text-3xl font-semibold tracking-tight tabular-nums", toneClasses[tone].value)}>{value}</p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
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
        tone="indigo"
        icon={icons.clock}
      />
      <Metric
        label="Distraction time"
        value={formatDuration(summary.distractionSeconds)}
        hint={`${formatPercent(summary.distractionSeconds, total)} of tracked time`}
        tone="rose"
        icon={icons.alert}
      />
      <Metric
        label="Avg focus score"
        value={summary.averageFocusScore.toFixed(1)}
        hint="Duration-weighted, out of 100"
        tone="zinc"
        icon={icons.target}
      />
      <Metric
        label="Context switches"
        value={String(summary.contextSwitches)}
        hint="Changes between sites"
        tone="zinc"
        icon={icons.shuffle}
      />
    </div>
  );
}
