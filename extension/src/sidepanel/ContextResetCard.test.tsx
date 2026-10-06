import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ContextResetSummary } from "../shared/types";
import { ContextResetCard } from "./ContextResetCard";

const summary: ContextResetSummary = {
  goal: "g",
  tabs: [],
  summary: "s",
  suggestedCloseTabIds: [3, 4],
  generatedBy: "heuristic",
};

describe("ContextResetCard close confirmation (R-3)", () => {
  it("requires a second click before closing tabs", () => {
    const onClose = vi.fn();
    render(<ContextResetCard summary={summary} onCloseSuggested={onClose} onDismiss={() => undefined} />);
    fireEvent.click(screen.getByText("Close 2 unrelated tabs"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Click again to close 2 tabs"));
    expect(onClose).toHaveBeenCalledWith([3, 4]);
  });
});
