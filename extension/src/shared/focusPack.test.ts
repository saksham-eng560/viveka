import { describe, expect, it } from "vitest";
import { FOCUS_PACK, storeUrl } from "./focusPack";

describe("focus pack", () => {
  it("lists six extensions with well-formed ids and store urls", () => {
    expect(FOCUS_PACK).toHaveLength(6);
    for (const item of FOCUS_PACK) {
      expect(item.id).toMatch(/^[a-p]{32}$/);
      expect(item.url.startsWith("https://chromewebstore.google.com/detail/")).toBe(true);
      expect(item.url.endsWith(`/${item.id}`)).toBe(true);
    }
  });

  it("builds urls with storeUrl and has no duplicates", () => {
    expect(storeUrl("dark-reader", "eimadpbcbfnmbkopoojfekhnkhdbieeh")).toBe(
      "https://chromewebstore.google.com/detail/dark-reader/eimadpbcbfnmbkopoojfekhnkhdbieeh",
    );
    expect(FOCUS_PACK.find((i) => i.name === "Unhook")?.url).toBe(
      storeUrl("unhook-remove-youtube-rec", "khncfooichmfjbepaaaebmommgaepoid"),
    );
    expect(new Set(FOCUS_PACK.map((i) => i.id)).size).toBe(6);
    expect(new Set(FOCUS_PACK.map((i) => i.name)).size).toBe(6);
  });

  it("excludes the MV2 uBlock Origin and marks only Dark Reader optional", () => {
    expect(FOCUS_PACK.map((i) => i.id)).not.toContain("cjpalhdlnbpafiamejdnhcphjbkeiagm");
    expect(FOCUS_PACK.filter((i) => i.optional).map((i) => i.name)).toEqual(["Dark Reader"]);
  });
});
