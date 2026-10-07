import { useCallback, useEffect, useState } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { buddyAction, getToday, saveProfile } from "../lib/api";
import { formatDuration as fmtDuration } from "../lib/format";
import type { Pace, Profile, TodayResponse } from "../lib/types";
import { cn } from "../lib/utils";

const VERDICT = {
  focus: { label: "On track", dot: "bg-ok" },
  neutral: { label: "In between", dot: "bg-neutral-tone" },
  distraction: { label: "Taking a detour", dot: "bg-distraction" },
} as const;

function Conn({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <li className="flex items-start gap-2 text-xs" title={hint}>
      <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", ok ? "bg-ok" : "bg-line-strong")} aria-hidden="true" />
      <span>
        <span className="font-semibold text-ink">{label}</span>
        <span className="sr-only">{ok ? " connected" : " not connected"}</span>
        {!ok && <span className="block text-muted">{hint}</span>}
      </span>
    </li>
  );
}

const PACES: { id: Pace; label: string }[] = [
  { id: "gentle", label: "Gentle" },
  { id: "balanced", label: "Balanced" },
  { id: "demo", label: "Demo" },
];

export function LeoPanel({ profile, onProfile }: { profile: Profile; onProfile: (p: Profile) => void }) {
  const [today, setToday] = useState<TodayResponse | null>(null);
  const [offline, setOffline] = useState(false);

  const load = useCallback(() => {
    getToday()
      .then((t) => {
        setToday(t);
        setOffline(false);
      })
      .catch(() => setOffline(true));
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);

  const setPace = async (pace: Pace) => {
    const { overrides: _o, createdAt: _c, updatedAt: _u, ...input } = profile;
    const res = await saveProfile({ ...input, pace }).catch(() => null);
    if (res?.profile) onProfile(res.profile);
  };
  const act = (a: string, minutes?: number) => void buddyAction(a, minutes).then(load).catch(() => undefined);

  const st = today?.state;
  const now = st?.now;
  const v = now ? VERDICT[now.verdict] : null;
  const focus = today?.focusSeconds ?? 0;
  const detour = today?.distractionSeconds ?? 0;
  const pct = focus + detour > 0 ? Math.round((focus / (focus + detour)) * 100) : null;
  const nudges = (today?.alerts ?? []).filter((a) => ["distraction", "stall", "nudge"].includes(a.kind)).slice(-4).reverse();

  return (
    <Card className="overflow-hidden" data-testid="leo-panel">
      <div className="grid gap-0 md:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="flex gap-4 p-5">
          <img src="/leo.svg" alt="Leo the lion cub" width={92} height={106} className="shrink-0 self-start" />
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-[20px] leading-7 font-semibold text-heading">
              {st?.away ? `Leo is napping until you're back` : `Leo is with you, ${profile.name.split(" ")[0]}`}
            </h2>
            {offline && <p className="mt-1 text-sm text-muted">Can't reach Leo's brain. Is ./start.sh running?</p>}
            {now && v && !st?.away && (
              <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-ink" data-testid="leo-now">
                <span className={cn("h-2.5 w-2.5 rounded-full", v.dot)} aria-hidden="true" />
                <b>{v.label}</b>
                <span className="text-muted">· {now.label}</span>
                {now.reason && <span className="w-full text-xs text-muted">{now.reason}</span>}
              </p>
            )}
            <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Your goals">
              {profile.goals.map((g) => (
                <li key={g} className="rounded-full bg-tint-saffron px-2.5 py-1 text-xs font-semibold text-heading">
                  {g}
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => act("quote")}>Swamiji quote</Button>
              <Button size="sm" variant="outline" onClick={() => act("fact")}>Fun fact</Button>
              <Button size="sm" variant="outline" onClick={() => act("break", 5)}>5-min break</Button>
              {st?.hushUntil ? (
                <Button size="sm" variant="outline" onClick={() => act("resume")}>Wake Leo</Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => act("hush", 30)}>Quiet 30 min</Button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4 border-t border-line bg-bg/40 p-5 md:border-t-0 md:border-l">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="font-serif text-[22px] leading-7 font-semibold text-heading tabular-nums" data-testid="today-focus">{fmtDuration(focus)}</div>
              <div className="text-[11px] text-muted">focused today</div>
            </div>
            <div>
              <div className="font-serif text-[22px] leading-7 font-semibold text-heading tabular-nums">{fmtDuration(detour)}</div>
              <div className="text-[11px] text-muted">detours</div>
            </div>
            <div>
              <div className="font-serif text-[22px] leading-7 font-semibold text-heading tabular-nums">{pct === null ? "–" : `${pct}%`}</div>
              <div className="text-[11px] text-muted">on track</div>
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-semibold text-muted">Nudge pace</p>
            <div role="radiogroup" aria-label="Nudge pace" className="inline-flex rounded-full border border-line bg-bg p-0.5">
              {PACES.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={profile.pace === p.id}
                  onClick={() => void setPace(p.id)}
                  className={cn(
                    "cursor-pointer rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                    profile.pace === p.id ? "bg-primary text-primary-fg" : "text-ink hover:bg-surface",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <ul className="space-y-1.5" aria-label="Connections">
            <Conn ok={!!st?.buddyOnline} label="Leo on your desktop" hint="Starts with ./start.sh (macOS)." />
            <Conn ok={!!st?.extensionOnline} label="Browser extension" hint="Opened automatically by ./start.sh, or load extension/dist." />
            <Conn ok={st?.llmOnline !== false} label="Local model (Ollama)" hint="Without it Leo uses friendly templates." />
            {st?.buddyOnline && !st.axTrusted && (
              <Conn ok={false} label="Window titles" hint="Allow Accessibility for your Terminal to let Leo read window titles." />
            )}
          </ul>
        </div>
      </div>

      {nudges.length > 0 && (
        <div className="border-t border-line px-5 py-3">
          <p className="mb-1.5 text-xs font-semibold text-muted">Recent nudges</p>
          <ul className="space-y-1">
            {nudges.map((n) => (
              <li key={n.ts + n.text} className="flex gap-2 text-xs text-ink">
                <span className="w-12 shrink-0 text-muted tabular-nums">
                  {new Date(n.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
                <span className="min-w-0 truncate">{n.text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
