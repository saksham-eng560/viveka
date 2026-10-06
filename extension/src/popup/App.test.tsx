import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultSnapshot } from "../background/state";
import { jsonResponse } from "../test/chrome-mock";
import { App } from "./App";

const BRAIN_STATE = {
  profile: { firstName: "Saksham", goals: ["Crack DSA for placements", "Build my portfolio"], pace: "balanced" },
  mood: "idle",
  now: { label: "LeetCode", verdict: "focus", category: "Coding", reason: "One of your work tools." },
  away: false,
  breakUntil: null,
  hushUntil: null,
  buddyOnline: true,
  today: { focusSeconds: 3000, distractionSeconds: 420, alertCount: 2 },
};

function mockBackground() {
  (chrome.runtime as unknown as { sendMessage: unknown }).sendMessage = vi.fn(async () => ({ ok: true, data: defaultSnapshot() }));
}

describe("Popup", () => {
  it("never renders blank: greets by name and shows status, today and goals when the brain is up", async () => {
    mockBackground();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(BRAIN_STATE)));
    render(<App />);
    expect(await screen.findByText("Namaste, Saksham!")).toBeTruthy();
    expect(screen.getByTestId("brain-line").textContent).toContain("on your desktop");
    expect(screen.getByTestId("brain-status").textContent).toContain("On track");
    expect(screen.getByTestId("brain-status").textContent).toContain("LeetCode");
    expect(screen.getByTestId("brain-status").textContent).toContain("50m");
    expect(screen.getByTestId("goals").textContent).toContain("Build my portfolio");
    expect(screen.getByText("Edit goals")).toBeTruthy();
  });

  it("asks for goals when no profile exists yet", async () => {
    mockBackground();
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...BRAIN_STATE, profile: null, now: null })));
    render(<App />);
    expect(await screen.findByText("Set my goals")).toBeTruthy();
  });

  it("explains how to wake Sheru and still offers a browser-only session when the brain is down", async () => {
    mockBackground();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
    render(<App />);
    expect(await screen.findByTestId("brain-offline")).toBeTruthy();
    expect(screen.getByText("Start a browser-only session")).toBeTruthy();
    expect(screen.getByText(/Arise, awake/)).toBeTruthy();
  });
});
