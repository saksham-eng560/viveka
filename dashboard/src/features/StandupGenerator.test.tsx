import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AxiosError } from "axios";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, generateStandup: vi.fn() };
});

import { generateStandup } from "../lib/api";
import { StandupGenerator } from "./StandupGenerator";

const mocked = vi.mocked(generateStandup);

beforeEach(() => {
  mocked.mockReset();
  // reduced motion => instant text so assertions are simple
  window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} })) as never;
});

describe("StandupGenerator", () => {
  it("shows loading then markdown with AI badge", async () => {
    let resolve!: (v: never) => void;
    mocked.mockReturnValue(new Promise((r) => (resolve = r as never)));
    const user = userEvent.setup();
    render(<StandupGenerator date="2026-10-06" />);
    await user.click(screen.getByRole("button", { name: "Generate Standup" }));
    expect(screen.getByRole("button", { name: /Generating/ })).toBeDisabled();
    resolve({ markdown: "## Done\n- Shipped dashboard", generatedBy: "llm", model: "qwen", source: "aw" } as never);
    expect(await screen.findByRole("heading", { name: "Done" })).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText(/No data left the machine/)).toBeInTheDocument();
    expect(mocked).toHaveBeenCalledWith("2026-10-06");
  });

  it("shows template badge", async () => {
    mocked.mockResolvedValue({ markdown: "Hello", generatedBy: "template", model: null, source: "sample" });
    const user = userEvent.setup();
    render(<StandupGenerator date="2026-10-06" />);
    await user.click(screen.getByRole("button", { name: "Generate Standup" }));
    expect(await screen.findByText("template")).toBeInTheDocument();
  });

  it("shows backend detail on 503", async () => {
    mocked.mockRejectedValue(
      new AxiosError("x", "ERR_BAD_RESPONSE", undefined, undefined, {
        status: 503,
        data: { detail: "Ollama unreachable at http://localhost:11434" },
      } as never),
    );
    // use the real message mapper
    const user = userEvent.setup();
    render(<StandupGenerator date="2026-10-06" />);
    await user.click(screen.getByRole("button", { name: "Generate Standup" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Ollama unreachable at http://localhost:11434"));
  });

  it("copies markdown to clipboard", async () => {
    mocked.mockResolvedValue({ markdown: "Copy me", generatedBy: "llm", model: "m", source: "aw" });
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<StandupGenerator date="2026-10-06" />);
    await user.click(screen.getByRole("button", { name: "Generate Standup" }));
    await user.click(await screen.findByRole("button", { name: "Copy" }));
    expect(writeText).toHaveBeenCalledWith("Copy me");
  });

  it("clears the Copied reset timer on unmount", async () => {
    mocked.mockResolvedValue({ markdown: "Copy me", generatedBy: "llm", model: "m", source: "aw" });
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    const clearSpy = vi.spyOn(globalThis, "clearTimeout");
    const { unmount } = render(<StandupGenerator date="2026-10-06" />);
    await user.click(screen.getByRole("button", { name: "Generate Standup" }));
    await user.click(await screen.findByRole("button", { name: "Copy" }));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeInTheDocument();
    clearSpy.mockClear();
    unmount();
    expect(clearSpy).toHaveBeenCalled();
    expect(clearSpy.mock.calls.some(([id]) => id !== undefined)).toBe(true);
    clearSpy.mockRestore();
  });
});
