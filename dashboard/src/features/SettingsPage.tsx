import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { apiErrorMessage, clearHistory, getSettings, resetProfile, saveSettings, voicePreview } from "../lib/api";
import type { Pace, Personality, Profile, QuoteFrequency, SettingsPatch, SettingsView, SheruSettings, TimingKey } from "../lib/types";
import { cn } from "../lib/utils";

// ------------------------------------------------------------------------- bits
function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="font-serif text-[19px] leading-7 font-semibold text-heading">{title}</h2>
      {hint && <p className="mt-0.5 text-sm text-muted">{hint}</p>}
      <div className="mt-4 space-y-4">{children}</div>
    </Card>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink">{label}</p>
        {hint && <p className="text-xs leading-5 text-muted">{hint}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn("relative h-7 w-12 cursor-pointer rounded-full transition-colors", checked ? "bg-primary" : "bg-line-strong")}
    >
      <span
        className="absolute top-1 left-1 h-5 w-5 rounded-full bg-bg shadow transition-transform"
        style={{ transform: checked ? "translateX(20px)" : "none" }}
        aria-hidden="true"
      />
    </button>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap rounded-full border border-line bg-bg p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
            value === o.id ? "bg-primary text-primary-fg" : "text-ink hover:bg-surface",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Slider that shows its value live and commits after a short pause (one save per drag). */
function Slider({ value, min, max, step, onCommit, format, label }: {
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
  format: (v: number) => string;
  label: string;
}) {
  const [local, setLocal] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setLocal(value), [value]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <div className="flex w-full items-center gap-3 sm:w-72">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={local}
        onChange={(e) => {
          const v = Number(e.target.value);
          setLocal(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => onCommit(v), 350);
        }}
        className="h-2 w-full cursor-pointer accent-[var(--lh-saffron)]"
      />
      <span className="w-16 shrink-0 text-right text-sm font-semibold text-heading tabular-nums">{format(local)}</span>
    </div>
  );
}

const fmtSecs = (s: number) => (s < 60 ? `${Math.round(s)} s` : s % 60 === 0 ? `${s / 60} min` : `${(s / 60).toFixed(1)} min`);

const TIMINGS: { key: TimingKey; label: string; hint: string; min: number; max: number; step: number }[] = [
  { key: "headsup", label: '"Wrong tab?" heads-up after', hint: "How long on an off-goal tab or app before the gentle note.", min: 1, max: 60, step: 1 },
  { key: "distraction", label: "First detour alert after", hint: "The stronger alert with Back to work / 2 more min.", min: 5, max: 600, step: 5 },
  { key: "repeat", label: "Follow-up alerts every", hint: "If you stay on the detour.", min: 20, max: 1800, step: 10 },
  { key: "stall", label: "Writing-stall step", hint: "Silence in a writing app before each of the three stall nudges.", min: 10, max: 600, step: 5 },
  { key: "afk", label: "Nap when idle for", hint: "No keyboard or mouse: Sheru naps and stays quiet.", min: 60, max: 1800, step: 30 },
  { key: "snooze", label: '"2 more min" snooze', hint: "How long alerts pause when you snooze.", min: 10, max: 900, step: 5 },
  { key: "breakLen", label: "Break length", hint: '"Take a break" from an alert.', min: 60, max: 1800, step: 30 },
];

const DETECTORS: { key: keyof SheruSettings["detectors"]; label: string; hint: string }[] = [
  { key: "headsup", label: '"Wrong tab?" heads-up', hint: "A soft note a few seconds after you land somewhere off-goal." },
  { key: "detour", label: "Detour alerts", hint: "Stronger alerts if you stay off-goal." },
  { key: "stall", label: "Writing stalls", hint: 'Two gentle nudges, then "you seem distracted" when typing stops.' },
  { key: "hopping", label: "Tab hopping", hint: "Notices rapid switching between apps and sites." },
  { key: "streak", label: "Focus streaks", hint: "Celebrates long stretches of focus." },
  { key: "welcomeBack", label: "Welcome back", hint: "A hello when you return after a while." },
];

const PERSONALITIES: { id: Personality; label: string; hint: string }[] = [
  { id: "gentle", label: "Gentle", hint: "Soft and calm, no teasing." },
  { id: "playful", label: "Playful", hint: "Warm, funny lion-cub energy (default)." },
  { id: "coach", label: "Coach", hint: "Upbeat and direct, still kind." },
];

function prettyOverride(key: string): { name: string; kind: string } {
  const [kind, ...rest] = key.split(":");
  return { name: rest.join(":"), kind: kind === "web" ? "website" : "app" };
}

