import type { HealthResponse } from "../lib/types";
import { cn } from "../lib/utils";

function Dot({ ok, label, detail }: { ok: boolean | null; label: string; detail: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-300" title={detail}>
      <span
        className={cn(
          "h-2 w-2 rounded-full",
          ok === null ? "bg-zinc-400" : ok ? "bg-emerald-500" : "bg-rose-500",
        )}
        aria-hidden="true"
      />
      <span className="font-medium">{label}</span>
      <span className="sr-only">{ok === null ? "unknown" : ok ? "connected" : "unreachable"}</span>
    </span>
  );
}

export function StatusBar({ health, error }: { health: HealthResponse | null; error: boolean }) {
  if (error) {
    return (
      <div className="flex items-center gap-3" role="status" aria-label="Service status">
        <Dot ok={false} label="Backend" detail="Pulse backend unreachable" />
      </div>
    );
  }
  const sourceLabel = health ? (health.dataSource === "auto" ? "Auto data" : health.dataSource === "aw" ? "AW data" : "Sample data") : "Data";
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1" role="status" aria-label="Service status">
      <Dot ok={health ? health.aw.reachable : null} label="ActivityWatch" detail={health?.aw.url ?? "checking"} />
      <Dot
        ok={health ? health.ollama.reachable && health.ollama.modelAvailable : null}
        label="Ollama"
        detail={health ? `${health.ollama.url} (${health.ollama.model})` : "checking"}
      />
      <Dot ok={health ? true : null} label={sourceLabel} detail="Configured data source" />
    </div>
  );
}
