import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { apiErrorMessage, getCatalog, saveProfile } from "../lib/api";
import type { Catalog, Chip, Pace, Profile, ProfileInput, QuoteFrequency } from "../lib/types";
import { cn } from "../lib/utils";

const FALLBACK_CATALOG: Catalog = {
  workTools: [
    { id: "vscode", label: "VS Code / Cursor" }, { id: "terminal", label: "Terminal" }, { id: "google-docs", label: "Google Docs / Sheets" },
    { id: "notion", label: "Notion" }, { id: "word", label: "Word / Pages" }, { id: "dsa", label: "LeetCode / DSA sites" },
  ],
  distractions: [
    { id: "youtube", label: "YouTube" }, { id: "instagram", label: "Instagram" }, { id: "reddit", label: "Reddit" },
    { id: "x", label: "X / Twitter" }, { id: "netflix", label: "Netflix / Prime / Hotstar" }, { id: "whatsapp", label: "WhatsApp / Telegram" },
  ],
  goalIdeas: ["Crack DSA for placements", "Finish my thesis chapter", "Learn React properly", "Prepare for exams"],
};

const PACES: { id: Pace; label: string; hint: string }[] = [
  { id: "gentle", label: "Gentle", hint: "Speaks up after ~2 min" },
  { id: "balanced", label: "Balanced", hint: "After ~45 sec" },
  { id: "demo", label: "Demo", hint: "Very fast, for showing off" },
];

const QUOTES: { id: QuoteFrequency; label: string }[] = [
  { id: "often", label: "Often" },
  { id: "sometimes", label: "Sometimes" },
  { id: "rarely", label: "Rarely" },
];

function ChipToggle({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "cursor-pointer rounded-full border px-3 py-1.5 text-sm transition-colors",
        selected ? "border-primary bg-tint-saffron font-semibold text-heading" : "border-line bg-bg text-ink hover:border-line-strong",
      )}
    >
      {selected ? "✓ " : ""}
      {children}
    </button>
  );
}

function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: { id: T; label: string; hint?: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "cursor-pointer rounded-(--lh-radius-sm) border px-2 py-2 text-left transition-colors",
            value === o.id ? "border-primary bg-tint-saffron" : "border-line bg-bg hover:border-line-strong",
          )}
        >
          <span className="block text-sm font-semibold text-heading">{o.label}</span>
          {o.hint && <span className="block text-[11px] leading-4 text-muted">{o.hint}</span>}
        </button>
      ))}
    </div>
  );
}

/** Free-text add box (Enter adds) used for goals and custom apps/sites. */
function AddBox({ placeholder, onAdd, label, buttonLabel = "Add" }: { placeholder: string; onAdd: (v: string) => void; label: string; buttonLabel?: string }) {
  const [v, setV] = useState("");
  const add = () => {
    if (v.trim()) onAdd(v.trim());
    setV("");
  };
  return (
    <div className="flex gap-2">
      <input
        aria-label={label}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        placeholder={placeholder}
        className="h-10 min-w-0 flex-1 rounded-(--lh-radius-sm) border border-line-strong bg-bg px-3 text-sm text-ink placeholder:text-muted"
      />
      <Button variant="outline" onClick={add} disabled={!v.trim()}>
        {buttonLabel}
      </Button>
    </div>
  );
}

function ChipPicker({ chips, selected, onToggle, customLabel, customPlaceholder }: {
  chips: Chip[];
  selected: string[];
  onToggle: (id: string) => void;
  customLabel: string;
  customPlaceholder: string;
}) {
  const known = new Set(chips.map((c) => c.id));
  const custom = selected.filter((s) => !known.has(s));
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <ChipToggle key={c.id} selected={selected.includes(c.id)} onClick={() => onToggle(c.id)}>
            {c.label}
          </ChipToggle>
        ))}
        {custom.map((c) => (
          <ChipToggle key={c} selected onClick={() => onToggle(c)}>
            {c}
          </ChipToggle>
        ))}
      </div>
      <AddBox label={customLabel} placeholder={customPlaceholder} onAdd={(v) => !selected.includes(v) && onToggle(v)} />
    </div>
  );
}

const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

export interface OnboardingProps {
  initial: Profile | null;
  onDone: (profile: Profile) => void;
  onCancel?: () => void;
}

