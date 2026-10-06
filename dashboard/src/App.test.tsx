import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/api", async () => {
  const actual = await vi.importActual<typeof import("./lib/api")>("./lib/api");
  return { ...actual, getSummary: vi.fn(), getTimeline: vi.fn(), getHealth: vi.fn(), generateStandup: vi.fn() };
});

import { getHealth, getSummary, getTimeline } from "./lib/api";
import App from "./App";

const health = {
  status: "ok" as const,
  dataSource: "auto" as const,
  aw: { reachable: false, url: "http://localhost:5600" },
  ollama: { reachable: false, url: "http://localhost:11434", model: "qwen3.5:4b", modelAvailable: false },
};

describe("App", () => {
  beforeEach(() => {
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
    expect(await screen.findByText(/Begin a focus session with the Lighthouse extension/)).toBeInTheDocument();
    const quotes = screen.getAllByTestId("quote-block").map((e) => e.textContent ?? "");
    expect(quotes.some((t) => /treasure-house of knowledge|hands before our eyes/.test(t))).toBe(true);
    expect(quotes.some((t) => t.includes("— Swami Vivekananda, Complete Works, Vol. 2:"))).toBe(true);
  });

  it("shows backend error detail", async () => {
    vi.mocked(getSummary).mockRejectedValue(new Error("ActivityWatch unreachable at http://localhost:5600"));
    render(<App />);
    expect(await screen.findByRole("alert")).toHaveTextContent("ActivityWatch unreachable at http://localhost:5600");
  });
});
