import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { MSG, send } from "../shared/messages";
import type { AppStateSnapshot, ContextResetSummary, Settings } from "../shared/types";
import { Card, LogoMark, StatusBadges, Toggle } from "../ui/Controls";
import { Gauge } from "../ui/Gauge";
import { clock, TONE_COLORS, toneFor } from "../ui/format";
import { useAppState, useNow } from "../ui/hooks";
import { ContextResetCard } from "./ContextResetCard";
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
      <div className="text-2xl font-semibold tabular-nums text-slate-900">
        {total !== null ? clock(Math.max(0, total - elapsed)) : clock(elapsed)}
      </div>
      <div className="text-[11px] text-slate-400">
        {done ? "Block complete, nice work!" : total !== null ? "left in your block" : "elapsed"}
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
      <label className="block text-sm font-medium text-slate-700" htmlFor="goal">
        What are you working on?
      </label>
      <input
        id="goal"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        placeholder="e.g. Building a React dashboard"
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400"
      />
      <div className="flex gap-1.5" role="radiogroup" aria-label="Session length">
        {DURATIONS.map((d) => (
          <button
            key={d.label}
            type="button"
            role="radio"
            aria-checked={minutes === d.value}
            onClick={() => setMinutes(d.value)}
            className={`flex-1 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
              minutes === d.value ? "border-indigo-600 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            {d.label}
          </button>
        ))}
      </div>
      <button
        type="submit"
        disabled={!goal.trim() || busy}
        className="w-full rounded-xl border-0 bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        Start Session
      </button>
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
                <p className="mt-2 text-sm leading-snug text-slate-700" data-testid="reasoning">{tab.reasoning}</p>
                <p className="mt-1.5 truncate text-xs text-slate-400" title={tab.url}>{hostOf(tab.url)}</p>
              </motion.div>
            </AnimatePresence>
          ) : (
            <p className="text-sm text-slate-500">Switch to a web page and your focus score will show up here.</p>
          )}
        </div>
      </div>
      {state.sessionStartTime !== null && (
        <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-xs text-slate-500">
          <span>Session average <b className="font-semibold text-slate-700">{Math.round(state.sessionAverageScore)}</b>/100</span>
          <span>{state.recentDistractions.length} detour{state.recentDistractions.length === 1 ? "" : "s"}</span>
        </div>
      )}
    </Card>
  );
}

function AdvancedSettings({ settings, onPatch }: { settings: Settings; onPatch: (p: Partial<Settings>) => void }) {
  const field = (label: string, key: "model" | "ollamaUrl" | "awUrl") => (
    <label className="block text-xs text-slate-500" key={key}>
      {label}
      <input
        defaultValue={settings[key]}
        key={settings[key]}
        onBlur={(e) => e.target.value !== settings[key] && onPatch({ [key]: e.target.value })}
        className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs text-slate-800"
      />
    </label>
  );
  return (
    <details className="mt-2 text-xs text-slate-500">
      <summary className="cursor-pointer select-none py-1 text-slate-400">Connections</summary>
      <div className="mt-2 space-y-2">
        {field("Model", "model")}
        {field("Ollama URL", "ollamaUrl")}
        {field("ActivityWatch URL", "awUrl")}
      </div>
    </details>
  );
}

export function App() {
  const { state, error } = useAppState();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reset, setReset] = useState<ContextResetSummary | null>(null);

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
      <main className="p-4 text-sm text-slate-500">
        {error ? `Could not reach the Lighthouse background: ${error}` : "Loading…"}
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
          <h1 className="m-0 text-base font-semibold leading-tight text-slate-900">Lighthouse</h1>
          <p className="m-0 text-[11px] text-slate-400">Your local AI focus coach</p>
        </div>
      </header>
      <StatusBadges state={state} />

      <Card>
        {active ? (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wider text-indigo-600">Current goal</p>
              <p className="mt-1 text-sm font-medium leading-snug text-slate-900" data-testid="goal">{state.currentGoal}</p>
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
          <button
            type="button"
            disabled={busy === "end"}
            onClick={() => void run("end", async () => void (await send({ type: MSG.END_SESSION })))}
            className="mt-3 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            End Session
          </button>
        )}
      </Card>

      <FocusCard state={state} />

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy === "reset"}
          onClick={() => void run("reset", async () => setReset(await send({ type: MSG.GET_CONTEXT_RESET })))}
          className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
        >
          {busy === "reset" ? "Thinking…" : "Context Reset"}
        </button>
        <button
          type="button"
          disabled={busy === "group"}
          onClick={() =>
            void run("group", async () => {
              const r = await send({ type: MSG.GROUP_TABS });
              const partial = r.failed ? ` ${r.failed} could not be grouped.` : "";
              setNotice(r.tabsGrouped ? `Grouped ${r.tabsGrouped} tabs into ${r.groups} groups.${partial}` : `No web tabs to group.${partial}`);
            })
          }
          className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
        >
          {busy === "group" ? "Grouping…" : "Group Tabs"}
        </button>
      </div>

      <AnimatePresence>
        {notice && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="m-0 rounded-xl bg-indigo-50 px-3 py-2 text-xs text-indigo-700"
            role="status"
          >
            {notice}
          </motion.p>
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
              setNotice(`Closed ${ids.length} tab${ids.length === 1 ? "" : "s"}. Fresh start!`);
            })
          }
        />
      )}

      {!active && state.lastReceipt && <ReceiptCard receipt={state.lastReceipt} />}

      <Card>
        <h2 className="m-0 mb-1 text-sm font-semibold text-slate-900">Preferences</h2>
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

      <footer className="mt-auto pb-1 text-center text-[11px] text-slate-400">
        Processed locally. Nothing leaves your machine.
      </footer>
    </main>
  );
}