export function Onboarding({ initial, onDone, onCancel }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [catalog, setCatalog] = useState<Catalog>(FALLBACK_CATALOG);
  const [form, setForm] = useState<ProfileInput>(() => ({
    name: initial?.name ?? "",
    age: initial?.age ?? null,
    goals: initial?.goals ?? [],
    workTools: initial?.workTools ?? [],
    distractions: initial?.distractions ?? ["youtube", "instagram"],
    pace: initial?.pace ?? "balanced",
    quotes: initial?.quotes ?? "sometimes",
    voice: initial?.voice ?? false,
    sounds: initial?.sounds ?? true,
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Profile | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const editing = initial !== null;

  useEffect(() => {
    getCatalog().then(setCatalog).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (step === 0) nameRef.current?.focus();
  }, [step]);

  const set = <K extends keyof ProfileInput>(k: K, v: ProfileInput[K]) => setForm((f) => ({ ...f, [k]: v }));
  const first = form.name.trim().split(/\s+/)[0] || "friend";
  const canNext = step === 0 ? form.name.trim().length > 0 : step === 1 ? form.goals.length > 0 : true;

  const finish = async () => {
    setSaving(true);
    setError(null);
    try {
      const age = form.age !== null && Number.isFinite(form.age) && form.age >= 5 && form.age <= 120 ? Math.round(form.age) : null;
      const res = await saveProfile({ ...form, name: form.name.trim(), age });
      if (res.profile) setSaved(res.profile);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canNext) return;
    if (step < 2) setStep(step + 1);
    else void finish();
  };

  if (saved) {
    return (
      <Shell mood="celebrate">
        <h1 className="font-serif text-[28px] leading-9 font-semibold text-heading">All set, {saved.name.split(" ")[0]}!</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink">
          I'm waking up in the <b>top-left corner</b> of your screen. Click me any time for a quote, a break or a chat. I'll nudge you
          kindly when you drift, and cheer when you come back.
        </p>
        <figure className="mt-5 border-l-[3px] border-saffron pl-4">
          <blockquote className="font-serif text-[17px] leading-7 text-heading italic">Arise, awake, and stop not till the goal is reached.</blockquote>
          <figcaption className="mt-1 text-xs text-muted">— Swami Vivekananda</figcaption>
        </figure>
        <Button size="lg" className="mt-6" onClick={() => onDone(saved)}>
          Open my dashboard
        </Button>
      </Shell>
    );
  }

  return (
    <Shell mood={step === 0 ? "wave" : "idle"}>
      <form onSubmit={submit} aria-label="Set up Leo" className="flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase" aria-live="polite">
            Step {step + 1} of 3
          </p>
          <div className="flex gap-1.5" aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <span key={i} className={cn("h-1.5 w-8 rounded-full", i <= step ? "bg-saffron" : "bg-line")} />
            ))}
          </div>
        </div>

        {step === 0 && (
          <>
            <div>
              <h1 className="font-serif text-[28px] leading-9 font-semibold text-heading">{editing ? "Hello again!" : "Namaste! I'm Leo."}</h1>
              <p className="mt-1.5 text-[15px] text-ink">A little lion who sits on your desktop and helps you stay with what matters.</p>
            </div>
            <div className="grid grid-cols-[1fr_96px] gap-3">
              <label className="block">
                <span className="text-sm font-medium text-ink">What should I call you?</span>
                <input
                  ref={nameRef}
                  value={form.name}
                  maxLength={40}
                  onChange={(e) => set("name", e.target.value)}
                  placeholder="Your name"
                  className="mt-1.5 h-11 w-full rounded-(--lh-radius-sm) border border-line-strong bg-bg px-3 text-[15px] text-ink placeholder:text-muted"
                />
              </label>
              <label className="block">
                <span className="text-sm font-medium text-ink">Age</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={120}
                  value={form.age ?? ""}
                  onChange={(e) => set("age", e.target.value === "" ? null : Number(e.target.value))}
                  placeholder="21"
                  className="mt-1.5 h-11 w-full rounded-(--lh-radius-sm) border border-line-strong bg-bg px-3 text-[15px] text-ink placeholder:text-muted"
                />
              </label>
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <div>
              <h1 className="font-serif text-[26px] leading-8 font-semibold text-heading">What are you working toward, {first}?</h1>
              <p className="mt-1 text-sm text-muted">I judge every app and tab against these. Add one or more.</p>
            </div>
            <div className="space-y-2.5">
              {form.goals.length > 0 && (
                <ul className="flex flex-wrap gap-2" aria-label="Your goals">
                  {form.goals.map((g) => (
                    <li key={g} className="inline-flex items-center gap-1.5 rounded-full bg-tint-saffron px-3 py-1.5 text-sm font-semibold text-heading">
                      {g}
                      <button type="button" aria-label={`Remove ${g}`} className="cursor-pointer text-muted hover:text-heading" onClick={() => set("goals", form.goals.filter((x) => x !== g))}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <AddBox label="Add a goal" placeholder="e.g. Crack DSA for placements" buttonLabel="Add goal" onAdd={(v) => !form.goals.includes(v) && form.goals.length < 8 && set("goals", [...form.goals, v])} />
              <div className="flex flex-wrap gap-1.5">
                {catalog.goalIdeas.filter((g) => !form.goals.includes(g)).slice(0, 6).map((g) => (
                  <button key={g} type="button" onClick={() => set("goals", [...form.goals, g])} className="cursor-pointer rounded-full border border-dashed border-line-strong px-2.5 py-1 text-xs text-muted hover:text-heading">
                    + {g}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-ink">Where does the work happen?</p>
              <ChipPicker chips={catalog.workTools} selected={form.workTools} onToggle={(id) => set("workTools", toggle(form.workTools, id))} customLabel="Add a work app or site" customPlaceholder="Another app or site (e.g. overleaf.com)" />
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <div>
              <h1 className="font-serif text-[26px] leading-8 font-semibold text-heading">What usually pulls you away?</h1>
              <p className="mt-1 text-sm text-muted">No judgement. I'll just keep an eye out.</p>
            </div>
            <ChipPicker chips={catalog.distractions} selected={form.distractions} onToggle={(id) => set("distractions", toggle(form.distractions, id))} customLabel="Add a distraction" customPlaceholder="Another app or site" />
            <div>
              <p className="mb-2 text-sm font-medium text-ink">How quickly should I speak up?</p>
              <Segmented label="Nudge pace" value={form.pace} options={PACES} onChange={(v) => set("pace", v)} />
            </div>
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-sm font-medium text-ink">Swamiji's quotes &amp; facts</p>
                <Segmented label="Quote frequency" value={form.quotes} options={QUOTES} onChange={(v) => set("quotes", v)} />
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={form.sounds} onChange={(e) => set("sounds", e.target.checked)} className="h-4 w-4 accent-[var(--lh-saffron)]" />
                  Soft chime with nudges
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={form.voice} onChange={(e) => set("voice", e.target.checked)} className="h-4 w-4 accent-[var(--lh-saffron)]" />
                  Let Leo speak out loud
                </label>
              </div>
            </div>
          </>
        )}

        {error && (
          <p role="alert" className="rounded-(--lh-radius-sm) bg-tint-maroon px-3 py-2 text-sm text-heading">
            {error}
          </p>
        )}

        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
            {onCancel && step === 0 && (
              <Button variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            )}
          </div>
          <Button type="submit" size="lg" disabled={!canNext || saving}>
            {step < 2 ? "Next" : saving ? "Waking Leo…" : editing ? "Save" : "Meet Leo"}
          </Button>
        </div>
      </form>
    </Shell>
  );
}

function Shell({ children, mood }: { children: ReactNode; mood: "wave" | "idle" | "celebrate" }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-3xl flex-col items-center gap-6 md:flex-row md:items-start">
        <div className="shrink-0 pt-4 text-center" aria-hidden="true">
          <img
            src="/leo.svg"
            alt=""
            width={150}
            height={172}
            className={cn("mx-auto", mood === "wave" && "animate-[leo-hop_2.6s_ease-in-out_infinite]", mood === "celebrate" && "animate-[leo-hop_0.9s_ease-in-out_3]")}
          />
          <p className="mt-2 font-serif text-sm text-muted italic">Leo</p>
        </div>
        <Card className="w-full p-6 sm:p-8">{children}</Card>
      </div>
    </div>
  );
}
