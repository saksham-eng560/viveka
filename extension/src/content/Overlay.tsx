import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { minutesLeftText, nudgeHeadline } from "../shared/format";
import type { NudgeActionKind } from "../shared/messages";
import { quoteFor } from "../shared/quotes";
import type { NudgePayload } from "../shared/types";
import { QuoteBlock } from "../ui/Controls";

interface OverlayProps {
  payload: NudgePayload | null;
  onAction: (action: NudgeActionKind) => void;
}

function Beacon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r="12" fill="#7A2E1D" />
      <path d="M10 8h4l1.4 9h-6.8L10 8z" fill="#FBF3E4" />
      <rect x="9.5" y="5.5" width="5" height="2.5" rx="0.6" fill="#E8730C" />
      <rect x="9.3" y="11" width="5.4" height="1.6" fill="#B8860B" />
    </svg>
  );
}

export function Overlay({ payload, onAction }: OverlayProps) {
  const reduce = useReducedMotion();
  const mins = payload ? minutesLeftText(payload.minutesLeft) : null;
  const quote = payload ? quoteFor("nudge", `${payload.hostname}|${payload.goal}|${payload.score}`) : null;
  return (
    <AnimatePresence>
      {payload && quote && (
        <motion.div
          key="lighthouse-nudge"
          role="status"
          aria-live="polite"
          data-testid="lighthouse-nudge"
          initial={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, y: 12 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className="fixed bottom-5 right-5 w-[360px] max-w-[calc(100vw-40px)] rounded-[10px] border border-line bg-surface p-4 text-ink"
          style={{
            position: "fixed",
            right: 20,
            bottom: 20,
            zIndex: 2147483647,
            boxShadow: "var(--lh-shadow-overlay)",
          }}
        >
          <div className="flex items-center gap-2">
            <Beacon />
            <span className="font-serif text-sm font-semibold text-heading">Lighthouse</span>
            <span
              className="ml-auto rounded-full bg-tint-maroon px-2 py-0.5 text-[11px] font-medium leading-[15px] text-heading"
              data-testid="nudge-score"
            >
              Focus {payload.score}/100
            </span>
          </div>
          <p className="mt-3 font-serif text-[17px] font-semibold leading-6 text-heading" data-testid="nudge-headline">
            {nudgeHeadline(payload)}
          </p>
          {payload.reasoning && <p className="mt-1.5 text-xs leading-[17px] text-muted">{payload.reasoning}</p>}
          {mins && <p className="mt-1.5 text-xs font-medium leading-[17px] text-ink">{mins}</p>}
          <div className="mt-3">
            <QuoteBlock quote={quote} size="sm" />
          </div>
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => onAction("back_to_work")}
              className="min-h-9 flex-1 rounded-[8px] bg-primary px-3 py-2 text-sm font-semibold text-primary-fg hover:bg-[var(--lh-primary-hover)]"
            >
              Return to work
            </button>
            <button
              type="button"
              onClick={() => onAction("dismiss")}
              className="min-h-9 rounded-[8px] border border-line-strong bg-transparent px-3 py-2 text-sm font-medium text-ink hover:bg-bg"
            >
              Not now
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
