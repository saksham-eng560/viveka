import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { minutesLeftText, nudgeHeadline } from "../shared/format";
import type { NudgeActionKind } from "../shared/messages";
import type { NudgePayload } from "../shared/types";

interface OverlayProps {
  payload: NudgePayload | null;
  onAction: (action: NudgeActionKind) => void;
}

function Beacon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r="12" fill="#4f46e5" />
      <path d="M10 8h4l1.4 9h-6.8L10 8z" fill="#fff" />
      <rect x="9.5" y="5.5" width="5" height="2.5" rx="0.6" fill="#fde047" />
      <rect x="9.3" y="11" width="5.4" height="1.6" fill="#f43f5e" />
    </svg>
  );
}

export function Overlay({ payload, onAction }: OverlayProps) {
  const reduce = useReducedMotion();
  const mins = payload ? minutesLeftText(payload.minutesLeft) : null;
  return (
    <AnimatePresence>
      {payload && (
        <motion.div
          key="lighthouse-nudge"
          role="status"
          aria-live="polite"
          data-testid="lighthouse-nudge"
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: 48, scale: 0.96 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: 48, scale: 0.96 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="fixed bottom-5 right-5 w-[360px] max-w-[calc(100vw-40px)] rounded-2xl border border-slate-200 bg-white p-4 text-slate-800"
          style={{
            position: "fixed",
            right: 20,
            bottom: 20,
            zIndex: 2147483647,
            boxShadow: "0 18px 50px -12px rgba(15,23,42,0.35), 0 2px 8px rgba(15,23,42,0.08)",
          }}
        >
          <div className="flex items-center gap-2">
            <Beacon />
            <span className="text-xs font-semibold tracking-wide text-indigo-600">LIGHTHOUSE</span>
            <span
              className="ml-auto rounded-full bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-600"
              data-testid="nudge-score"
            >
              {payload.score}/100
            </span>
          </div>
          <p className="mt-3 text-[15px] font-medium leading-snug text-slate-900" data-testid="nudge-headline">
            {nudgeHeadline(payload)}
          </p>
          {payload.reasoning && <p className="mt-1.5 text-[13px] leading-snug text-slate-500">{payload.reasoning}</p>}
          {mins && <p className="mt-1.5 text-[13px] font-medium text-indigo-600">{mins}</p>}
          <div className="mt-4 flex items-center gap-2">
            <button
              type="button"
              onClick={() => onAction("back_to_work")}
              className="flex-1 rounded-xl bg-indigo-600 px-3 py-2 text-sm font-semibold text-white"
            >
              Back to Work
            </button>
            <button
              type="button"
              onClick={() => onAction("dismiss")}
              className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-600"
            >
              Dismiss
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
