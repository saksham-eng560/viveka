import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import manifest from "./manifest.json";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe("manifest", () => {
  it("is called Viveka", () => {
    expect(manifest.name).toBe("Viveka");
    expect(manifest.action.default_title).toBe("Viveka");
    expect(manifest.description).toMatch(/Viveka/);
  });

  it("declares MV3 with the required permissions", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual(
      expect.arrayContaining(["tabs", "storage", "sidePanel", "offscreen", "scripting", "activeTab", "alarms", "tts", "tabGroups", "idle"]),
    );
  });

  it("requests management only as an optional permission", () => {
    expect(manifest.optional_permissions).toEqual(["management"]);
    expect(manifest.permissions).not.toContain("management");
    expect(manifest.permissions).toHaveLength(10);
    expect(manifest.description).not.toMatch(/\bAI\b/);
  });

  it("limits host permissions to local Ollama, ActivityWatch and Leo's brain", () => {
    expect([...manifest.host_permissions].sort()).toEqual(
      [
        "http://127.0.0.1:11434/*",
        "http://127.0.0.1:5600/*",
        "http://127.0.0.1:8000/*",
        "http://localhost:11434/*",
        "http://localhost:5600/*",
        "http://localhost:8000/*",
      ].sort(),
    );
  });

  it("exposes only Leo's picture to web pages", () => {
    expect(manifest.web_accessible_resources).toEqual([{ resources: ["leo.svg"], matches: ["<all_urls>"] }]);
  });

  it("wires popup, side panel, content script and a stable public key", () => {
    expect(manifest.action.default_popup).toContain("popup");
    expect(manifest.side_panel.default_path).toContain("sidepanel");
    expect(manifest.content_scripts[0]?.matches).toEqual(["<all_urls>"]);
    expect(manifest.key).toMatch(/^[A-Za-z0-9+/=]{300,}$/);
  });

  it("never calls sidePanel.setPanelBehavior and has no private key material", () => {
    const root = join(__dirname);
    const src = walk(root).filter((f) => /\.(ts|tsx|js)$/.test(f) && !f.endsWith("manifest.test.ts"));
    for (const f of src) expect(readFileSync(f, "utf8"), f).not.toContain("setPanelBehavior");
    expect(JSON.stringify(manifest)).not.toContain("PRIVATE KEY");
  });
});
