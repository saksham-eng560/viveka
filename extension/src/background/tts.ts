import type { Settings } from "../shared/types";
import { shortGoal } from "./heuristic";

export function nudgePhrase(goal: string): string {
  return `Focus back on ${shortGoal(goal, 5)}`;
}

/** Speak a gentle nudge. Skipped when voice is off or the active tab is playing audio. */
export async function speakNudge(goal: string, settings: Settings, tabId: number): Promise<boolean> {
  if (!settings.voiceNudges) return false;
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.audible) return false;
    chrome.tts.stop();
    chrome.tts.speak(nudgePhrase(goal), { rate: 1, enqueue: false });
    return true;
  } catch {
    return false;
  }
}
