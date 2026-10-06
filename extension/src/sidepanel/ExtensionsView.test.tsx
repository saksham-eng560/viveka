import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FOCUS_PACK, storeUrl } from "../shared/focusPack";
import { QUOTES } from "../shared/quotes";
import { installManagement, type MockEvent } from "../test/chrome-mock";
import { ExtensionsView } from "./ExtensionsView";

const perms = () => chrome.permissions as unknown as {
  contains: ReturnType<typeof vi.fn>;
  request: ReturnType<typeof vi.fn>;
  onRemoved: MockEvent<(p: { permissions?: string[] }) => void>;
};

const UNHOOK = FOCUS_PACK.find((i) => i.name === "Unhook")!;
const UBLOCK = FOCUS_PACK.find((i) => i.name === "uBlock Origin Lite")!;

function grant() {
  perms().contains.mockResolvedValue(true);
}

describe("ExtensionsView", () => {
  it("denied: shows Allow access, the hint and no ticks", async () => {
    render(<ExtensionsView />);
    await screen.findByText("Allow access");
    expect(screen.getByText("Allow access below to see which of these you already have.")).toBeTruthy();
    expect(screen.queryByText(/✓/)).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Add .* from the Chrome Web Store$/ })).toHaveLength(6);
  });

  it("calls permissions.request synchronously from the click, before any await", async () => {
    installManagement([]);
    let resolve!: (v: boolean) => void;
    perms().request.mockImplementation(() => new Promise<boolean>((r) => (resolve = r)));
    render(<ExtensionsView />);
    const btn = await screen.findByText("Allow access");
    fireEvent.click(btn); // fireEvent is synchronous: the call must already have happened
    expect(perms().request).toHaveBeenCalledTimes(1);
    expect(perms().request).toHaveBeenCalledWith({ permissions: ["management"] });
    await act(async () => resolve(false));
  });

  it("shows a notice when access is declined and allows retry", async () => {
    render(<ExtensionsView />);
    fireEvent.click(await screen.findByText("Allow access"));
    await screen.findByText("Access was not granted. Quick add still works.");
    expect(screen.getByText("Allow access")).toBeTruthy();
  });

  it("granting access loads the list", async () => {
    const { management } = installManagement([{ id: "a", name: "Alpha" }]);
    perms().request.mockResolvedValue(true);
    render(<ExtensionsView />);
    fireEvent.click(await screen.findByText("Allow access"));
    await screen.findByText("Alpha");
    expect(management.getAll).toHaveBeenCalled();
  });

  it("granted: lists filtered and sorted extensions, enabled first", async () => {
    grant();
    installManagement([
      { id: "test-extension-id", name: "Lighthouse itself" },
      { id: "t", name: "A Theme", type: "theme" },
      { id: "ap", name: "An App", type: "hosted_app" },
      { id: "z", name: "Zeta" },
      { id: "b", name: "Beta", enabled: false },
      { id: "a", name: "Alpha" },
    ]);
    render(<ExtensionsView />);
    await screen.findByText("Alpha");
    const names = screen.getAllByTestId("ext-row").map((r) => r.querySelector("span.truncate")?.textContent);
    expect(names).toEqual(["Alpha", "Zeta", "Beta"]);
    expect(screen.getByText("Your extensions · 2 on")).toBeTruthy();
    expect(screen.queryByText("Lighthouse itself")).toBeNull();
    expect(screen.queryByText("A Theme")).toBeNull();
    expect(screen.queryByText("An App")).toBeNull();
  });

  it("toggle calls setEnabled then re-fetches", async () => {
    grant();
    const { management } = installManagement([{ id: "a", name: "Alpha" }]);
    render(<ExtensionsView />);
    const sw = await screen.findByRole("switch", { name: "Turn Alpha off" });
    expect(sw.getAttribute("aria-checked")).toBe("true");
    const before = management.getAll.mock.calls.length;
    await act(async () => fireEvent.click(sw));
    expect(management.setEnabled).toHaveBeenCalledWith("a", false);
    await waitFor(() => expect(management.getAll.mock.calls.length).toBeGreaterThan(before));
    const after = await screen.findByRole("switch", { name: "Turn Alpha on" });
    expect(after.getAttribute("aria-checked")).toBe("false");
  });

  it("disables switches that cannot be changed", async () => {
    grant();
    installManagement([
      { id: "a", name: "Locked", mayDisable: false, installType: "admin" },
      { id: "b", name: "Off and locked", enabled: false, mayEnable: false },
      { id: "c", name: "Free" },
    ]);
    render(<ExtensionsView />);
    const locked = (await screen.findByRole("switch", { name: "Turn Locked off" })) as HTMLButtonElement;
    expect(locked.disabled).toBe(true);
    expect(locked.title).toBe("Managed by your administrator");
    expect(screen.getByText("Managed")).toBeTruthy();
    expect((screen.getByRole("switch", { name: "Turn Off and locked on" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("switch", { name: "Turn Free off" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("setEnabled rejection shows a notice and resyncs", async () => {
    grant();
    const { management } = installManagement([{ id: "a", name: "Alpha" }]);
    management.setEnabled.mockRejectedValueOnce(new Error("User declined"));
    render(<ExtensionsView />);
    const sw = await screen.findByRole("switch", { name: "Turn Alpha off" });
    const before = management.getAll.mock.calls.length;
    await act(async () => fireEvent.click(sw));
    await screen.findByText("Could not change Alpha: User declined");
    expect(management.getAll.mock.calls.length).toBeGreaterThan(before);
    expect(screen.getByRole("switch", { name: "Turn Alpha off" }).getAttribute("aria-checked")).toBe("true");
  });

  it("getAll failure shows an error with Try again", async () => {
    grant();
    const { management } = installManagement([{ id: "a", name: "Alpha" }]);
    management.getAll.mockRejectedValueOnce(new Error("boom"));
    render(<ExtensionsView />);
    await screen.findByText("Could not read your extensions: boom");
    fireEvent.click(screen.getByText("Try again"));
    await screen.findByText("Alpha");
    expect(screen.queryByText(/Could not read/)).toBeNull();
  });

  it("empty list shows the q3 quote and the quiet message", async () => {
    grant();
    installManagement([{ id: "test-extension-id", name: "Me" }]);
    render(<ExtensionsView />);
    await screen.findByText("No other extensions are installed. Your browser is already quiet.");
    const q3 = QUOTES.find((q) => q.id === "q3")!;
    expect(screen.getByText(q3.text)).toBeTruthy();
    expect(screen.getByText(`— Swami Vivekananda, ${q3.source}`)).toBeTruthy();
  });

  it("falls back to a letter avatar when the icon fails to load or is missing", async () => {
    grant();
    installManagement([
      { id: "a", name: "alpha", icons: [{ size: 16, url: "chrome://x/16" }, { size: 128, url: "chrome://x/128" }] },
      { id: "b", name: "Beta" },
    ]);
    const { container } = render(<ExtensionsView />);
    await screen.findByText("alpha");
    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("chrome://x/128");
    expect(img.getAttribute("alt")).toBe("");
    expect(screen.getAllByTestId("ext-avatar")).toHaveLength(1); // Beta has no icon
    fireEvent.error(img);
    await waitFor(() => expect(screen.getAllByTestId("ext-avatar")).toHaveLength(2));
    expect(screen.getAllByTestId("ext-avatar")[0]!.textContent).toBe("A");
  });

  it("shows a filter only when there are more than 8 extensions", async () => {
    grant();
    installManagement(Array.from({ length: 9 }, (_, i) => ({ id: `e${i}`, name: i === 4 ? "Needle" : `Ext ${i}` })));
    render(<ExtensionsView />);
    const input = await screen.findByLabelText("Filter extensions");
    fireEvent.change(input, { target: { value: "needle" } });
    expect(screen.getAllByTestId("ext-row")).toHaveLength(1);
  });

  it("Add opens the exact store url in a new tab", async () => {
    render(<ExtensionsView />);
    await screen.findByText("Allow access");
    fireEvent.click(screen.getByRole("button", { name: "Add Unhook from the Chrome Web Store" }));
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: storeUrl("unhook-remove-youtube-rec", "khncfooichmfjbepaaaebmommgaepoid"),
    });
  });

  it("reports a failed store open", async () => {
    (chrome.tabs.create as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("no"));
    render(<ExtensionsView />);
    fireEvent.click(await screen.findByRole("button", { name: "Add Unhook from the Chrome Web Store" }));
    await screen.findByText("Could not open the store page.");
  });

  it("marks installed and installed-but-off items once access is granted", async () => {
    grant();
    installManagement([
      { id: UBLOCK.id, name: "uBlock Origin Lite" },
      { id: UNHOOK.id, name: "Unhook", enabled: false },
    ]);
    render(<ExtensionsView />);
    await waitFor(() => expect(screen.getByTestId(`pack-${UBLOCK.id}`).textContent).toContain("✓ Installed"));
    const ub = screen.getByTestId(`pack-${UBLOCK.id}`);
    expect(ub.textContent).toContain("✓ Installed");
    expect(ub.textContent).not.toContain("· off");
    expect(screen.getByTestId(`pack-${UNHOOK.id}`).textContent).toContain("✓ Installed · off");
    expect(within(ub).queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("button", { name: /Add .* from the Chrome Web Store/ })).toHaveLength(4);
    expect(screen.queryByTestId("pack-hint")).toBeNull();
  });

  it("updates ticks live on management events", async () => {
    grant();
    const { list, events } = installManagement([]);
    render(<ExtensionsView />);
    await screen.findByText("No other extensions are installed. Your browser is already quiet.");
    list.push({ id: UBLOCK.id, name: "uBlock Origin Lite", version: "1", type: "extension", enabled: true, mayDisable: true, mayEnable: true, installType: "normal" });
    await act(async () => events.onInstalled.fire());
    await waitFor(() => expect(screen.getByTestId(`pack-${UBLOCK.id}`).textContent).toContain("✓ Installed"));
  });

  it("permissions.onRemoved returns to denied and detaches listeners", async () => {
    grant();
    const { events } = installManagement([{ id: "a", name: "Alpha" }]);
    render(<ExtensionsView />);
    await screen.findByText("Alpha");
    expect(events.onInstalled.listeners.size).toBe(1);
    await act(async () => perms().onRemoved.fire({ permissions: ["management"] }));
    await screen.findByText("Allow access");
    expect(screen.queryByText("Alpha")).toBeNull();
    expect(screen.queryByText(/✓/)).toBeNull();
    expect(events.onInstalled.listeners.size).toBe(0);
    expect(perms().onRemoved.listeners.size).toBe(0);
  });

  it("removes every listener on unmount", async () => {
    grant();
    const { events } = installManagement([{ id: "a", name: "Alpha" }]);
    const { unmount } = render(<ExtensionsView />);
    await screen.findByText("Alpha");
    unmount();
    for (const ev of Object.values(events)) expect(ev.listeners.size).toBe(0);
    expect(perms().onRemoved.listeners.size).toBe(0);
  });

  it("does not throw when chrome.management is undefined", async () => {
    grant(); // permission reports granted but the API is missing
    expect((chrome as unknown as { management?: unknown }).management).toBeUndefined();
    render(<ExtensionsView />);
    await screen.findByText("Your extensions · 0 on");
  });
});
