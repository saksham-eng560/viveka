import { useState } from "react";
import { motion } from "framer-motion";
import type { ContextResetSummary } from "../shared/types";
import { Card } from "../ui/Controls";

interface Props {
  summary: ContextResetSummary;
  onCloseSuggested: (ids: number[]) => void;
  onDismiss: () => void;
}

export function ContextResetCard({ summary, onCloseSuggested, onDismiss }: Props) {
  const close = summary.suggestedCloseTabIds;
  const [confirming, setConfirming] = useState(false);
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} data-testid="context-reset">
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Context reset</h2>
          <button type="button" onClick={onDismiss} className="border-0 bg-transparent text-xs text-slate-400 hover:text-slate-600">
            Hide
          </button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-slate-700">{summary.summary}</p>
        {summary.tabs.length > 0 && (
          <ul className="mt-3 max-h-44 space-y-1 overflow-y-auto pr-1">
            {summary.tabs.map((t) => (
              <li key={t.tabId} className="flex items-center gap-2 text-xs">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.relevant ? "bg-indigo-500" : "bg-rose-400"}`} />
                <span className="truncate text-slate-600" title={t.url}>{t.title || t.url}</span>
                <span className="ml-auto shrink-0 tabular-nums text-slate-400">{t.score}</span>
              </li>
            ))}
          </ul>
        )}
        {close.length > 0 ? (
          <button
            type="button"
            onClick={() => (confirming ? onCloseSuggested(close) : setConfirming(true))}
            className="mt-3 w-full rounded-xl border-0 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-100"
          >
            {confirming
              ? `Click again to close ${close.length} ${close.length === 1 ? "tab" : "tabs"}`
              : `Close ${close.length} unrelated ${close.length === 1 ? "tab" : "tabs"}`}
          </button>
        ) : (
          <p className="mt-3 text-xs text-slate-400">Nothing to close. Your tabs look on-topic.</p>
        )}
        <p className="mt-2 text-[10px] text-slate-400">{summary.generatedBy === "llm" ? "Summarized by your local model" : "Quick summary (AI offline)"}</p>
      </Card>
    </motion.div>
  );
}