// ------------------------------------------------------------------------- page
export function SettingsPage({ profile, onEditGoals, onStartOver }: {
  profile: Profile;
  onEditGoals: () => void;
  onStartOver: () => void;
}) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [previewing, setPreviewing] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<SettingsView | null>(null); // newest local state, so quick successive edits build on each other
  useEffect(() => { latest.current = view; }, [view]);

  useEffect(() => {
    getSettings().then(setView).catch((e: unknown) => setError(apiErrorMessage(e)));
  }, []);
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  const save = useCallback(async (patch: SettingsPatch) => {
    setStatus("saving");
    setError(null);
    try {
      setView(await saveSettings(patch));
      setStatus("saved");
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setStatus("idle"), 1800);
    } catch (e) {
      setError(apiErrorMessage(e));
      setStatus("idle");
    }
  }, []);

  if (!view) {
    return (
      <div className="space-y-4" aria-busy={!error}>
        {error ? <p role="alert" className="rounded-(--lh-radius) bg-tint-maroon p-4 text-sm text-heading">{error}</p>
          : <div className="h-40 animate-pulse rounded-(--lh-radius) bg-surface" />}
      </div>
    );
  }

  const s = view.settings;
  const update = (next: Partial<SheruSettings>) => {
    const cur = latest.current ?? view;
    const merged = { ...cur.settings, ...next };
    latest.current = { ...cur, settings: merged };
    setView(latest.current);
    void save({ settings: merged });
  };
  const setTiming = (key: TimingKey, value: number | null) =>
    update({ timings: { ...(latest.current ?? view).settings.timings, [key]: value } });
  const custom = TIMINGS.filter((t) => s.timings[t.key] != null).length;
  const v = s.voice;
  const overrides = Object.entries(view.overrides);
  const engine = view.voiceEngine;

  const preview = async () => {
    setPreviewing(true);
    try {
      const blob = await voicePreview(`Namaste, ${profile.name.split(" ")[0]}! Hmm, wrong tab? Let's hop back to your goal.`, v.voice, v.speed, v.pitch);
      const audio = new Audio(URL.createObjectURL(blob));
      (audio as HTMLAudioElement & { preservesPitch?: boolean }).preservesPitch = false; // pitch up like Sheru's page does
      audio.playbackRate = 1 + v.pitch / 100;
      audio.volume = v.volume;
      audio.onended = () => setPreviewing(false);
      await audio.play();
    } catch (e) {
      setError(apiErrorMessage(e));
      setPreviewing(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="settings-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-[26px] leading-8 font-semibold text-heading">Sheru's settings</h1>
          <p className="text-sm text-muted">Changes apply right away.</p>
        </div>
        <p className="text-sm font-semibold text-muted" role="status" aria-live="polite">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved ✓" : ""}
        </p>
      </div>
      {error && <p role="alert" className="rounded-(--lh-radius) bg-tint-maroon p-3 text-sm text-heading">{error}</p>}

      <Section title="Nudges" hint="Pick a pace, then fine-tune any timing.">
        <Row label="Pace" hint="Demo is very fast, made for showing Sheru to others.">
          <Segmented<Pace> label="Pace" value={view.pace} onChange={(pace) => void save({ pace })}
            options={[{ id: "gentle", label: "Gentle" }, { id: "balanced", label: "Balanced" }, { id: "demo", label: "Demo" }]} />
        </Row>
        {TIMINGS.map((t) => (
          <Row key={t.key} label={t.label} hint={s.timings[t.key] != null ? `${t.hint} (custom; preset: ${fmtSecs(view.presets[view.pace][t.key])})` : t.hint}>
            <Slider label={t.label} value={view.effective[t.key]} min={t.min} max={t.max} step={t.step} format={fmtSecs}
              onCommit={(val) => setTiming(t.key, val === view.presets[view.pace][t.key] ? null : val)} />
          </Row>
        ))}
        {custom > 0 && (
          <Button variant="outline" size="sm" onClick={() => update({ timings: {} })}>
            Reset {custom} custom timing{custom === 1 ? "" : "s"} to the {view.pace} preset
          </Button>
        )}
      </Section>

      <Section title="What Sheru watches for">
        {DETECTORS.map((d) => (
          <Row key={d.key} label={d.label} hint={d.hint}>
            <Switch label={d.label} checked={s.detectors[d.key]} onChange={(on) => update({ detectors: { ...s.detectors, [d.key]: on } })} />
          </Row>
        ))}
      </Section>

      <Section title="Voice & sounds" hint={
        engine.engine === "neural" ? "Natural voice, generated on this Mac. Nothing is sent anywhere."
          : engine.engine === "system" ? "Using the macOS voice. For Sheru's natural voice run ./setup.sh (one-time ~200 MB download)."
            : "No speech engine available on this computer."}>
        <Row label="Speak out loud" hint="Sheru reads his messages aloud.">
          <Switch label="Speak out loud" checked={view.voice} onChange={(on) => void save({ voice: on })} />
        </Row>
        <Row label="Voice">
          <select aria-label="Voice" value={engine.voices.some((x) => x.id === v.voice) ? v.voice : engine.voices[0]?.id}
            onChange={(e) => update({ voice: { ...v, voice: e.target.value } })}
            className="h-9 w-full rounded-(--lh-radius-sm) border border-line-strong bg-bg px-2 text-sm text-ink sm:w-80">
            {engine.voices.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </Row>
        <Row label="Speed">
          <Slider label="Speed" value={v.speed} min={0.7} max={1.4} step={0.05} format={(x) => `${x.toFixed(2)}×`}
            onCommit={(speed) => update({ voice: { ...v, speed } })} />
        </Row>
        <Row label="Cub pitch" hint="A little higher sounds like a lion cub.">
          <Slider label="Cub pitch" value={v.pitch} min={-10} max={25} step={1} format={(x) => `${x > 0 ? "+" : ""}${x}%`}
            onCommit={(pitch) => update({ voice: { ...v, pitch } })} />
        </Row>
        <Row label="Volume">
          <Slider label="Volume" value={Math.round(v.volume * 100)} min={0} max={100} step={5} format={(x) => `${x}%`}
            onCommit={(vol) => update({ voice: { ...v, volume: vol / 100 } })} />
        </Row>
        <Row label="Read aloud" hint="Important: heads-ups, alerts, greetings, chat. Everything: also quotes and facts.">
          <Segmented label="Read aloud" value={v.speak} onChange={(speak) => update({ voice: { ...v, speak } })}
            options={[{ id: "important", label: "Important" }, { id: "everything", label: "Everything" }]} />
        </Row>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => void preview()} disabled={previewing || engine.engine === "none"}>
            {previewing ? "Playing…" : "▶ Preview voice"}
          </Button>
          <span className="text-xs text-muted">Previews use the settings above.</span>
        </div>
        <Row label="Soft chimes" hint="A gentle sound with heads-ups and alerts.">
          <Switch label="Soft chimes" checked={view.sounds} onChange={(on) => void save({ sounds: on })} />
        </Row>
      </Section>

      <Section title="Personality & wisdom">
        <Row label="Personality" hint={PERSONALITIES.find((x) => x.id === s.personality)?.hint}>
          <Segmented<Personality> label="Personality" value={s.personality} onChange={(personality) => update({ personality })}
            options={PERSONALITIES.map(({ id, label }) => ({ id, label }))} />
        </Row>
        <Row label="Swamiji's quotes & facts" hint="In quiet moments, never while you're typing.">
          <Segmented<QuoteFrequency> label="Quote frequency" value={view.quotes} onChange={(quotes) => void save({ quotes })}
            options={[{ id: "often", label: "Often" }, { id: "sometimes", label: "Sometimes" }, { id: "rarely", label: "Rarely" }, { id: "off", label: "Off" }]} />
        </Row>
        <Row label="Use the local model" hint="Judges unclear tabs (e.g. YouTube) and writes Sheru's lines. Off: rules and written lines only.">
          <Switch label="Use the local model" checked={s.useAi} onChange={(useAi) => update({ useAi })} />
        </Row>
        <Row label="Status label on hover" hint='Shows "✓ On track · VS Code" when you hover over Sheru.'>
          <Switch label="Status label on hover" checked={s.showStatusChip} onChange={(showStatusChip) => update({ showStatusChip })} />
        </Row>
      </Section>

      <Section title="Always treated as work" hint={'Added when you click "It\'s for work" on an alert.'}>
        {overrides.length === 0 ? (
          <p className="text-sm text-muted">Nothing here yet.</p>
        ) : (
          <ul className="divide-y divide-line" aria-label="Always treated as work">
            {overrides.map(([key]) => {
              const o = prettyOverride(key);
              return (
                <li key={key} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-ink"><b>{o.name}</b> <span className="text-muted">({o.kind})</span></span>
                  <Button variant="outline" size="sm" aria-label={`Remove ${o.name}`}
                    onClick={() => void save({ overrides: Object.fromEntries(overrides.filter(([k]) => k !== key)) })}>
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>

      <Section title="You & your data" hint="Everything stays on this Mac (.data/ in the project folder).">
        <Row label={profile.name} hint={`Goals: ${profile.goals.join(" · ")}`}>
          <Button variant="primary" size="sm" onClick={onEditGoals}>Edit goals & distractions</Button>
        </Row>
        <Row label="Clear activity history" hint="Deletes the logged timeline and nudges. Keeps your profile and settings.">
          <Button variant="outline" size="sm" onClick={() => {
            if (window.confirm("Delete all of Sheru's activity history? This cannot be undone.")) {
              clearHistory().then(() => setStatus("saved")).catch((e: unknown) => setError(apiErrorMessage(e)));
            }
          }}>Clear history</Button>
        </Row>
        <Row label="Start over" hint="Forgets your profile and settings and runs onboarding again.">
          <Button variant="outline" size="sm" onClick={() => {
            if (window.confirm("Forget your profile and settings and start onboarding again?")) {
              resetProfile().then(onStartOver).catch((e: unknown) => setError(apiErrorMessage(e)));
            }
          }}>Start over</Button>
        </Row>
      </Section>
    </div>
  );
}
