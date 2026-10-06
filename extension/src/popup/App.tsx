import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { MSG, send } from "../shared/messages";
import { quoteFor } from "../shared/quotes";
import { Button, ErrorBlock, LogoMark, QuoteBlock } from "../ui/Controls";
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
        <h1 className="m-0 font-serif text-xl font-semibold leading-[26px] text-heading">Lighthouse</h1>
      </header>
      {active || started ? (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-[10px] border border-line bg-surface p-3">
          <p className="m-0 text-sm text-ink">
            Focusing on <b>{state?.currentGoal ?? goal}</b>.
          </p>
          <p className="m-0 mt-0.5 text-xs text-muted">One thing at a time.</p>
        </motion.div>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (goal.trim()) void start();
          }}
        >
          <QuoteBlock quote={quoteFor("sessionStart")} size="sm" />
          <input
            autoFocus
            aria-label="Goal"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="What are you working on?"
            className="w-full rounded-[8px] border border-line-strong bg-bg px-3 py-2.5 text-sm text-ink placeholder:text-muted"
          />
          <Button type="submit" variant="primary" disabled={!goal.trim()} className="w-full">
            Start
          </Button>
        </form>
      )}
      {error && <ErrorBlock>{error}</ErrorBlock>}
      <Button onClick={openPanel} disabled={windowId === null} className="w-full">
        Open side panel
      </Button>
    </main>
  );
}
