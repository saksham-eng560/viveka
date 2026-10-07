import type {
  AppStateSnapshot,
  ContextResetSummary,
  NudgePayload,
  SessionReceipt,
  Settings,
} from "./types";

export const MSG = {
  GET_STATE: "GET_STATE",
  START_SESSION: "START_SESSION",
  END_SESSION: "END_SESSION",
  SET_GOAL: "SET_GOAL",
  SET_SETTINGS: "SET_SETTINGS",
  GET_CONTEXT_RESET: "GET_CONTEXT_RESET",
  GROUP_TABS: "GROUP_TABS",
  DISMISS_NUDGE: "DISMISS_NUDGE",
  STATE_UPDATED: "STATE_UPDATED",
  TRIGGER_NUDGE: "TRIGGER_NUDGE",
  HIDE_NUDGE: "HIDE_NUDGE",
  NUDGE_ACTION: "NUDGE_ACTION",
  KEEPALIVE_PING: "KEEPALIVE_PING",
} as const;

export type MsgType = (typeof MSG)[keyof typeof MSG];

export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

export type NudgeActionKind = "dismiss" | "back_to_work" | "snooze" | "its_work";

/** Messages handled by the background service worker. */
export type BackgroundMessage =
  | { type: typeof MSG.GET_STATE }
  | { type: typeof MSG.START_SESSION; goal: string; durationMinutes: number | null }
  | { type: typeof MSG.SET_GOAL; goal: string }
  | { type: typeof MSG.END_SESSION }
  | { type: typeof MSG.SET_SETTINGS; patch: Partial<Settings> }
  | { type: typeof MSG.GET_CONTEXT_RESET }
  | { type: typeof MSG.GROUP_TABS }
  | { type: typeof MSG.DISMISS_NUDGE }
  | { type: typeof MSG.NUDGE_ACTION; action: NudgeActionKind }
  | { type: typeof MSG.KEEPALIVE_PING; ts: number };

/** Messages broadcast by the background to UI pages. */
export type BroadcastMessage = { type: typeof MSG.STATE_UPDATED; state: AppStateSnapshot };

/** Messages sent by the background to content scripts. */
export type ContentMessage =
  | { type: typeof MSG.TRIGGER_NUDGE; payload: NudgePayload }
  | { type: typeof MSG.HIDE_NUDGE };

export interface ReplyMap {
  [MSG.GET_STATE]: AppStateSnapshot;
  [MSG.START_SESSION]: AppStateSnapshot;
  [MSG.SET_GOAL]: AppStateSnapshot;
  [MSG.END_SESSION]: SessionReceipt;
  [MSG.SET_SETTINGS]: AppStateSnapshot;
  [MSG.GET_CONTEXT_RESET]: ContextResetSummary;
  [MSG.GROUP_TABS]: { groups: number; tabsGrouped: number; failed?: number };
  [MSG.DISMISS_NUDGE]: null;
  [MSG.NUDGE_ACTION]: null;
  [MSG.KEEPALIVE_PING]: { pong: true };
}

export function isBackgroundMessage(value: unknown): value is BackgroundMessage {
  if (typeof value !== "object" || value === null) return false;
  const t = (value as { type?: unknown }).type;
  return (
    t === MSG.GET_STATE ||
    t === MSG.START_SESSION ||
    t === MSG.SET_GOAL ||
    t === MSG.END_SESSION ||
    t === MSG.SET_SETTINGS ||
    t === MSG.GET_CONTEXT_RESET ||
    t === MSG.GROUP_TABS ||
    t === MSG.DISMISS_NUDGE ||
    t === MSG.NUDGE_ACTION ||
    t === MSG.KEEPALIVE_PING
  );
}

/** Typed helper for UI pages: send a message to the background and unwrap the reply. */
export async function send<K extends keyof ReplyMap>(
  message: Extract<BackgroundMessage, { type: K }>,
): Promise<ReplyMap[K]> {
  const reply = (await chrome.runtime.sendMessage(message)) as Reply<ReplyMap[K]> | undefined;
  if (!reply) throw new Error("No response from Viveka's background");
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}
