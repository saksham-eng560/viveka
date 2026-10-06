import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { QUOTES, quoteFor } from "../shared/quotes";
import type { NudgePayload } from "../shared/types";
import { Overlay } from "./Overlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const payload: NudgePayload = {
  score: 10,
  category: "Distraction",
  reasoning: "Humor content unrelated to the dashboard.",
  goal: "Building a React dashboard",
  url: "https://www.reddit.com/r/funny",
  hostname: "reddit.com",
  minutesLeft: 25,
};

async function mountInShadow(p: NudgePayload | null, onAction = vi.fn()) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const mount = document.createElement("div");
  shadow.appendChild(mount);
  const root = createRoot(mount);
  await act(async () => root.render(<Overlay payload={p} onAction={onAction} />));
  return { shadow, onAction, root };
}

describe("Overlay", () => {
  it("renders goal, score, headline and minutes left inside a shadow root", async () => {
    const { shadow } = await mountInShadow(payload);
    const text = shadow.textContent ?? "";
    expect(text).toContain("reddit.com may be drawing you away from 'Building a React dashboard'.");
    expect(text).toContain("25 mins left in your focus block.");
    expect(shadow.querySelector('[data-testid="nudge-score"]')?.textContent).toBe("Focus 10/100");
    expect(document.body.textContent).not.toContain("drawing you away");
  });

  it("omits the timer line for untimed sessions", async () => {
    const { shadow } = await mountInShadow({ ...payload, minutesLeft: null });
    expect(shadow.textContent).not.toContain("focus block");
  });

  it("emits NUDGE_ACTION choices from the buttons", async () => {
    const { shadow, onAction } = await mountInShadow(payload);
    const buttons = [...shadow.querySelectorAll("button")];
    await act(async () => buttons.find((b) => b.textContent === "Not now")!.click());
    await act(async () => buttons.find((b) => b.textContent === "Return to work")!.click());
    expect(onAction.mock.calls).toEqual([["dismiss"], ["back_to_work"]]);
  });

  it("shows a deterministic nudge-pool quote with attribution", async () => {
    const { shadow } = await mountInShadow(payload);
    const q = quoteFor("nudge", "reddit.com|Building a React dashboard|10");
    expect(["q9", "q2", "q3", "q10"]).toContain(q.id);
    expect(QUOTES).toContainEqual(q);
    const text = shadow.textContent ?? "";
    expect(text).toContain(q.text);
    expect(text).toContain(`— Swami Vivekananda, ${q.source}`);
  });

  it("renders under reduced motion", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      onchange: null,
      dispatchEvent: vi.fn(),
    }));
    const { shadow } = await mountInShadow(payload);
    expect(shadow.querySelector('[data-testid="lighthouse-nudge"]')).not.toBeNull();
  });

  it("renders nothing without a payload", async () => {
    const { shadow } = await mountInShadow(null);
    expect(shadow.querySelector('[data-testid="lighthouse-nudge"]')).toBeNull();
  });
});

describe("Overlay with a message from Sheru's brain", () => {
  const brainPayload: NudgePayload = {
    ...payload,
    brain: {
      id: 9, kind: "distraction", title: "Psst!", text: "Instagram is cute, but DSA is cuter. Shall we hop back?", level: 1,
      actions: [{ id: "back_to_work", label: "Back to work" }, { id: "snooze", label: "2 more min" }, { id: "its_work", label: "It's for work" }, { id: "weird", label: "Ignored" }],
    },
  };

  it("shows Sheru's own words and only known buttons, without the legacy score and quote", async () => {
    const { shadow, onAction } = await mountInShadow(brainPayload);
    const text = shadow.textContent ?? "";
    expect(text).toContain("Psst!");
    expect(text).toContain("DSA is cuter");
    expect(shadow.querySelector('[data-testid="nudge-score"]')).toBeNull();
    expect(shadow.querySelector('[data-testid="quote"]')).toBeNull();
    const labels = [...shadow.querySelectorAll("button")].map((b) => b.textContent);
    expect(labels).toEqual(["×", "Back to work", "2 more min", "It's for work"]);
    await act(async () => [...shadow.querySelectorAll("button")].find((b) => b.textContent === "2 more min")!.click());
    await act(async () => [...shadow.querySelectorAll("button")].find((b) => b.textContent === "×")!.click());
    expect(onAction.mock.calls).toEqual([["snooze"], ["dismiss"]]);
  });

  it("shows Sheru's picture from the extension", async () => {
    const { shadow } = await mountInShadow(brainPayload);
    expect(shadow.querySelector("img")?.getAttribute("src")).toContain("sheru.svg");
  });
});
