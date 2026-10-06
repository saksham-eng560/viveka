import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MSG } from "../shared/messages";
import { defaultSnapshot } from "../background/state";
import type { AppStateSnapshot } from "../shared/types";
import { App } from "./App";

function mockBackground(state: AppStateSnapshot) {
  const sendMessage = vi.fn(async (m: { type: string }) => {
    if (m.type === MSG.GET_STATE) return { ok: true, data: state };
    return { ok: true, data: state };
  });
  (chrome.runtime as unknown as { sendMessage: unknown }).sendMessage = sendMessage;
  return sendMessage;
}

describe("Side panel", () => {
  it("shows the goal form and heuristic/offline badges", async () => {
    mockBackground({ ...defaultSnapshot(), aiStatus: "heuristic", awStatus: "offline", bufferedEvents: 3 });
    render(<App />);
    await screen.findByText("Start Session");
    expect(screen.getByTestId("ai-badge").textContent).toContain("AI offline");
    expect(screen.getByTestId("aw-badge").textContent).toContain("ActivityWatch offline");
    expect(screen.getByTestId("aw-badge").textContent).toContain("3 buffered");
  });

  it("shows goal, gauge score, category and reasoning for an active session", async () => {
    const base = defaultSnapshot();
    mockBackground({
      ...base,
      currentGoal: "Building a React dashboard",
      sessionStartTime: Date.now() - 65_000,
      sessionDurationMinutes: 25,
      currentTab: { tabId: 1, url: "https://github.com/a", title: "GH", score: 95, category: "Coding", reasoning: "Relevant to React dashboard.", source: "llm" },
      currentFocusScore: 95,
    });
    render(<App />);
    await waitFor(() => expect(screen.getByTestId("goal").textContent).toBe("Building a React dashboard"));
    expect(screen.getByTestId("gauge-score").textContent).toBe("95");
    expect(screen.getByTestId("category").textContent).toBe("Coding");
    expect(screen.getByTestId("reasoning").textContent).toContain("Relevant to React dashboard.");
    expect(screen.getByText("End Session")).toBeTruthy();
  });
});
