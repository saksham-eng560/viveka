import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/api", async () => {
  const actual = await vi.importActual<typeof import("./lib/api")>("./lib/api");
  return {
    ...actual, getSummary: vi.fn(), getTimeline: vi.fn(), getHealth: vi.fn(), generateStandup: vi.fn(),
    getProfile: vi.fn(), getToday: vi.fn(), getCatalog: vi.fn(), saveProfile: vi.fn(), buddyAction: vi.fn(),
  };
});

import { getCatalog, getHealth, getProfile, getSummary, getTimeline, getToday } from "./lib/api";
import type { Profile } from "./lib/types";

export const PROFILE: Profile = {
  name: "Saksham Verma", age: 21, goals: ["Crack DSA for placements"], workTools: ["vscode", "dsa"],
  distractions: ["instagram"], pace: "balanced", quotes: "sometimes", voice: false, sounds: true,
  overrides: {}, createdAt: "2026-10-06T10:00:00Z", updatedAt: "2026-10-06T10:00:00Z",
};
import App from "./App";

const health = {
  status: "ok" as const,
  dataSource: "auto" as const,
  aw: { reachable: false, url: "http://localhost:5600" },
  ollama: { reachable: false, url: "http://localhost:11434", model: "qwen3.5:4b", modelAvailable: false },
};

describe("App", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", "/");
    vi.mocked(getProfile).mockResolvedValue({ exists: true, profile: PROFILE });
    vi.mocked(getCatalog).mockRejectedValue(new Error("offline"));
    vi.mocked(getToday).mockResolvedValue({
      focusSeconds: 3000, neutralSeconds: 0, distractionSeconds: 600, topFocus: [], topDistractions: [], alerts: [], alertCount: 1,
      state: {
        profile: null, mood: "idle", messages: [], lastId: 0, activeAlertId: null, away: false, breakUntil: null, hushUntil: null,
        buddyOnline: true, extensionOnline: false, axTrusted: true, llmOnline: true, stallLevel: 0,
        today: { focusSeconds: 3000, distractionSeconds: 600, alertCount: 1 },
        now: { label: "LeetCode", app: "Google Chrome", title: "Two Sum", domain: "leetcode.com", verdict: "focus", category: "Coding",
               reason: "One of your work tools.", source: "profile", writing: true, keyIdle: 1 },
      },
    });
    vi.mocked(getHealth).mockResolvedValue(health);
    vi.mocked(getSummary).mockResolvedValue({
      date: "2026-10-06",
      totalActiveSeconds: 3600,
      activeSeconds: 3000,
      distractionSeconds: 600,
      averageFocusScore: 80,
      topCategories: { Coding: 3000, Social: 600 },
      contextSwitches: 5,
      source: "sample",
    });
    vi.mocked(getTimeline).mockResolvedValue({ date: "2026-10-06", source: "sample", events: [] });
  });

  it("renders dashboard with sample badge, metrics and breakdown", async () => {
    render(<App />);
    expect(await screen.findByText("Sample data", { selector: "span.rounded-full" })).toBeInTheDocument();
    expect((await screen.findByTestId("metric-Active time"))).toHaveTextContent("50m");
    expect(screen.getByText("Coding")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate Standup" })).toBeInTheDocument();
    expect(screen.getByText("ActivityWatch")).toBeInTheDocument();
  });

  it("shows the Local model status label and the new footer", async () => {
    render(<App />);
    expect(await screen.findByText("Local model")).toBeInTheDocument();
    expect(screen.queryByText("Ollama")).not.toBeInTheDocument();
    expect(screen.getByText(/Everything stays on this machine/)).toBeInTheDocument();
  });

  it("shows a quote and attribution on an empty day", async () => {
    vi.mocked(getSummary).mockResolvedValue({
      date: "2026-10-06",
      totalActiveSeconds: 0,
      activeSeconds: 0,
      distractionSeconds: 0,
      averageFocusScore: 0,
      topCategories: {},
      contextSwitches: 0,
      source: "sample",
    });
    render(<App />);
    expect(await screen.findByText(/Sheru starts logging as soon as/)).toBeInTheDocument();
    const quotes = screen.getAllByTestId("quote-block").map((e) => e.textContent ?? "");
    expect(quotes.some((t) => /treasure-house of knowledge|hands before our eyes/.test(t))).toBe(true);
    expect(quotes.some((t) => t.includes("— Swami Vivekananda, Complete Works, Vol. 2:"))).toBe(true);
  });

  it("shows Sheru's live panel with goals, status and today's focus", async () => {
    render(<App />);
    expect(await screen.findByText("Sheru is with you, Saksham")).toBeInTheDocument();
    expect(await screen.findByTestId("sheru-now")).toHaveTextContent("On track");
    expect(screen.getByTestId("sheru-now")).toHaveTextContent("LeetCode");
    expect(screen.getByTestId("today-focus")).toHaveTextContent("50m");
    expect(screen.getAllByText("Crack DSA for placements").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Edit goals" })).toBeInTheDocument();
  });

  it("opens onboarding on first run when there is no profile", async () => {
    vi.mocked(getProfile).mockResolvedValue({ exists: false, profile: null });
    render(<App />);
    expect(await screen.findByText("Namaste! I'm Sheru.")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
  });

  it("opens onboarding prefilled for editing with ?onboarding=1", async () => {
    window.history.replaceState(null, "", "/?onboarding=1");
    render(<App />);
    expect(await screen.findByText("Hello again!")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Your name")).toHaveValue("Saksham Verma");
  });

  it("shows backend error detail", async () => {
    vi.mocked(getSummary).mockRejectedValue(new Error("ActivityWatch unreachable at http://localhost:5600"));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("ActivityWatch unreachable at http://localhost:5600");
  });
});
