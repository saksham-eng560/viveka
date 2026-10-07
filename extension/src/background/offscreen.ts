export const OFFSCREEN_PATH = "src/offscreen/index.html";

/** Create the keep-alive offscreen document if none exists. */
export async function ensureOffscreen(): Promise<boolean> {
  try {
    const url = chrome.runtime.getURL(OFFSCREEN_PATH);
    const existing = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [url],
    });
    if (existing.length > 0) return false;
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_PATH,
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Keeps Viveka's service worker alive so tab tracking and nudges stay continuous.",
    });
    return true;
  } catch {
    return false; // already exists (race) or API unavailable
  }
}
