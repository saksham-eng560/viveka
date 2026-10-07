import { ensureOffscreen } from "./offscreen";
import { injectContentScripts } from "./nudge";
import { handleMessage } from "./router";
import { loadState } from "./state";
import { HEARTBEAT_INTERVAL_MS, refreshActiveTab, restoreTrackerFlags, setPaused, setUnfocused, tick } from "./tracker";

const ALARM_NAME = "lighthouse-tick";
let booting: Promise<void> | null = null;
let tickInterval: ReturnType<typeof setInterval> | null = null;

async function doBoot(): Promise<void> {
  await loadState();
  await restoreTrackerFlags();
  await ensureOffscreen();
  // Only create the alarm once: re-creating it on every event would keep pushing it back.
  if (!(await chrome.alarms.get(ALARM_NAME))) await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 0.5 });
  // Module-level guard: a retried boot must not stack a second interval.
  tickInterval ??= setInterval(() => void tick(), HEARTBEAT_INTERVAL_MS);
  await refreshActiveTab();
}

/** Idempotent boot per service-worker lifetime: state restore, offscreen keep-alive, alarm backup, interval. */
function boot(): Promise<void> {
  booting ??= doBoot().catch((e: unknown) => {
    booting = null; // allow a retry on the next event
    console.warn("Viveka boot failed", e);
  });
  return booting;
}

// All listeners are registered synchronously at top level so they wake the worker.
chrome.runtime.onInstalled.addListener(() => {
  void boot().then(() => injectContentScripts());
});

chrome.runtime.onStartup.addListener(() => void boot());

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void boot().then(() => handleMessage(message, sender)).then(sendResponse);
  return true;
});

chrome.tabs.onActivated.addListener(() => {
  void boot().then(() => refreshActiveTab());
});

chrome.tabs.onUpdated.addListener((_tabId, change, tab) => {
  if (!tab.active) return;
  if (change.url !== undefined || change.title !== undefined || change.audible !== undefined || change.status === "complete") {
    void boot().then(() => refreshActiveTab());
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  void boot().then(async () => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return setUnfocused(true);
    await setUnfocused(false);
    await refreshActiveTab();
  });
});

chrome.idle.onStateChanged.addListener((state) => {
  void boot().then(() => setPaused(state !== "active"));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) void boot().then(() => ensureOffscreen()).then(() => tick());
});

void boot();
