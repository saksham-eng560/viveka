import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { QuoteBlock } from "./components/ui/quote-block";
import { CategoryBreakdown } from "./features/CategoryBreakdown";
import { MetricCards } from "./features/MetricCards";
import { StandupGenerator } from "./features/StandupGenerator";
import { Onboarding } from "./features/Onboarding";
import { SheruPanel } from "./features/SheruPanel";
import { StatusBar } from "./features/StatusBar";
import { TimelineChart } from "./features/TimelineChart";
import { apiErrorMessage, getHealth, getProfile, getSummary, getTimeline, localTimeZone } from "./lib/api";
import { toDateInputValue } from "./lib/format";
import { quoteFor } from "./lib/quotes";
import type { DailySummaryResponse, HealthResponse, Profile, TimelineResponse } from "./lib/types";

const wantsOnboarding = () => new URLSearchParams(window.location.search).has("onboarding");

/** Root: first run (no profile) or ?onboarding=1 shows the onboarding; otherwise the dashboard. */
export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checked, setChecked] = useState(false);
  const [onboarding, setOnboarding] = useState(wantsOnboarding);

  useEffect(() => {
    getProfile()
      .then((r) => {
        setProfile(r.profile);
        if (!r.exists) setOnboarding(true);
      })
      .catch(() => undefined) // backend down: show the dashboard, which explains the problem
      .finally(() => setChecked(true));
  }, []);

  const closeOnboarding = (p: Profile | null) => {
    if (p) setProfile(p);
    setOnboarding(false);
    if (wantsOnboarding()) window.history.replaceState(null, "", window.location.pathname);
  };

  if (!checked) return <div className="min-h-screen" aria-busy="true" />;
  if (onboarding) {
    return <Onboarding initial={profile} onDone={(p) => closeOnboarding(p)} onCancel={profile ? () => closeOnboarding(null) : undefined} />;
  }
  return <Dashboard profile={profile} onProfile={setProfile} onEditGoals={() => setOnboarding(true)} />;
}

function Dashboard({ profile, onProfile, onEditGoals }: { profile: Profile | null; onProfile: (p: Profile) => void; onEditGoals: () => void }) {
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
      <header className="sticky top-0 z-10 border-b border-line bg-bg">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-(--lh-radius-sm) border border-line bg-[#FBF3E4]" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24">
                <path d="M12 2l3.5 6h-7z" fill="#7A2E1D" />
                <circle cx="12" cy="5.4" r="1.1" fill="#E8730C" />
                <path d="M9.5 9.5h5L16 22H8z" fill="#7A2E1D" />
                <path d="M9.9 13h4.2l.4 2.2H9.5z" fill="#FBF3E4" />
                <path d="M9.1 17.2h5.8l.3 2H8.8z" fill="#B8860B" />
              </svg>
            </span>
            <div>
              <h1 className="font-serif text-[22px] leading-7 font-semibold text-heading">Lighthouse Pulse</h1>
              <p className="text-xs text-muted">Your day, in focus</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {source === "sample" && <Badge variant="saffron">Sample data</Badge>}
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
              className="h-9 rounded-(--lh-radius-sm) border border-line-strong bg-bg px-3 text-sm text-ink"
            />
            <Button variant="outline" size="sm" onClick={() => void load(date)} disabled={loading} aria-label="Refresh data">
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
            <Button variant="primary" size="sm" onClick={onEditGoals}>
              {profile ? "Edit goals" : "Set up Sheru"}
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        {profile && <SheruPanel profile={profile} onProfile={onProfile} />}
        {error && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-(--lh-radius) border border-line bg-tint-maroon p-4 text-sm text-heading">
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
          <Card className="space-y-4 p-6 text-sm text-ink">
            <QuoteBlock quote={quoteFor("emptyDay", date)} className="mx-auto max-w-xl" />
            <p className="text-center">
              No tracked activity for this day yet. Sheru starts logging as soon as the desktop buddy or the extension is running.
            </p>
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

      <footer className="mx-auto max-w-6xl px-4 pb-8 text-center text-xs text-muted sm:px-6">
        Everything stays on this machine: your browsing data and the local model that writes your notes.
      </footer>
    </div>
  );
}
