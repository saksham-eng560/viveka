import { useMemo } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Skeleton } from "../components/ui/skeleton";
import { formatClock } from "../lib/format";
import { binTimeline } from "../lib/timeline";
import type { TimelineEvent } from "../lib/types";

interface Props {
  events: TimelineEvent[];
  loading: boolean;
  /** IANA tz for axis labels; defaults to browser tz. */
  tz?: string;
}

export function TimelineChart({ events, loading, tz }: Props) {
  const data = useMemo(
    () => binTimeline(events, 5).map((b) => ({ t: b.start, score: b.score })),
    [events],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Focus timeline</CardTitle>
        <CardDescription>Average focus score in 5-minute bins. Below 40 counts as distraction.</CardDescription>
      </CardHeader>
      <CardContent>
        {loading ? (
          <Skeleton className="h-64 w-full" />
        ) : data.length === 0 ? (
          <div className="flex h-64 items-center justify-center rounded-(--lh-radius) border border-dashed border-line-strong text-sm text-muted">
            No activity tracked for this day.
          </div>
        ) : (
          <div className="h-64 w-full" role="img" aria-label={`Focus score timeline with ${data.length} five-minute bins`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--lh-border)" />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(v: number) => formatClock(v, tz)}
                  tick={{ fontSize: 11, fill: "var(--lh-muted)" }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={40}
                />
                <YAxis domain={[0, 100]} ticks={[0, 40, 100]} tick={{ fontSize: 11, fill: "var(--lh-muted)" }} tickLine={false} axisLine={false} />
                <Tooltip
                  labelFormatter={(v) => formatClock(Number(v), tz)}
                  formatter={(v) => [typeof v === "number" ? v.toFixed(1) : String(v), "Focus score"]}
                  contentStyle={{ borderRadius: 10, border: "1px solid var(--lh-border)", background: "var(--lh-surface)", color: "var(--lh-ink)", fontSize: 12 }}
                />
                <ReferenceLine y={40} stroke="var(--lh-distraction)" strokeDasharray="4 4" label={{ value: "Distraction < 40", position: "insideBottomRight", fill: "var(--lh-heading)", fontSize: 11 }} />
                <Area
                  type="monotone"
                  dataKey="score"
                  stroke="var(--lh-productive)"
                  strokeWidth={2}
                  fill="var(--lh-productive)"
                  fillOpacity={0.18}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
