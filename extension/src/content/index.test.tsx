import { act } from "react";
import { describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("content script entry", () => {
  it("registers one listener and mounts at most one host when executed twice", async () => {
    delete window.__lighthouseCS;
    const addListener = vi.spyOn(chrome.runtime.onMessage, "addListener");
    vi.resetModules();
    await import("./index");
    vi.resetModules();
    await import("./index");
    expect(addListener).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll("#lighthouse-nudge-host").length).toBeLessThanOrEqual(1);
    delete window.__lighthouseCS;
  });

  it("renders the new nudge copy in a shadow root and relays button actions", async () => {
    delete window.__lighthouseCS;
    let listener: ((m: unknown) => void) | undefined;
    vi.spyOn(chrome.runtime.onMessage, "addListener").mockImplementation((fn) => void (listener = fn as (m: unknown) => void));
    vi.resetModules();
    await import("./index");
    await act(async () =>
      listener?.({
        type: "TRIGGER_NUDGE",
        payload: { score: 12, category: "Distraction", reasoning: "", goal: "Write", url: "https://x.com", hostname: "x.com", minutesLeft: null },
      }),
    );
    const shadow = document.getElementById("lighthouse-nudge-host")!.shadowRoot!;
    expect(shadow.textContent).toContain("x.com may be drawing you away from 'Write'.");
    expect(shadow.textContent).toContain("— Swami Vivekananda, Complete Works");
    await act(async () => [...shadow.querySelectorAll("button")].find((b) => b.textContent === "Not now")!.click());
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: "NUDGE_ACTION", action: "dismiss" });
    delete window.__lighthouseCS;
  });
});
