import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { CategoryBreakdown } from "./features/CategoryBreakdown";
import { MetricCards } from "./features/MetricCards";
import { StandupGenerator } from "./features/StandupGenerator";
import { StatusBar } from "./features/StatusBar";
import { TimelineChart } from "./features/TimelineChart";
import { apiErrorMessage, getHealth, getSummary, getTimeline, localTimeZone } from "./lib/api";
import { toDateInputValue } from "./lib/format";
import type { DailySummaryResponse, HealthResponse, TimelineResponse } from "./lib/types";

export default function App() {
  const [date, setDate] = useState(() => toDateInputValue(new Date()));
  const [summary, setSummary] = useState<DailySummaryResponse | null>(null);
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  const load = useCallback(async (d: string) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    const tz = localTimeZone();
    const [s, t, h] = await Promise.allSettled([getSummary(d, tz), getTimeline(d, tz), getHealth()]);
    if (id !== reqId.current) return;
    if (h.status === "fulfilled") {
      setHealth(h.value);
      setHealthError(false);
    } else {
      setHealth(null);
      setHealthError(true);
    }
    if (s.status === "fulfilled" && t.status === "fulfilled") {
      setSummary(s.value);
      setTimeline(t.value);
    } else {
      setSummary(null);
      setTimeline(null);
      const failure = s.status === "rejected" ? s.reason : t.status === "rejected" ? t.reason : null;
      setError(apiErrorMessage(failure));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(date);
  }, [date, load]);

  const source = summary?.source ?? timeline?.source;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-zinc-200 bg-white/80 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/80">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-600 text-white shadow-sm" aria-hidden="true">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l3.5 6h-7zM9.5 9.5h5L16 22H8z" />
              </svg>
            </span>
            <div>
              <h1 className="text-base font-semibold leading-tight tracking-tight">Lighthouse Pulse</h1>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Your day, in focus</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {source === "sample" && <Badge variant="amber">Sample data</Badge>}
            <StatusBar health={health} error={healthError} />
            <label className="sr-only" htmlFor="date">
              Date
            </label>
            <input
              id="date"
              type="date"
              value={date}
              max={toDateInputValue(new Date())}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="h-9 rounded-xl border border-zinc-300 bg-white px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <Button variant="outline" size="sm" onClick={() => void load(date)} disabled={loading} aria-label="Refresh data">
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        {error && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            <div>
              <p className="font-semibold">Could not load your day</p>
              <p className="mt-0.5">{error}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => void load(date)}>
              Retry
            </Button>
          </div>
        )}

        {!error && !loading && summary && summary.totalActiveSeconds === 0 && (
          <Card className="p-6 text-center text-sm text-zinc-600 dark:text-zinc-300">
            No tracked activity for this day yet. Start a focus session with the Lighthouse extension.
          </Card>
        )}

        {!error && (
          <>
            <MetricCards summary={summary} loading={loading} />
            <TimelineChart events={timeline?.events ?? []} loading={loading} />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <CategoryBreakdown summary={summary} loading={loading} />
              <StandupGenerator date={date} />
            </div>
          </>
        )}
        {error && <StandupGenerator date={date} />}
      </main>

      <footer className="mx-auto max-w-6xl px-4 pb-8 text-center text-xs text-zinc-500 sm:px-6 dark:text-zinc-400">
        Local-first: your browsing data and AI run on this machine only.
      </footer>
    </div>
  );
}
