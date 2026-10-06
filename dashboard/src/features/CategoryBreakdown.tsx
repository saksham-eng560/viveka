import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Progress } from "../components/ui/progress";
import { Skeleton } from "../components/ui/skeleton";
import { formatDuration, formatPercent } from "../lib/format";
import type { DailySummaryResponse } from "../lib/types";

export function CategoryBreakdown({ summary, loading }: { summary: DailySummaryResponse | null; loading: boolean }) {
  const entries = summary ? Object.entries(summary.topCategories).sort((a, b) => b[1] - a[1]) : [];
  const max = entries.length ? entries[0][1] : 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Where your time went</CardTitle>
        <CardDescription>Top categories and the active versus distraction split.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading || !summary ? (
          <div className="space-y-3" aria-busy="true">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-6 w-full" />
            ))}
          </div>
        ) : (
          <>
            <div>
              <div className="mb-2 flex items-center justify-between text-xs font-medium">
                <span className="text-ink">
                  Active {formatDuration(summary.activeSeconds)} ({formatPercent(summary.activeSeconds, summary.totalActiveSeconds)})
                </span>
                <span className="text-heading">
                  Distraction {formatDuration(summary.distractionSeconds)} ({formatPercent(summary.distractionSeconds, summary.totalActiveSeconds)})
                </span>
              </div>
              <Progress
                label="Active versus distraction time"
                value={summary.totalActiveSeconds > 0 ? (summary.activeSeconds / summary.totalActiveSeconds) * 100 : 0}
                className="h-3 bg-distraction"
                indicatorClassName="bg-productive"
              />
            </div>

            {entries.length === 0 ? (
              <p className="text-sm text-muted">No categories yet.</p>
            ) : (
              <ul className="space-y-3">
                {entries.map(([name, seconds]) => (
                  <li key={name}>
                    <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate font-medium text-ink">{name}</span>
                      <span className="shrink-0 tabular-nums text-muted">{formatDuration(seconds)}</span>
                    </div>
                    <Progress label={`${name} time`} value={max > 0 ? (seconds / max) * 100 : 0} className="h-2" />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
