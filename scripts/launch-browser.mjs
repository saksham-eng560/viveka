#!/usr/bin/env node
// Open a browser window with the Viveka extension already installed, then stay alive
// as long as that browser runs (start.sh tracks this process as the "browser" service).
//
// Why a launcher: Google Chrome 137+ ignores --load-extension, and installing into someone's
// everyday profile is (rightly) impossible without clicking through chrome://extensions.
// So we start the browser with its own Viveka profile and install the unpacked extension
// through the DevTools protocol (Extensions.loadUnpacked over --remote-debugging-pipe).
// Chrome closes the pipe-connected browser when this process exits, so we keep running.
//
// Usage: node scripts/launch-browser.mjs --ext extension/dist --profile .run/browser-profile --url http://localhost:3000
// Env:   VIVEKA_BROWSER=chrome|brave|edge|chromium|<path to binary>   (default: first one installed;
//        the older SHERU_BROWSER and LIGHTHOUSE_BROWSER names still work)
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const EXT = resolve(args.ext ?? "extension/dist");
const PROFILE = resolve(args.profile ?? ".run/browser-profile");
const URLS = (args.url ?? "http://localhost:3000").split(",");

const CANDIDATES = {
  chrome: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", `${homedir()}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"],
  brave: ["/Applications/Brave Browser.app/Contents/MacOS/Brave Browser", `${homedir()}/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`, "/usr/bin/brave-browser"],
  edge: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge", "/usr/bin/microsoft-edge"],
  chromium: ["/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
};

function pickBrowser() {
  const want = (process.env.VIVEKA_BROWSER ?? process.env.SHERU_BROWSER ?? process.env.LIGHTHOUSE_BROWSER ?? "").trim();
  if (want && !CANDIDATES[want.toLowerCase()]) {
    if (existsSync(want)) return { name: "custom", bin: want };
    throw new Error(`VIVEKA_BROWSER=${want} is not a known browser or an existing path`);
  }
  const order = want ? [want.toLowerCase()] : ["chrome", "brave", "edge", "chromium"];
  for (const name of order) {
    const bin = CANDIDATES[name].find((p) => existsSync(p));
    if (bin) return { name, bin };
  }
  throw new Error("No Chromium-based browser found (Chrome, Brave, Edge or Chromium).");
}

const log = (...m) => console.log(`[browser ${new Date().toLocaleTimeString()}]`, ...m);

if (!existsSync(resolve(EXT, "manifest.json"))) {
  console.error(`Extension build not found at ${EXT} (run ./setup.sh or: cd extension && npm run build)`);
  process.exit(2);
}
mkdirSync(PROFILE, { recursive: true });
const { name, bin } = pickBrowser();

const flags = [
  "--remote-debugging-pipe",
  "--enable-unsafe-extension-debugging",
  `--user-data-dir=${PROFILE}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-search-engine-choice-screen",
  "--window-size=1280,860",
];
if (process.env.VIVEKA_BROWSER_HEADLESS || process.env.SHERU_BROWSER_HEADLESS || process.env.LIGHTHOUSE_BROWSER_HEADLESS) flags.push("--headless=new"); // tests / CI
log(`starting ${name}: ${bin}`);
const child = spawn(bin, flags, { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] });
const toBrowser = child.stdio[3];
const fromBrowser = child.stdio[4];
child.stderr.on("data", () => {}); // keep the pipe drained; Chrome is chatty

let nextId = 0;
const pending = new Map();
let buf = "";
fromBrowser.on("data", (chunk) => {
  buf += chunk.toString("utf8");
  let i;
  while ((i = buf.indexOf("\0")) >= 0) {
    const raw = buf.slice(0, i);
    buf = buf.slice(i + 1);
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      continue;
    }
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});
fromBrowser.on("error", () => {});
toBrowser.on("error", () => {});

function cdp(method, params = {}, sessionId) {
  return new Promise((res, rej) => {
    const id = ++nextId;
    const timer = setTimeout(() => {
      pending.delete(id);
      rej(new Error(`${method} timed out`));
    }, 15000);
    pending.set(id, (m) => {
      clearTimeout(timer);
      m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result);
    });
    toBrowser.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + "\0");
  });
}

let closing = false;
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  try {
    await Promise.race([cdp("Browser.close"), new Promise((r) => setTimeout(r, 3000))]);
  } catch {
    /* already gone */
  }
  setTimeout(() => {
    try {
      child.kill("SIGTERM");
    } catch {
      /* gone */
    }
    process.exit(code);
  }, 800);
}
process.on("SIGTERM", () => void shutdown(0));
process.on("SIGINT", () => void shutdown(0));
process.on("SIGHUP", () => void shutdown(0));
child.on("exit", (code) => {
  log(`browser exited (${code ?? "signal"})`);
  process.exit(0);
});

try {
  const { id } = await cdp("Extensions.loadUnpacked", { path: EXT });
  log(`Viveka extension installed (${id}) from ${EXT}`);
} catch (e) {
  log(`could not install the extension automatically: ${e.message}`);
  log(`load it by hand: chrome://extensions -> Developer mode -> Load unpacked -> ${EXT}`);
  URLS.push("chrome://extensions");
}

try {
  const { targetInfos } = await cdp("Target.getTargets");
  const pages = targetInfos.filter((t) => t.type === "page");
  for (const [i, url] of URLS.entries()) {
    if (i === 0 && pages[0]) {
      const { sessionId } = await cdp("Target.attachToTarget", { targetId: pages[0].targetId, flatten: true });
      await cdp("Page.navigate", { url }, sessionId);
      await cdp("Target.detachFromTarget", { sessionId }).catch(() => {});
    } else {
      await cdp("Target.createTarget", { url });
    }
  }
  log(`opened ${URLS.join(", ")}`);
} catch (e) {
  log(`could not open the dashboard tab: ${e.message}`);
}
log("ready; keep this process running while you use the browser (./stop.sh closes it)");
