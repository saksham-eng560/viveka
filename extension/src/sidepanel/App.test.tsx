import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    expect(screen.getByTestId("model-badge").textContent).toContain("Offline rules in use");
    expect(screen.queryByTestId("ai-badge")).toBeNull();
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

  it("has a calm subtitle without the word AI and shows the session-start quote", async () => {
    mockBackground(defaultSnapshot());
    render(<App />);
    await screen.findByText("Start Session");
    expect(screen.getByText("A quiet companion for focused work")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bAI\b/);
    expect(screen.getByText("Arise, awake, and stop not till the goal is reached.")).toBeTruthy();
    expect(screen.getByText("Everything stays on this device.")).toBeTruthy();
  });

  it("switches between the Focus and Extensions views with an accessible tablist", async () => {
    mockBackground(defaultSnapshot());
    render(<App />);
    await screen.findByText("Start Session");
    const focusTab = screen.getByRole("tab", { name: "Focus" });
    const extTab = screen.getByRole("tab", { name: "Extensions" });
    expect(screen.getByRole("tablist")).toBeTruthy();
    expect(focusTab.getAttribute("aria-selected")).toBe("true");
    expect(extTab.getAttribute("aria-selected")).toBe("false");

    fireEvent.click(extTab);
    expect(extTab.getAttribute("aria-selected")).toBe("true");
    await screen.findByText("Quick add");
    expect(screen.queryByText("Start Session")).toBeNull();

    fireEvent.keyDown(extTab, { key: "ArrowLeft" });
    expect(focusTab.getAttribute("aria-selected")).toBe("true");
    await screen.findByText("Start Session");
  });
});
