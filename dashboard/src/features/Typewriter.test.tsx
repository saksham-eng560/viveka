import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Typewriter } from "./Typewriter";

const show = (t: string) => <span data-testid="out">{t}</span>;

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = ((q: string) => ({ matches: reduce, media: q, addEventListener() {}, removeEventListener() {} })) as never;
}

describe("Typewriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockReducedMotion(false);
  });
  afterEach(() => vi.useRealTimers());

  it("reveals progressively", () => {
    render(<Typewriter text="hello" speedMs={10} render={show} />);
    expect(screen.getByTestId("out")).toHaveTextContent("");
    act(() => void vi.advanceTimersByTime(30));
    expect(screen.getByTestId("out")).toHaveTextContent("hel");
    act(() => void vi.advanceTimersByTime(100));
    expect(screen.getByTestId("out")).toHaveTextContent("hello");
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  });

  it("Skip reveals everything and calls onDone", () => {
    const onDone = vi.fn();
    render(<Typewriter text="hello world" speedMs={10} render={show} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getByTestId("out")).toHaveTextContent("hello world");
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("is instant with prefers-reduced-motion", () => {
    mockReducedMotion(true);
    render(<Typewriter text="instant" render={show} />);
    expect(screen.getByTestId("out")).toHaveTextContent("instant");
    expect(screen.queryByRole("button", { name: "Skip" })).toBeNull();
  });
});
