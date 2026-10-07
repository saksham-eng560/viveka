import { AnimatePresence, motion } from "framer-motion";
import { useRef, useState, type KeyboardEvent } from "react";
import { MSG, send } from "../shared/messages";
import { quoteFor } from "../shared/quotes";
import type { AppStateSnapshot, ContextResetSummary, Settings } from "../shared/types";
import { Button, Card, LogoMark, Notice, QuoteBlock, SectionTitle, StatusBadges, Toggle } from "../ui/Controls";
import { Gauge } from "../ui/Gauge";
import { clock, TONE_COLORS, toneFor } from "../ui/format";
import { useAppState, useNow } from "../ui/hooks";
import { ContextResetCard } from "./ContextResetCard";
import { ExtensionsView } from "./ExtensionsView";
import { ReceiptCard } from "./ReceiptCard";

const DURATIONS: { label: string; value: number | null }[] = [
  { label: "No timer", value: null },
  { label: "25 min", value: 25 },
  { label: "50 min", value: 50 },
];

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function SessionTimer({ state }: { state: AppStateSnapshot }) {
  const now = useNow();
  if (state.sessionStartTime === null) return null;
  const elapsed = (now - state.sessionStartTime) / 1000;
  const total = state.sessionDurationMinutes !== null ? state.sessionDurationMinutes * 60 : null;
  const done = total !== null && elapsed >= total;
  return (
    <div className="text-right" data-testid="timer">
      <div className="font-serif text-[30px] font-semibold leading-9 tabular-nums text-heading">
        {total !== null ? clock(Math.max(0, total - elapsed)) : clock(elapsed)}
      </div>
      <div className="text-[11px] leading-[15px] text-muted">
        {done ? "Block complete. Well done." : total !== null ? "left in your block" : "elapsed"}
      </div>
    </div>
  );
}

function GoalForm({ onStart, busy }: { onStart: (goal: string, minutes: number | null) => void; busy: boolean }) {
  const [goal, setGoal] = useState("");
  const [minutes, setMinutes] = useState<number | null>(null);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (goal.trim()) onStart(goal.trim(), minutes);
      }}
      className="space-y-3"
    >
      <QuoteBlock quote={quoteFor("sessionStart")} />
      <label className="block text-sm font-medium text-ink" htmlFor="goal">
        What are you working on?
      </label>
      <input
        id="goal"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder="e.g. Building a React dashboard"
        className="w-full rounded-[8px] border border-line-strong bg-bg px-3 py-2.5 text-sm text-ink placeholder:text-muted"
      />
      <div className="flex gap-1.5" role="radiogroup" aria-label="Session length">
        {DURATIONS.map((d) => (
          <button
            key={d.label}
            type="button"
            role="radio"
            aria-checked={minutes === d.value}
            onClick={() => setMinutes(d.value)}
            className={`min-h-8 flex-1 rounded-[8px] border px-2 py-1.5 text-xs font-medium transition-colors ${
              minutes === d.value ? "border-primary bg-tint-saffron text-heading" : "border-line-strong bg-transparent text-ink hover:bg-surface"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>
      <Button type="submit" variant="primary" disabled={!goal.trim() || busy} className="w-full">
        Start Session
      </Button>
    </form>
  );
}

function FocusCard({ state }: { state: AppStateSnapshot }) {
  const tab = state.currentTab;
  const score = tab?.score ?? state.currentFocusScore;
  const tone = TONE_COLORS[toneFor(score)];
  return (
    <Card>
      <div className="flex items-center gap-4">
        <Gauge score={score} size={124} />
        <div className="min-w-0 flex-1">
          {tab ? (
            <AnimatePresence mode="wait">
              <motion.div key={tab.tabId + tab.url} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${tone.chip}`} data-testid="category">
                  {tab.category}
                </span>
                <p className="mt-2 text-sm leading-snug text-ink" data-testid="reasoning">{tab.reasoning}</p>
                <p className="mt-1.5 truncate text-xs text-muted" title={tab.url}>{hostOf(tab.url)}</p>
              </motion.div>
            </AnimatePresence>
          ) : (
            <div className="space-y-2">
              <QuoteBlock quote={quoteFor("emptyFocus")} size="sm" />
              <p className="m-0 text-sm text-ink">Open a web page and your focus will appear here.</p>
            </div>
          )}
        </div>
      </div>
      {state.sessionStartTime !== null && (
        <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-xs text-muted">
          <span>Session average <b className="font-semibold text-ink">{Math.round(state.sessionAverageScore)}</b>/100</span>
          <span>{state.recentDistractions.length} detour{state.recentDistractions.length === 1 ? "" : "s"}</span>
        </div>
      )}
    </Card>
  );
}

