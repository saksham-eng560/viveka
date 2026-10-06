import { cn } from "../../lib/utils";

interface ProgressProps {
  /** 0-100 */
  value: number;
  label: string;
  className?: string;
  indicatorClassName?: string;
}

export function Progress({ value, label, className, indicatorClassName }: ProgressProps) {
  const v = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v)}
      className={cn("h-2.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800", className)}
    >
      <div
        className={cn("h-full rounded-full bg-indigo-600 transition-[width] duration-500", indicatorClassName)}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}
