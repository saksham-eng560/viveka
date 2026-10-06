import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, getCatalog: vi.fn(), saveProfile: vi.fn() };
});

import { getCatalog, saveProfile } from "../lib/api";
import { Onboarding } from "./Onboarding";

describe("Onboarding", () => {
  beforeEach(() => {
    vi.mocked(getCatalog).mockResolvedValue({
      workTools: [{ id: "vscode", label: "VS Code / Cursor" }, { id: "dsa", label: "LeetCode / DSA sites" }],
      distractions: [{ id: "youtube", label: "YouTube" }, { id: "instagram", label: "Instagram" }, { id: "reddit", label: "Reddit" }],
      goalIdeas: ["Crack DSA for placements", "Learn React properly"],
    });
  });

  it("collects name, age, goals, tools, distractions and pace in three short steps", async () => {
    const user = userEvent.setup();
    vi.mocked(saveProfile).mockImplementation(async (p) => ({
      exists: true, profile: { ...p, overrides: {}, createdAt: "x", updatedAt: "x" },
    }));
    const onDone = vi.fn();
    render(<Onboarding initial={null} onDone={onDone} />);

    const next = screen.getByRole("button", { name: "Next" });
    expect(next).toBeDisabled();
    await user.type(screen.getByPlaceholderText("Your name"), "Saksham");
    await user.type(screen.getByPlaceholderText("21"), "21");
    await user.click(next);

    expect(await screen.findByText("What are you working toward, Saksham?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await user.type(screen.getByLabelText("Add a goal"), "Finish my thesis{Enter}");
    await user.click(await screen.findByRole("button", { name: "+ Crack DSA for placements" }));
    await user.click(screen.getByRole("button", { name: "VS Code / Cursor" }));
    await user.type(screen.getByLabelText("Add a work app or site"), "overleaf.com{Enter}");
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("What usually pulls you away?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "✓ YouTube" })); // preselected; untick
    await user.click(screen.getByRole("button", { name: "Reddit" }));
    await user.click(screen.getByRole("radio", { name: /Demo/ }));
    await user.click(screen.getByRole("button", { name: "Meet Sheru" }));

    await waitFor(() => expect(saveProfile).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveProfile).mock.calls[0]![0]).toEqual({
      name: "Saksham", age: 21, goals: ["Finish my thesis", "Crack DSA for placements"], workTools: ["vscode", "overleaf.com"],
      distractions: ["instagram", "reddit"], pace: "demo", quotes: "sometimes", voice: false, sounds: true,
    });
    expect(await screen.findByText("All set, Saksham!")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open my dashboard" }));
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ name: "Saksham", pace: "demo" }));
  });

  it("shows the backend's validation message", async () => {
    const user = userEvent.setup();
    vi.mocked(saveProfile).mockRejectedValue(new Error("Add at least one goal"));
    render(<Onboarding initial={null} onDone={vi.fn()} />);
    await user.type(screen.getByPlaceholderText("Your name"), "A{Enter}");
    await user.type(await screen.findByLabelText("Add a goal"), "Ship it{Enter}");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(await screen.findByRole("button", { name: "Meet Sheru" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Add at least one goal");
  });
});