function AdvancedSettings({ settings, onPatch }: { settings: Settings; onPatch: (p: Partial<Settings>) => void }) {
  const field = (label: string, key: "model" | "ollamaUrl" | "awUrl") => (
    <label className="block text-xs text-muted" key={key}>
      {label}
      <input
        defaultValue={settings[key]}
        key={settings[key]}
        onBlur={(e) => e.target.value !== settings[key] && onPatch({ [key]: e.target.value })}
        className="mt-1 w-full rounded-[8px] border border-line-strong bg-bg px-2.5 py-1.5 text-xs text-ink"
      />
    </label>
  );
  return (
    <details className="mt-2 text-xs text-muted">
      <summary className="cursor-pointer select-none py-1.5 text-muted">Connections</summary>
      <div className="mt-2 space-y-2">
        {field("Model", "model")}
        {field("Model server URL", "ollamaUrl")}
        {field("ActivityWatch URL", "awUrl")}
      </div>
    </details>
  );
}

type View = "focus" | "extensions";
const VIEWS: { id: View; label: string }[] = [
  { id: "focus", label: "Focus" },
  { id: "extensions", label: "Extensions" },
];

function ViewTabs({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const idx = VIEWS.findIndex((v) => v.id === view);
    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % VIEWS.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + VIEWS.length) % VIEWS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = VIEWS.length - 1;
    else return;
    e.preventDefault();
    const target = VIEWS[next]!;
    onChange(target.id);
    refs.current[target.id]?.focus();
  };
  return (
    <div role="tablist" aria-label="Viveka views" className="flex gap-1 rounded-[10px] border border-line bg-surface p-1">
      {VIEWS.map((v) => {
        const selected = v.id === view;
        return (
          <button
            key={v.id}
            ref={(el) => {
              refs.current[v.id] = el;
            }}
            type="button"
            role="tab"
            id={`tab-${v.id}`}
            aria-selected={selected}
            aria-controls={`panel-${v.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(v.id)}
            onKeyDown={onKeyDown}
            className={`min-h-8 flex-1 rounded-[8px] border px-3 py-1.5 text-sm font-medium transition-colors ${
              selected ? "border-line-strong bg-bg text-heading" : "border-transparent bg-transparent text-muted hover:text-ink"
            }`}
          >
            {v.label}
          </button>
        );
      })}
    </div>
  );
}

/** Leo's brain (backend coach): goals from onboarding and what it thinks of the current tab. */
function BrainCard({ state }: { state: AppStateSnapshot }) {
  const b = state.brain;
  if (!b?.online) return null;
  const verdict = b.verdict === "focus" ? "on track" : b.verdict === "distraction" ? "a detour" : "neutral";
  return (
    <Card className="flex items-start gap-3 py-3" >
      <img src="/leo.svg" alt="" width={44} height={50} className="shrink-0" />
      <div className="min-w-0 text-xs leading-[18px]" data-testid="brain-card">
        <p className="m-0 text-sm font-semibold text-heading">
          {b.firstName ? `Leo is with you, ${b.firstName}` : "Leo is with you"}
        </p>
        {b.label && (
          <p className="m-0 text-muted">
            {b.label} looks like <b className="text-ink">{verdict}</b>.
          </p>
        )}
        {b.goals.length > 0 && <p className="m-0 mt-1 text-ink">Goals: {b.goals.join(" · ")}</p>}
        <p className="m-0 mt-1 text-muted">
          {b.buddyOnline ? "Watching your whole Mac from the desktop." : "Desktop buddy is off; nudges show in your tabs."} Sessions below are optional.
        </p>
      </div>
    </Card>
  );
}

export function App() {
  const { state, error } = useAppState();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reset, setReset] = useState<ContextResetSummary | null>(null);
  const [view, setView] = useState<View>("focus");

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    setNotice(null);
    try {
      await fn();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (!state) {
    return (
      <main className="p-4 text-sm text-muted">
        {error ? `Could not reach Viveka's background: ${error}` : "Loading…"}
      </main>
    );
  }

  const patch = (p: Partial<Settings>) => void send({ type: MSG.SET_SETTINGS, patch: p }).catch(() => undefined);
  const active = state.sessionStartTime !== null;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col gap-3 p-4">
      <header className="flex items-center gap-2.5">
        <LogoMark />
        <div className="min-w-0">
          <h1 className="m-0 font-serif text-xl font-semibold leading-[26px] text-heading">Viveka</h1>
          <p className="m-0 text-[11px] leading-[15px] text-muted">A quiet companion for focused work</p>
        </div>
      </header>
      <BrainCard state={state} />
      <StatusBadges state={state} />
      <ViewTabs view={view} onChange={setView} />

      {view === "extensions" ? (
        <div role="tabpanel" id="panel-extensions" aria-labelledby="tab-extensions">
          <ExtensionsView />
        </div>
      ) : (
        <div role="tabpanel" id="panel-focus" aria-labelledby="tab-focus" className="flex flex-col gap-3">
          <Card>
            {active ? (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 text-[11px] font-medium uppercase leading-[15px] tracking-[0.06em] text-muted">Current goal</p>
                  <p className="mt-1 text-sm font-medium leading-snug text-ink" data-testid="goal">{state.currentGoal}</p>
                </div>
                <SessionTimer state={state} />
              </div>
            ) : (
              <GoalForm
                busy={busy === "start"}
                onStart={(goal, minutes) =>
                  void run("start", async () => void (await send({ type: MSG.START_SESSION, goal, durationMinutes: minutes })))
                }
              />
            )}
            {active && (
              <Button
                disabled={busy === "end"}
                onClick={() => void run("end", async () => void (await send({ type: MSG.END_SESSION })))}
                className="mt-3 w-full"
              >
                End Session
              </Button>
            )}
          </Card>

          <FocusCard state={state} />

          <div className="grid grid-cols-2 gap-2">
            <Button
              disabled={busy === "reset"}
              onClick={() => void run("reset", async () => setReset(await send({ type: MSG.GET_CONTEXT_RESET })))}
            >
              {busy === "reset" ? "Reflecting…" : "Context Reset"}
            </Button>
            <Button
              disabled={busy === "group"}
              onClick={() =>
                void run("group", async () => {
                  const r = await send({ type: MSG.GROUP_TABS });
                  const partial = r.failed ? ` ${r.failed} could not be grouped.` : "";
                  setNotice(r.tabsGrouped ? `Grouped ${r.tabsGrouped} tabs into ${r.groups} groups.${partial}` : `No web tabs to group.${partial}`);
                })
              }
            >
              {busy === "group" ? "Grouping…" : "Group Tabs"}
            </Button>
          </div>

          <AnimatePresence>
            {notice && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}>
                <Notice>{notice}</Notice>
              </motion.div>
            )}
          </AnimatePresence>

          {reset && (
            <ContextResetCard
              summary={reset}
              onDismiss={() => setReset(null)}
              onCloseSuggested={(ids) =>
                void run("close", async () => {
                  await chrome.tabs.remove(ids);
                  setReset(null);
                  setNotice(`Closed ${ids.length} tab${ids.length === 1 ? "" : "s"}.`);
                })
              }
            />
          )}

          {!active && state.lastReceipt && <ReceiptCard receipt={state.lastReceipt} />}

          <Card>
            <SectionTitle>Preferences</SectionTitle>
            <Toggle
              label="Demo mode"
              hint="Nudge after 5 seconds instead of 60"
              checked={state.settings.demoMode}
              onChange={(v) => patch({ demoMode: v })}
            />
            <Toggle
              label="Voice nudges"
              hint="A gentle spoken reminder"
              checked={state.settings.voiceNudges}
              onChange={(v) => patch({ voiceNudges: v })}
            />
            <Toggle
              label="Auto-group tabs"
              hint="Group new tabs by category"
              checked={state.settings.autoGroupTabs}
              onChange={(v) => patch({ autoGroupTabs: v })}
            />
            <AdvancedSettings settings={state.settings} onPatch={patch} />
          </Card>
        </div>
      )}

      <footer className="mt-auto pb-1 text-center text-[11px] leading-[15px] text-muted">
        Everything stays on this device.
      </footer>
    </main>
  );
}
