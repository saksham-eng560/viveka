import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "../components/ui/button";

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

interface Props {
  text: string;
  /** Milliseconds per character. */
  speedMs?: number;
  /** Render revealed text (e.g. through react-markdown). */
  render: (visible: string) => ReactNode;
  onDone?: () => void;
}

/** Reveals `text` progressively. Instant under prefers-reduced-motion. */
export function Typewriter({ text, speedMs = 10, render, onDone }: Props) {
  const [count, setCount] = useState(() => (prefersReducedMotion() ? text.length : 0));

  useEffect(() => {
    if (prefersReducedMotion()) {
      setCount(text.length);
      return;
    }
    setCount(0);
    // Keep long outputs under ~5s: reveal several chars per tick when needed.
    const step = Math.max(1, Math.ceil(text.length / 500));
    const id = setInterval(() => {
      setCount((c) => {
        const next = Math.min(text.length, c + step);
        if (next >= text.length) clearInterval(id);
        return next;
      });
    }, speedMs);
    return () => clearInterval(id);
  }, [text, speedMs]);

  const done = count >= text.length;

  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  useEffect(() => {
    if (done) onDoneRef.current?.();
  }, [done]);

  return (
    <div>
      <div aria-live="polite" aria-busy={!done} data-testid="typewriter-output">
        {render(text.slice(0, count))}
        {!done && <span className="caret ml-0.5 inline-block h-4 w-0.5 translate-y-0.5 bg-indigo-500" aria-hidden="true" />}
      </div>
      {!done && (
        <div className="mt-3">
          <Button variant="ghost" size="sm" onClick={() => setCount(text.length)}>
            Skip
          </Button>
        </div>
      )}
    </div>
  );
}
