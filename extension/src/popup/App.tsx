import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { MSG, send } from "../shared/messages";
import { LogoMark } from "../ui/Controls";
import { useAppState } from "../ui/hooks";

export function App() {
  const { state } = useAppState();
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);

  const start = async () => {
    setError(null);
    try {
      await send({ type: MSG.START_SESSION, goal: goal.trim(), durationMinutes: null });
      setStarted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const [windowId, setWindowId] = useState<number | null>(null);
  useEffect(() => {
    chrome.windows.getCurrent().then((w) => setWindowId(w.id ?? null)).catch(() => undefined);
  }, []);

  const openPanel = () => {
    // sidePanel.open must be called directly in the click handler (user gesture), so the
    // window id is resolved ahead of time.
    if (windowId === null) return;
    chrome.sidePanel.open({ windowId }).then(() => window.close()).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e));
    });
  };

  const active = state?.sessionStartTime != null;
  return (
    <main className="space-y-3 p-4">
      <header className="flex items-center gap-2.5">
        <LogoMark />
        <h1 className="m-0 text-base font-semibold text-slate-900">Lighthouse</h1>
      </header>
      {active || started ? (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="m-0 rounded-xl bg-indigo-50 p-3 text-sm text-indigo-700">
          Focusing on <b>{state?.currentGoal ?? goal}</b>. You've got this.
        </motion.p>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (goal.trim()) void start();
          }}
        >
          <input
            autoFocus
            aria-label="Goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="What are you working on?"
            className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400"
          />
          <button
            type="submit"
            disabled={!goal.trim()}
            className="w-full rounded-xl border-0 bg-indigo-600 px-3 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            Start
          </button>
        </form>
      )}
      {error && <p className="m-0 text-xs text-rose-600" role="alert">{error}</p>}
      <button
        type="button"
        onClick={openPanel}
        disabled={windowId === null}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Open side panel
      </button>
    </main>
  );
}
