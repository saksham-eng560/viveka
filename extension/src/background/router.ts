import { MSG, isBackgroundMessage, type BackgroundMessage, type Reply, type ReplyMap } from "../shared/messages";
import { handleNudgeAction } from "./nudge";
import { buildContextReset, groupTabs } from "./tabs";
import { getSettings, getSnapshot, loadState, mutate, sanitizeSettings } from "./state";
import { endSession, refreshActiveTab, setGoal, startSession } from "./tracker";

function assertNever(x: never): never {
  throw new Error(`Unhandled message: ${JSON.stringify(x)}`);
}

async function dispatch(msg: BackgroundMessage): Promise<ReplyMap[keyof ReplyMap]> {
  switch (msg.type) {
    case MSG.GET_STATE:
      return getSnapshot();
    case MSG.START_SESSION:
      return startSession(msg.goal, msg.durationMinutes);
    case MSG.SET_GOAL:
      return setGoal(msg.goal);
    case MSG.END_SESSION:
      return endSession();
    case MSG.SET_SETTINGS: {
      const before = await getSettings();
      const next = sanitizeSettings(msg.patch, before);
      await mutate((s) => void (s.snapshot.settings = next));
      if (next.model !== before.model || next.ollamaUrl !== before.ollamaUrl) {
        await mutate((s) => void (s.snapshot.aiStatus = "online"));
        void refreshActiveTab({ force: true });
      }
      return getSnapshot();
    }
    case MSG.GET_CONTEXT_RESET: {
      const snap = await getSnapshot();
      return buildContextReset(snap.settings, snap.currentGoal);
    }
    case MSG.GROUP_TABS: {
      const snap = await getSnapshot();
      return groupTabs(snap.settings, snap.currentGoal);
    }
    case MSG.DISMISS_NUDGE:
      await handleNudgeAction("dismiss");
      return null;
    case MSG.NUDGE_ACTION:
      await handleNudgeAction(msg.action);
      return null;
    case MSG.KEEPALIVE_PING:
      await loadState();
      return { pong: true } as const;
    default:
      return assertNever(msg);
  }
}

const FROM_ANY = new Set<string>([MSG.GET_STATE, MSG.KEEPALIVE_PING, MSG.DISMISS_NUDGE]);

/** Content scripts carry sender.tab; extension pages (side panel, popup, offscreen) do not. */
function senderAllowed(type: string, sender: SenderLike | undefined): boolean {
  if (!sender || sender.id !== chrome.runtime.id) return false;
  if (FROM_ANY.has(type)) return true;
  return type === MSG.NUDGE_ACTION ? !!sender.tab : !sender.tab;
}

export interface SenderLike {
  id?: string;
  tab?: unknown;
}

/** Handle one message from UI, content script or offscreen. Never throws; returns a Reply. */
export async function handleMessage(raw: unknown, sender?: SenderLike): Promise<Reply<unknown>> {
  if (!isBackgroundMessage(raw)) return { ok: false, error: "Unknown or non-background message" };
  if (!senderAllowed(raw.type, sender)) return { ok: false, error: "Message not allowed from this sender" };
  try {
    return { ok: true, data: await dispatch(raw) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
