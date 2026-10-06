import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(__dirname).filter((f) => /\.(ts|tsx|css|html)$/.test(f) && !/\.test\.[tj]sx?$/.test(f));

// The old palette and any raw Tailwind palette scale class. `Planning: "purple"` in tabs.ts is a Chrome
// TabGroupColor (no -NNN suffix) and is intentionally not matched.
const BANNED_PALETTE =
  /(indigo|violet|purple|fuchsia|slate|zinc|rose|emerald|amber|sky|gray|neutral)-[0-9]{2,3}|#(4f46e5|6366f1|4338ca|e11d48|f43f5e|fde047)/i;

describe("theme guardrails", () => {
  it("scans a meaningful set of source files", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("uses no banned palette classes or old hex colours", () => {
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(BANNED_PALETTE);
  });

  it("never says AI to the user, uses sparkles, or loads web fonts", () => {
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/\bAI\b|✨|[Ss]parkle/);
      expect(text, f).not.toMatch(new RegExp(["fonts\\.googleapis", "@font" + "-face", "@prop" + "erty"].join("|")));
    }
  });

  it("has no devotional motifs or mission branding", () => {
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(new RegExp(["rama" + "krishna", "lo" + "tus", "\\bsw" + "an\\b", "emb" + "lem"].join("|"), "i"));
  });
});
