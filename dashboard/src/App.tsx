import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "./components/ui/badge";
import { Button } from "./components/ui/button";
import { Card } from "./components/ui/card";
import { QuoteBlock } from "./components/ui/quote-block";
import { CategoryBreakdown } from "./features/CategoryBreakdown";
import { MetricCards } from "./features/MetricCards";
import { StandupGenerator } from "./features/StandupGenerator";
import { Onboarding } from "./features/Onboarding";
import { SettingsPage } from "./features/SettingsPage";
import { SheruPanel } from "./features/SheruPanel";
import { StatusBar } from "./features/StatusBar";
import { TimelineChart } from "./features/TimelineChart";
import { apiErrorMessage, getHealth, getProfile, getSummary, getTimeline, localTimeZone } from "./lib/api";
import { toDateInputValue } from "./lib/format";
import { quoteFor } from "./lib/quotes";
import type { DailySummaryResponse, HealthResponse, Profile, TimelineResponse } from "./lib/types";

const wantsOnboarding = () => new URLSearchParams(window.location.search).has("onboarding");
type View = "today" | "settings";
const initialView = (): View => (new URLSearchParams(window.location.search).get("view") === "settings" ? "settings" : "today");

/** Root: first run (no profile) or ?onboarding=1 shows the onboarding; otherwise the dashboard. */
export default function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [checked, setChecked] = useState(false);
  const [onboarding, setOnboarding] = useState(wantsOnboarding);
  const [view, setView] = useState<View>(initialView);

  useEffect(() => {
    getProfile()
      .then((r) => {
        setProfile(r.profile);
        if (!r.exists) setOnboarding(true);
      })
      .catch(() => undefined) // backend down: show the dashboard, which explains the problem
      .finally(() => setChecked(true));
  }, []);

  const changeView = (next: View) => {
    setView(next);
    window.history.replaceState(null, "", next === "settings" ? "/?view=settings" : window.location.pathname);
    // Settings may have changed the pace etc.: refresh the profile the Today view shows
    if (next === "today") getProfile().then((r) => r.profile && setProfile(r.profile)).catch(() => undefined);
  };

  const closeOnboarding = (p: Profile | null) => {
    if (p) setProfile(p);
    setOnboarding(false);
    if (wantsOnboarding()) window.history.replaceState(null, "", window.location.pathname);
  };

  if (!checked) return <div className="min-h-screen" aria-busy="true" />;
  if (onboarding) {
    return <Onboarding initial={profile} onDone={(p) => closeOnboarding(p)} onCancel={profile ? () => closeOnboarding(null) : undefined} />;
  }
  return (
    <Dashboard profile={profile} onProfile={setProfile} onEditGoals={() => setOnboarding(true)} view={profile ? view : "today"}
      onView={changeView} onStartOver={() => { setProfile(null); setView("today"); setOnboarding(true); }} />
  );
}

function Dashboard({ profile, onProfile, onEditGoals, view, onView, onStartOver }: {
  profile: Profile | null;
  onProfile: (p: Profile) => void;
  onEditGoals: () => void;
  view: View;
  onView: (v: View) => void;
  onStartOver: () => void;
}) {
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
            <img src="/sheru.svg" alt="" width={36} height={42} aria-hidden="true" />
            <div>
              <h1 className="font-serif text-[22px] leading-7 font-semibold text-heading">Sheru</h1>
              <p className="text-xs text-muted">Your focus buddy</p>
            </div>
            {profile && (
              <nav role="tablist" aria-label="Sections" className="ml-2 inline-flex rounded-full border border-line bg-surface p-0.5">
                {(["today", "settings"] as const).map((v) => (
                  <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => onView(v)}
                    className={`cursor-pointer rounded-full px-3.5 py-1 text-sm font-semibold transition-colors ${view === v ? "bg-primary text-primary-fg" : "text-ink hover:bg-bg"}`}>
                    {v === "today" ? "Today" : "Settings"}
                  </button>
                ))}
              </nav>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {view === "today" && source === "sample" && <Badge variant="saffron">Sample data</Badge>}
            <StatusBar health={health} error={healthError} />
            {view === "today" && (
              <>
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
              </>
            )}
            <Button variant="primary" size="sm" onClick={onEditGoals}>
              {profile ? "Edit goals" : "Set up Sheru"}
            </Button>
          </div>
        </div>
      </header>

      {view === "settings" && profile ? (
        <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
          <SettingsPage profile={profile} onEditGoals={onEditGoals} onStartOver={onStartOver} />
        </main>
      ) : (
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
      )}

      <footer className="mx-auto max-w-6xl px-4 pb-8 text-center text-xs text-muted sm:px-6">
        Sheru keeps everything on this machine: your activity, your settings and the local model that writes his lines.
      </footer>
    </div>
  );
}
