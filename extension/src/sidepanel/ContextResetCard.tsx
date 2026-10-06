import { useState } from "react";
import { motion } from "framer-motion";
import type { ContextResetSummary } from "../shared/types";
import { Button, Card, SectionTitle } from "../ui/Controls";

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
          <SectionTitle>Context reset</SectionTitle>
          <Button variant="ghost" onClick={onDismiss} className="min-h-8! px-2! py-1! text-xs! font-medium! text-muted!">
            Hide
          </Button>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-ink">{summary.summary}</p>
        {summary.tabs.length > 0 && (
          <ul className="mt-3 max-h-44 space-y-1 overflow-y-auto pr-1">
            {summary.tabs.map((t) => (
              <li key={t.tabId} className="flex items-center gap-2 text-xs">
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.relevant ? "bg-productive" : "bg-distraction"}`} />
                <span className="truncate text-ink" title={t.url}>{t.title || t.url}</span>
                <span className="ml-auto shrink-0 tabular-nums text-muted">{t.score}</span>
              </li>
            ))}
          </ul>
        )}
        {close.length > 0 ? (
          <Button
            onClick={() => (confirming ? onCloseSuggested(close) : setConfirming(true))}
            className="mt-3 w-full bg-tint-maroon! text-heading! border-0!"
          >
            {confirming
              ? `Click again to close ${close.length} ${close.length === 1 ? "tab" : "tabs"}`
              : `Close ${close.length} unrelated ${close.length === 1 ? "tab" : "tabs"}`}
          </Button>
        ) : (
          <p className="mt-3 text-xs text-muted">Nothing to close. Your tabs look on-topic.</p>
        )}
        <p className="mt-2 text-[11px] leading-[15px] text-muted">{summary.generatedBy === "llm" ? "Summarized by your local model" : "Quick summary (written from rules)"}</p>
      </Card>
    </motion.div>
  );
}
