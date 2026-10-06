import { describe, expect, it, vi } from "vitest";

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
});
