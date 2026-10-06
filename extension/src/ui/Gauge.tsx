import { motion } from "framer-motion";
import { TONE_COLORS, toneFor } from "./format";

interface GaugeProps {
  score: number;
  size?: number;
}

/** Circular focus gauge with an animated arc. */
export function Gauge({ score, size = 148 }: GaugeProps) {
  const stroke = 11;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, score));
  const tone = TONE_COLORS[toneFor(clamped)];
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={`Focus score ${clamped} out of 100`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={false}
          animate={{ strokeDashoffset: c * (1 - clamped / 100), stroke: tone.stroke }}
          transition={{ type: "spring", stiffness: 90, damping: 18 }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <motion.span
          key={clamped}
          initial={{ opacity: 0.4, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className={`text-4xl font-semibold tabular-nums ${tone.text}`}
          data-testid="gauge-score"
        >
          {clamped}
        </motion.span>
        <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">focus</span>
      </div>
    </div>
  );
}
