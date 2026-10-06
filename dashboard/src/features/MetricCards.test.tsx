import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { formatDuration } from "../lib/format";
import { MetricCards } from "./MetricCards";
import type { DailySummaryResponse } from "../lib/types";

const summary: DailySummaryResponse = {
  date: "2026-10-06",
  totalActiveSeconds: 9000,
  activeSeconds: 7500,
  distractionSeconds: 1500,
  averageFocusScore: 71.4,
  topCategories: { Coding: 7000 },
  contextSwitches: 23,
  source: "sample",
};

describe("formatDuration", () => {
  it("formats", () => {
    expect(formatDuration(0)).toBe("0m");
    expect(formatDuration(45)).toBe("45s");
    expect(formatDuration(840)).toBe("14m");
    expect(formatDuration(7500)).toBe("2h 5m");
    expect(formatDuration(7200)).toBe("2h");
  });
});

describe("MetricCards", () => {
  it("renders formatted values with rose for distraction and indigo for active", () => {
    render(<MetricCards summary={summary} loading={false} />);
    expect(screen.getByTestId("metric-Active time")).toHaveAttribute("data-tone", "indigo");
    expect(screen.getByTestId("metric-Active time")).toHaveTextContent("2h 5m");
    const d = screen.getByTestId("metric-Distraction time");
    expect(d).toHaveAttribute("data-tone", "rose");
    expect(d).toHaveTextContent("25m");
    expect(screen.getByTestId("metric-Avg focus score")).toHaveTextContent("71.4");
    expect(screen.getByTestId("metric-Context switches")).toHaveTextContent("23");
  });

  it("renders skeletons while loading", () => {
    render(<MetricCards summary={null} loading />);
    expect(screen.getByLabelText("Loading metrics")).toBeInTheDocument();
  });
});
