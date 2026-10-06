import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { CSSProperties } from "react";
import { minutesLeftText, nudgeHeadline } from "../shared/format";
import type { NudgeActionKind } from "../shared/messages";
import { quoteFor } from "../shared/quotes";
import type { NudgePayload } from "../shared/types";

interface OverlayProps {
  payload: NudgePayload | null;
  onAction: (action: NudgeActionKind) => void;
}

// Friendly, light-only palette shared with Sheru's desktop bubble.
const C = {
  cream: "#FFF9EE",
  alert: "#FFF2E8",
  line: "#F2C27B",
  alertLine: "#F4A26B",
  ink: "#3A2416",
  muted: "#8A6A55",
  saffron: "#EE7F1B",
  saffronDark: "#C9640F",
  maroon: "#7A2E1D",
};
const FONT = 'ui-rounded, "SF Pro Rounded", "Nunito", -apple-system, "Segoe UI", system-ui, sans-serif';
const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

const KNOWN_ACTIONS = new Set<NudgeActionKind>(["dismiss", "back_to_work", "snooze", "its_work"]);

function sheruUrl(): string | null {
  try {
    return chrome.runtime.getURL("sheru.svg");
  } catch {
    return null;
  }
}

function Pill({ primary, onClick, children }: { primary?: boolean; onClick: () => void; children: string }) {
  const style: CSSProperties = {
    font: `700 12.5px/1 ${FONT}`,
    padding: "8px 13px",
    borderRadius: 999,
    cursor: "pointer",
    border: `1.5px solid ${primary ? C.saffron : C.line}`,
    background: primary ? C.saffron : "#FFFFFF",
    color: primary ? "#FFFFFF" : C.maroon,
  };
  return (
    <button type="button" onClick={onClick} style={style}>
      {children}
    </button>
  );
}

export function Overlay({ payload, onAction }: OverlayProps) {
  const reduce = useReducedMotion();
  const brain = payload?.brain;
  const mins = payload && !brain ? minutesLeftText(payload.minutesLeft) : null;
  const quote = payload && !brain ? quoteFor("nudge", `${payload.hostname}|${payload.goal}|${payload.score}`) : null;
  const img = sheruUrl();
  const actions: { id: NudgeActionKind; label: string }[] = brain
    ? brain.actions.filter((a): a is { id: NudgeActionKind; label: string } => KNOWN_ACTIONS.has(a.id as NudgeActionKind))
    : [
        { id: "back_to_work", label: "Return to work" },
        { id: "dismiss", label: "Not now" },
      ];
  if (brain && actions.length === 0) actions.push({ id: "dismiss", label: "Got it" });
  const warm = !!brain && (brain.kind === "distraction" || brain.level >= 3);

  return (
    <AnimatePresence>
      {payload && (
        <motion.div
          key="lighthouse-nudge"
          role="status"
          aria-live="polite"
          data-testid="lighthouse-nudge"
          initial={reduce ? { opacity: 0 } : { opacity: 0, x: -24, scale: 0.92 }}
          animate={reduce ? { opacity: 1 } : { opacity: 1, x: 0, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, x: -16, scale: 0.95 }}
          transition={reduce ? { duration: 0.15 } : { type: "spring", stiffness: 380, damping: 24 }}
          style={{
            position: "fixed",
            left: 16,
            top: 16,
            zIndex: 2147483647,
            display: "flex",
            alignItems: "flex-start",
            gap: 4,
            maxWidth: "calc(100vw - 32px)",
            fontFamily: FONT,
            color: C.ink,
          }}
        >
          {img && (
            <img
              src={img}
              alt=""
              width={78}
              height={90}
              style={{ flex: "none", width: 78, height: "auto", marginTop: 2, filter: "drop-shadow(0 3px 6px rgba(40,20,8,.2))" }}
            />
          )}
          <div
            style={{
              position: "relative",
              width: 340,
              maxWidth: "calc(100vw - 130px)",
              padding: "13px 15px 14px",
              borderRadius: 18,
              background: warm ? C.alert : C.cream,
              border: `2px solid ${warm ? C.alertLine : C.line}`,
              boxShadow: "0 12px 30px rgba(58,36,22,.24), 0 2px 0 rgba(58,36,22,.06)",
            }}
          >
            <button
              type="button"
              aria-label="Close"
              onClick={() => onAction("dismiss")}
              style={{
                position: "absolute",
                top: 6,
                right: 8,
                border: 0,
                background: "transparent",
                color: C.muted,
                fontSize: 18,
                lineHeight: "18px",
                cursor: "pointer",
                padding: 2,
              }}
            >
              ×
            </button>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 18 }}>
              <span style={{ font: `800 12.5px/1.2 ${FONT}`, color: C.saffronDark }}>
                {brain ? brain.title || "Psst!" : "Sheru noticed"}
              </span>
              {!brain && (
                <span
                  data-testid="nudge-score"
                  style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#F8E5C2", color: C.maroon }}
                >
                  Focus {payload.score}/100
                </span>
              )}
            </div>
            <p data-testid="nudge-headline" style={{ margin: "5px 0 0", font: `600 15px/1.42 ${FONT}`, color: C.ink }}>
              {brain ? brain.text : nudgeHeadline(payload)}
            </p>
            {!brain && payload.reasoning && (
              <p style={{ margin: "5px 0 0", fontSize: 12, lineHeight: 1.4, color: C.muted }}>{payload.reasoning}</p>
            )}
            {mins && <p style={{ margin: "5px 0 0", fontSize: 12, fontWeight: 600, color: C.ink }}>{mins}</p>}
            {quote && (
              <figure data-testid="quote" style={{ margin: "10px 0 0", paddingLeft: 10, borderLeft: `3px solid ${C.saffron}` }}>
                <blockquote style={{ margin: 0, font: `italic 14px/1.45 ${SERIF}`, color: C.maroon }}>{quote.text}</blockquote>
                <figcaption style={{ marginTop: 4, fontSize: 11, color: C.muted }}>— Swami Vivekananda, {quote.source}</figcaption>
              </figure>
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
              {actions.map((a, i) => (
                <Pill key={a.id} primary={i === 0} onClick={() => onAction(a.id)}>
                  {a.label}
                </Pill>
              ))}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
