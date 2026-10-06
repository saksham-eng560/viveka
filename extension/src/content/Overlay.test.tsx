import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
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
    expect(text).toContain("Taking a break? reddit.com doesn't align with 'Building a React dashboard'. (Score: 10/100).");
    expect(text).toContain("25 mins left in your Deep Work block.");
    expect(shadow.querySelector('[data-testid="nudge-score"]')?.textContent).toBe("10/100");
    expect(document.body.textContent).not.toContain("Taking a break");
  });

  it("omits the timer line for untimed sessions", async () => {
    const { shadow } = await mountInShadow({ ...payload, minutesLeft: null });
    expect(shadow.textContent).not.toContain("Deep Work block");
  });

  it("emits NUDGE_ACTION choices from the buttons", async () => {
    const { shadow, onAction } = await mountInShadow(payload);
    const buttons = [...shadow.querySelectorAll("button")];
    await act(async () => buttons.find((b) => b.textContent === "Dismiss")!.click());
    await act(async () => buttons.find((b) => b.textContent === "Back to Work")!.click());
    expect(onAction.mock.calls).toEqual([["dismiss"], ["back_to_work"]]);
  });

  it("renders nothing without a payload", async () => {
    const { shadow } = await mountInShadow(null);
    expect(shadow.querySelector('[data-testid="lighthouse-nudge"]')).toBeNull();
  });
});
