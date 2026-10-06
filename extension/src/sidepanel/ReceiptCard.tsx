import { motion } from "framer-motion";
import type { SessionReceipt } from "../shared/types";
import { Card } from "../ui/Controls";
import { minutesText } from "../ui/format";

export function ReceiptCard({ receipt }: { receipt: SessionReceipt }) {
  const cats = Object.entries(receipt.topCategories);
  const max = Math.max(1, ...cats.map(([, v]) => v));
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} data-testid="receipt">
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Session receipt</h2>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
            {receipt.generatedBy === "llm" ? "AI summary" : "Summary"}
          </span>
        </div>
        <p className="mt-0.5 truncate text-xs text-slate-400">{receipt.goal}</p>
        <p className="mt-3 text-sm leading-relaxed text-slate-700">{receipt.summary}</p>
        <dl className="mt-4 grid grid-cols-4 gap-2 text-center">
          {[
            ["Total", minutesText(receipt.durationSeconds), "text-slate-800"],
            ["Focused", minutesText(receipt.focusedSeconds), "text-indigo-600"],
            ["Off-task", minutesText(receipt.distractedSeconds), "text-rose-500"],
            ["Switches", String(receipt.switches), "text-slate-800"],
          ].map(([label, value, color]) => (
            <div key={label} className="rounded-xl bg-slate-50 py-2">
              <dd className={`text-base font-semibold tabular-nums ${color}`}>{value}</dd>
              <dt className="text-[10px] uppercase tracking-wide text-slate-400">{label}</dt>
            </div>
          ))}
        </dl>
        {cats.length > 0 && (
          <ul className="mt-4 space-y-1.5">
            {cats.map(([name, secs]) => (
              <li key={name} className="flex items-center gap-2 text-xs">
                <span className="w-24 truncate text-slate-600">{name}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <motion.span
                    className="block h-full rounded-full bg-indigo-500"
                    initial={{ width: 0 }}
                    animate={{ width: `${(secs / max) * 100}%` }}
                  />
                </span>
                <span className="w-8 text-right tabular-nums text-slate-400">{minutesText(secs)}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-400">Average focus score {receipt.averageScore}/100</p>
      </Card>
    </motion.div>
  );
}
