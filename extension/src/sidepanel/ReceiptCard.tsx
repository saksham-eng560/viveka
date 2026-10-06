import { motion } from "framer-motion";
import type { SessionReceipt } from "../shared/types";
import { quoteFor } from "../shared/quotes";
import { Card, QuoteBlock, SectionTitle } from "../ui/Controls";
import { minutesText } from "../ui/format";

export function ReceiptCard({ receipt }: { receipt: SessionReceipt }) {
  const cats = Object.entries(receipt.topCategories);
  const max = Math.max(1, ...cats.map(([, v]) => v));
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} data-testid="receipt">
      <Card>
        <div className="flex items-start justify-between">
          <SectionTitle>Session receipt</SectionTitle>
          <span className="rounded-full bg-tint-saffron px-2 py-0.5 text-[11px] font-medium leading-[15px] text-ink">
            {receipt.generatedBy === "llm" ? "Summary · local model" : "Summary"}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted">{receipt.goal}</p>
        <p className="mt-3 text-sm leading-relaxed text-ink">{receipt.summary}</p>
        <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
          {[
            ["Total", minutesText(receipt.durationSeconds), "text-ink"],
            ["Focused", minutesText(receipt.focusedSeconds), "text-heading"],
            ["Off-task", minutesText(receipt.distractedSeconds), "text-heading"],
            ["Switches", String(receipt.switches), "text-ink"],
          ].map(([label, value, color]) => (
            <div key={label} className="rounded-[8px] border border-line bg-bg py-2">
              <dd className={`font-serif text-base font-semibold tabular-nums ${color}`}>{value}</dd>
              <dt className="text-[11px] uppercase leading-[15px] tracking-[0.06em] text-muted">{label}</dt>
            </div>
          ))}
        </dl>
        {cats.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {cats.map(([name, secs]) => (
              <li key={name} className="flex items-center gap-2 text-xs">
                <span className="w-24 truncate text-ink">{name}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line">
                  <motion.span
                    className="block h-full rounded-full bg-productive"
                    initial={{ width: 0 }}
                    animate={{ width: `${(secs / max) * 100}%` }}
                  />
                </span>
                <span className="w-8 text-right tabular-nums text-muted">{minutesText(secs)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">Average focus score {receipt.averageScore}/100</p>
        <div className="mt-4">
          <QuoteBlock quote={quoteFor("receipt")} size="sm" />
        </div>
      </Card>
    </motion.div>
  );
}
