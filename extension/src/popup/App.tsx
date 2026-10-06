import { motion } from "framer-motion";
import { useCallback, useEffect, useState } from "react";
import { BRAIN_URL, DASHBOARD_URL } from "../background/brain";
import { MSG, send } from "../shared/messages";
import { quoteFor } from "../shared/quotes";
import { Button, ErrorBlock, QuoteBlock } from "../ui/Controls";
import { useAppState } from "../ui/hooks";

interface BrainNow {
  label: string;
  verdict: "focus" | "neutral" | "distraction";
  category: string;
  reason: string;
}

interface BrainState {
  profile: { firstName: string; goals: string[]; pace: string } | null;
  mood: string;
  now: BrainNow | null;
  away: boolean;
  breakUntil: number | null;
  hushUntil: number | null;
  buddyOnline: boolean;
  today: { focusSeconds: number; distractionSeconds: number; alertCount: number };
}

/** Poll Sheru's brain directly (the popup is an extension page with host permission for it). */
export function useBrain(intervalMs = 3000): { brain: BrainState | null; offline: boolean; refresh: () => void } {
  const [brain, setBrain] = useState<BrainState | null>(null);
  const [offline, setOffline] = useState(false);
  const refresh = useCallback(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    fetch(`${BRAIN_URL}/api/buddy/state?since=1000000000`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: BrainState) => {
        setBrain(s);
        setOffline(false);
      })
      .catch(() => setOffline(true))
      .finally(() => clearTimeout(timer));
  }, []);
  useEffect(() => {
    refresh();
    const id = setInterval(refresh, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);
  return { brain, offline, refresh };
}

async function brainAction(action: string, minutes?: number): Promise<void> {
  await fetch(`${BRAIN_URL}/api/buddy/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, minutes: minutes ?? null }),
  }).catch(() => undefined);
}

const openTab = (url: string) => {
  void chrome.tabs.create({ url });
  window.close();
};

const mins = (s: number) => Math.round(s / 60);

const STATUS: Record<string, { text: string; dot: string }> = {
  focus: { text: "On track", dot: "var(--lh-ok)" },
  neutral: { text: "In between", dot: "var(--lh-ochre)" },
  distraction: { text: "Taking a detour", dot: "var(--lh-saffron)" },
  away: { text: "Away · Sheru is napping", dot: "var(--lh-neutral)" },
  break: { text: "On a break", dot: "var(--lh-neutral)" },
};

function SheruStatus({ brain }: { brain: BrainState }) {
  const key = brain.away ? "away" : brain.breakUntil ? "break" : brain.now?.verdict ?? "neutral";
  const s = STATUS[key] ?? STATUS["neutral"]!;
  return (
    <section className="rounded-[12px] border border-line bg-surface p-3" data-testid="brain-status">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.dot }} aria-hidden="true" />
        <span className="text-sm font-semibold text-heading">{s.text}</span>
        {brain.now && !brain.away && <span className="ml-auto truncate text-xs text-muted">{brain.now.label}</span>}
      </div>
      {brain.now && !brain.away && brain.now.reason && <p className="m-0 mt-1 text-xs leading-[17px] text-muted">{brain.now.reason}</p>}
      <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="font-serif text-lg font-semibold text-heading tabular-nums">{mins(brain.today.focusSeconds)}m</div>
          <div className="text-[10.5px] text-muted">focused</div>
        </div>
        <div>
          <div className="font-serif text-lg font-semibold text-heading tabular-nums">{mins(brain.today.distractionSeconds)}m</div>
          <div className="text-[10.5px] text-muted">detours</div>
        </div>
        <div>
          <div className="font-serif text-lg font-semibold text-heading tabular-nums">{brain.today.alertCount}</div>
          <div className="text-[10.5px] text-muted">nudges</div>
        </div>
      </div>
    </section>
  );
}

function LegacySession({ onError }: { onError: (e: string) => void }) {
  const { state } = useAppState();
  const [goal, setGoal] = useState("");
  const [started, setStarted] = useState(false);
  const active = state?.sessionStartTime != null || started;
  const start = async () => {
    try {
      await send({ type: MSG.START_SESSION, goal: goal.trim(), durationMinutes: null });
      setStarted(true);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    }
  };
  if (active) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-[10px] border border-line bg-surface p-3">
        <p className="m-0 text-sm text-ink">
          Focusing on <b>{state?.currentGoal ?? goal}</b>.
        </p>
        <p className="m-0 mt-0.5 text-xs text-muted">One thing at a time.</p>
      </motion.div>
    );
  }
  return (
    <form
      className="space-y-2.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (goal.trim()) void start();
      }}
    >
      <input
        aria-label="Goal"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder="What are you working on?"
        className="w-full rounded-[8px] border border-line-strong bg-bg px-3 py-2.5 text-sm text-ink placeholder:text-muted"
      />
      <Button type="submit" variant="primary" disabled={!goal.trim()} className="w-full">
        Start a browser-only session
      </Button>
    </form>
  );
}

export function App() {
  const { brain, offline } = useBrain();
  const [error, setError] = useState<string | null>(null);
  const [windowId, setWindowId] = useState<number | null>(null);
  useEffect(() => {
    chrome.windows.getCurrent().then((w) => setWindowId(w.id ?? null)).catch(() => undefined);
  }, []);

  const openPanel = () => {
    // sidePanel.open must run inside the click handler (user gesture), so the window id is resolved ahead of time.
    if (windowId === null) return;
    chrome.sidePanel.open({ windowId }).then(() => window.close()).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  };

  const profile = brain?.profile ?? null;
  const loading = !brain && !offline;

  return (
    <main className="space-y-3 p-4">
      <header className="flex items-center gap-3">
        <img src="/sheru.svg" alt="Sheru the lion cub" width={52} height={60} className="shrink-0" />
        <div className="min-w-0">
          <h1 className="m-0 font-serif text-[19px] font-semibold leading-6 text-heading">
            {profile ? `Namaste, ${profile.firstName}!` : "Lighthouse"}
          </h1>
          <p className="m-0 text-xs text-muted" data-testid="brain-line">
            {loading
              ? "Looking for Sheru…"
              : offline
                ? "Sheru's brain is asleep"
                : brain?.buddyOnline
                  ? "Sheru is on your desktop, keeping you company"
                  : "Sheru is watching your browser"}
          </p>
        </div>
      </header>

      {loading && <div className="h-24 animate-pulse rounded-[12px] bg-surface" aria-hidden="true" />}

      {brain && profile && (
        <>
          <SheruStatus brain={brain} />
          <div>
            <p className="m-0 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Your goals</p>
            <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" data-testid="goals">
              {profile.goals.map((g) => (
                <li key={g} className="rounded-full bg-tint-saffron px-2.5 py-1 text-xs font-medium text-heading">
                  {g}
                </li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            <Button className="px-1 text-xs" onClick={() => void brainAction("quote")}>Quote</Button>
            <Button className="px-1 text-xs" onClick={() => void brainAction("break", 5)}>5-min break</Button>
            {brain.hushUntil ? (
              <Button className="px-1 text-xs" onClick={() => void brainAction("resume")}>Wake Sheru</Button>
            ) : (
              <Button className="px-1 text-xs" onClick={() => void brainAction("hush", 30)}>Quiet 30m</Button>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="primary" onClick={() => openTab(DASHBOARD_URL)}>Dashboard</Button>
            <Button onClick={() => openTab(`${DASHBOARD_URL}/?onboarding=1`)}>Edit goals</Button>
          </div>
        </>
      )}

      {brain && !profile && (
        <section className="space-y-2.5 rounded-[12px] border border-line bg-surface p-3">
          <p className="m-0 text-sm text-ink">Hi! I'm Sheru. Tell me your name and goals and I'll help you stay on them.</p>
          <Button variant="primary" className="w-full" onClick={() => openTab(`${DASHBOARD_URL}/?onboarding=1`)}>
            Set my goals
          </Button>
        </section>
      )}

      {offline && (
        <>
          <section className="rounded-[12px] border border-line bg-surface p-3 text-xs leading-[18px] text-ink" data-testid="brain-offline">
            Start Lighthouse to wake Sheru up: open Terminal in the project folder and run <code className="font-semibold">./start.sh</code>.
            Until then I can still guard this browser on my own:
          </section>
          <QuoteBlock quote={quoteFor("sessionStart")} size="sm" />
          <LegacySession onError={setError} />
        </>
      )}

      {error && <ErrorBlock>{error}</ErrorBlock>}
      <Button variant="ghost" onClick={openPanel} disabled={windowId === null} className="w-full text-xs">
        Open side panel
      </Button>
    </main>
  );
}
