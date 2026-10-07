import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/api", async () => {
  const actual = await vi.importActual<typeof import("../lib/api")>("../lib/api");
  return { ...actual, getSettings: vi.fn(), saveSettings: vi.fn(), clearHistory: vi.fn(), resetProfile: vi.fn(), voicePreview: vi.fn() };
});

import { clearHistory, getSettings, resetProfile, saveSettings } from "../lib/api";
import type { Profile, SettingsPatch, SettingsView } from "../lib/types";
import { SettingsPage } from "./SettingsPage";

const PRESET = { headsup: 4, distraction: 45, repeat: 300, stall: 90, afk: 300, snooze: 180, breakLen: 300 };
const VIEW: SettingsView = {
  settings: {
    timings: {},
    detectors: { headsup: true, detour: true, stall: true, hopping: true, streak: true, welcomeBack: true },
    voice: { voice: "af_heart", speed: 1, pitch: 6, volume: 0.9, speak: "important" },
    personality: "playful",
    useAi: true,
    showStatusChip: true,
  },
  pace: "balanced",
  quotes: "sometimes",
  voice: false,
  sounds: true,
  overrides: { "web:youtube.com": "focus" },
  effective: PRESET,
  presets: { gentle: { ...PRESET, headsup: 12 }, balanced: PRESET, demo: { ...PRESET, headsup: 2 } },
  voiceEngine: {
    engine: "neural", neuralInstalled: true, loaded: true, error: null, defaultVoice: "af_heart",
    voices: [{ id: "af_heart", label: "Heart: warm and natural (recommended)" }, { id: "am_puck", label: "Puck: playful" }],
  },
};
const PROFILE = { name: "Saksham Verma", goals: ["Crack DSA for placements"] } as Profile;

/** saveSettings echoes the patch back like the backend does. */
function echoSaves() {
  vi.mocked(saveSettings).mockImplementation(async (patch: SettingsPatch) => ({
    ...VIEW, ...patch, settings: patch.settings ?? VIEW.settings, overrides: patch.overrides ?? VIEW.overrides,
  } as SettingsView));
}

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.mocked(getSettings).mockResolvedValue(VIEW);
    echoSaves();
  });

  it("renders every section with the current values", async () => {
    render(<SettingsPage profile={PROFILE} onEditGoals={vi.fn()} onStartOver={vi.fn()} />);
    expect(await screen.findByText("Leo's settings")).toBeInTheDocument();
    for (const t of ["Nudges", "What Leo watches for", "Voice & sounds", "Personality & wisdom", "Always treated as work", "You & your data"]) {
      expect(screen.getByRole("heading", { name: t })).toBeInTheDocument();
    }
    expect(screen.getByRole("radio", { name: "Balanced" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Speak out loud" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByLabelText("Voice")).toHaveValue("af_heart");
    expect(screen.getByText("youtube.com")).toBeInTheDocument();
    expect(screen.getByText(/Natural voice, generated on this Mac/)).toBeInTheDocument();
  });

  it("saves toggles, pace, personality and voice choices", async () => {
    const user = userEvent.setup();
    render(<SettingsPage profile={PROFILE} onEditGoals={vi.fn()} onStartOver={vi.fn()} />);
    await screen.findByText("Leo's settings");
    await user.click(screen.getByRole("switch", { name: "Speak out loud" }));
    expect(saveSettings).toHaveBeenLastCalledWith({ voice: true });
    await user.click(screen.getByRole("radio", { name: "Demo" }));
    expect(saveSettings).toHaveBeenLastCalledWith({ pace: "demo" });
    await user.click(screen.getByRole("switch", { name: "Tab hopping" }));
    await user.click(screen.getByRole("radio", { name: "Coach" }));
    // the second edit builds on the first (no lost update)
    const last = vi.mocked(saveSettings).mock.calls.at(-1)![0].settings!;
    expect(last.detectors.hopping).toBe(false);
    expect(last.personality).toBe("coach");
    await user.selectOptions(screen.getByLabelText("Voice"), "am_puck");
    expect(vi.mocked(saveSettings).mock.calls.at(-1)![0].settings!.voice.voice).toBe("am_puck");
    await user.click(screen.getByRole("radio", { name: "Off" }));
    expect(saveSettings).toHaveBeenLastCalledWith({ quotes: "off" });
    expect(await screen.findByText("Saved ✓")).toBeInTheDocument();
  });

  it("commits a timing slider once, as a custom override, and can reset it", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<SettingsPage profile={PROFILE} onEditGoals={vi.fn()} onStartOver={vi.fn()} />);
    await screen.findByText("Leo's settings");
    const slider = screen.getByRole("slider", { name: '"Wrong tab?" heads-up after' });
    fireEvent.change(slider, { target: { value: "8" } });
    fireEvent.change(slider, { target: { value: "9" } });
    await vi.advanceTimersByTimeAsync(400);
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveSettings).mock.calls[0]![0].settings!.timings).toEqual({ headsup: 9 });
    vi.useRealTimers();
    const reset = await screen.findByRole("button", { name: /Reset 1 custom timing/ });
    fireEvent.click(reset);
    await waitFor(() => expect(vi.mocked(saveSettings).mock.calls.at(-1)![0].settings!.timings).toEqual({}));
  });

  it("removes an always-allowed site and handles data actions with confirmation", async () => {
    const user = userEvent.setup();
    const onStartOver = vi.fn();
    vi.mocked(clearHistory).mockResolvedValue();
    vi.mocked(resetProfile).mockResolvedValue();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<SettingsPage profile={PROFILE} onEditGoals={vi.fn()} onStartOver={onStartOver} />);
    await screen.findByText("Leo's settings");
    await user.click(screen.getByRole("button", { name: "Remove youtube.com" }));
    expect(saveSettings).toHaveBeenLastCalledWith({ overrides: {} });
    await user.click(screen.getByRole("button", { name: "Clear history" }));
    expect(clearHistory).toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Start over" }));
    await waitFor(() => expect(onStartOver).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalledTimes(2);
  });

  it("explains the fallback when the natural voice is not installed", async () => {
    vi.mocked(getSettings).mockResolvedValue({
      ...VIEW, voiceEngine: { ...VIEW.voiceEngine, engine: "system", neuralInstalled: false, voices: [{ id: "system", label: "macOS system voice" }] },
    });
    render(<SettingsPage profile={PROFILE} onEditGoals={vi.fn()} onStartOver={vi.fn()} />);
    expect(await screen.findByText(/run \.\/setup\.sh/)).toBeInTheDocument();
    expect(within(screen.getByLabelText("Voice")).getAllByRole("option").map((o) => o.textContent)).toEqual(["macOS system voice"]);
  });
});
