// Render the extension icons (16/48/128 px) from Sheru's figure: buddy/web/sheru.svg, cropped to his face.
// Uses an installed Chrome/Brave/Edge in headless mode (no npm dependencies): `npm run icons`.
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(here, "../../buddy/web/sheru.svg");
const outDir = resolve(here, "../src/assets");
const browsers = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
];
const browser = browsers.find((b) => existsSync(b));
if (!browser) throw new Error("No Chromium-based browser found to render icons");

// face only (ears, turban and mane), no animation, transparent background
const face = readFileSync(svgPath, "utf8")
  .replace('viewBox="0 0 200 230" width="200" height="230"', 'viewBox="30 14 140 140" width="100%" height="100%"')
  .replace("<style>", "<style>*{animation:none!important} #sh-tail,#sh-shadow{display:none!important}");
const work = mkdtempSync(join(tmpdir(), "sheru-icons-"));
for (const size of [16, 48, 128]) {
  const html = join(work, `icon-${size}.html`);
  writeFileSync(html, `<!doctype html><html><body style="margin:0;background:transparent;width:${size}px;height:${size}px">${face}</body></html>`);
  const png = join(outDir, `icon-${size}.png`);
  execFileSync(browser, [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000",
    `--window-size=${size},${size}`, `--screenshot=${png}`, `file://${html}`,
  ], { stdio: "ignore" });
  console.log("wrote", png);
}
