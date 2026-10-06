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
          <div className="flex h-64 items-center justify-center rounded-xl border border-dashed border-zinc-300 text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
            No activity tracked for this day.
          </div>
        ) : (
          <div className="h-64 w-full" role="img" aria-label={`Focus score timeline with ${data.length} five-minute bins`}>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
                <defs>
                  <linearGradient id="focusFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4f46e5" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="#4f46e5" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#a1a1aa" strokeOpacity={0.25} />
                <XAxis
                  dataKey="t"
                  type="number"
                  scale="time"
                  domain={["dataMin", "dataMax"]}
                  tickFormatter={(v: number) => formatClock(v, tz)}
                  tick={{ fontSize: 11, fill: "#71717a" }}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={40}
                />
                <YAxis domain={[0, 100]} ticks={[0, 40, 100]} tick={{ fontSize: 11, fill: "#71717a" }} tickLine={false} axisLine={false} />
                <Tooltip
                  labelFormatter={(v) => formatClock(Number(v), tz)}
                  formatter={(v) => [typeof v === "number" ? v.toFixed(1) : String(v), "Focus score"]}
                  contentStyle={{ borderRadius: 12, border: "1px solid #e4e4e7", fontSize: 12 }}
                />
                <ReferenceLine y={40} stroke="#e11d48" strokeDasharray="4 4" label={{ value: "Distraction < 40", position: "insideBottomRight", fill: "#e11d48", fontSize: 11 }} />
                <Area
                  type="monotone"
                  dataKey="score"
                  stroke="#4f46e5"
                  strokeWidth={2}
                  fill="url(#focusFill)"
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
