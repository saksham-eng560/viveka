import { describe, expect, it } from "vitest";

const raw = import.meta.glob(["./**/*.{ts,tsx,css}", "!./**/*.test.*"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;
const files = Object.entries(raw);
const BANNED_PALETTE =
  /(indigo|violet|purple|fuchsia|slate|zinc|rose|emerald|amber|sky|gray|neutral)-[0-9]{2,3}|#(4f46e5|6366f1|4338ca|e11d48|f43f5e|fde047)/i;

describe("theme", () => {
  it("scans some source files", () => {
    expect(files.length).toBeGreaterThan(10);
  });
  it("uses no raw palette classes or old hexes", () => {
    for (const [p, s] of files) expect(s, p).not.toMatch(BANNED_PALETTE);
  });
  it("has no dark: variants (tokens flip automatically)", () => {
    for (const [p, s] of files) expect(s, p).not.toMatch(/\bdark:/);
  });
  it('has no "AI" word or sparkle in user-visible source', () => {
    for (const [p, s] of files) {
      expect(s, p).not.toMatch(/\bAI\b/);
      expect(s, p).not.toMatch(/✨|[Ss]parkle/);
    }
  });
});
