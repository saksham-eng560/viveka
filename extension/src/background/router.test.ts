import { describe, expect, it, vi } from "vitest";
import { installChrome } from "../test/chrome-mock";
import { MSG } from "../shared/messages";
import { handleMessage } from "./router";

const BG_MESSAGES: Record<string, unknown> = {
  [MSG.GET_STATE]: { type: MSG.GET_STATE },
  [MSG.START_SESSION]: { type: MSG.START_SESSION, goal: "Build", durationMinutes: 25 },
  [MSG.SET_GOAL]: { type: MSG.SET_GOAL, goal: "Build more" },
  [MSG.END_SESSION]: { type: MSG.END_SESSION },
  [MSG.SET_SETTINGS]: { type: MSG.SET_SETTINGS, patch: { demoMode: true } },
  [MSG.GET_CONTEXT_RESET]: { type: MSG.GET_CONTEXT_RESET },
  [MSG.GROUP_TABS]: { type: MSG.GROUP_TABS },
  [MSG.DISMISS_NUDGE]: { type: MSG.DISMISS_NUDGE },
  [MSG.NUDGE_ACTION]: { type: MSG.NUDGE_ACTION, action: "dismiss" },
  [MSG.KEEPALIVE_PING]: { type: MSG.KEEPALIVE_PING, ts: 1 },
};
const EXT = { id: "test-extension-id" };
const CONTENT = { id: "test-extension-id", tab: { id: 5 } };
const OUTBOUND = [MSG.STATE_UPDATED, MSG.TRIGGER_NUDGE, MSG.HIDE_NUDGE];

describe("router", () => {
  it("covers every MSG type: handled in background or explicitly outbound", () => {
    for (const type of Object.values(MSG)) {
      expect(type in BG_MESSAGES || OUTBOUND.includes(type as never), type).toBe(true);
    }
  });

  it("answers every background message with ok:true", async () => {
    installChrome([{ id: 1, windowId: 1, url: "https://github.com/a", title: "gh", active: true }]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
    for (const type of [MSG.GET_STATE, MSG.START_SESSION, MSG.SET_GOAL, MSG.SET_SETTINGS, MSG.GET_CONTEXT_RESET, MSG.GROUP_TABS, MSG.DISMISS_NUDGE, MSG.NUDGE_ACTION, MSG.KEEPALIVE_PING, MSG.END_SESSION]) {
      const reply = await handleMessage(BG_MESSAGES[type], type === MSG.NUDGE_ACTION ? CONTENT : EXT);
      expect(reply, type).toMatchObject({ ok: true });
    }
  });

  it("rejects outbound/unknown messages and surfaces errors as ok:false", async () => {
    installChrome();
    for (const type of OUTBOUND) expect(await handleMessage({ type }, EXT)).toMatchObject({ ok: false });
    expect(await handleMessage(null, EXT)).toMatchObject({ ok: false });
    expect(await handleMessage({ type: MSG.START_SESSION, goal: "  ", durationMinutes: null }, EXT)).toEqual({
      ok: false,
      error: "Please enter a goal first.",
    });
    expect(await handleMessage({ type: MSG.END_SESSION }, EXT)).toMatchObject({ ok: false });
  });

  it("sanitizes settings patches", async () => {
    installChrome();
    const r = (await handleMessage({ type: MSG.SET_SETTINGS, patch: { ollamaUrl: "http://127.0.0.1:11434/", nudgeThresholdSeconds: 1, awUrl: "javascript:x" } }, EXT)) as {
      ok: true;
      data: { settings: { ollamaUrl: string; nudgeThresholdSeconds: number; awUrl: string } };
    };
    expect(r.data.settings).toMatchObject({ ollamaUrl: "http://127.0.0.1:11434", nudgeThresholdSeconds: 5, awUrl: "http://localhost:5600" });
  });

  it("rejects foreign senders and enforces tab/no-tab rules per message type", async () => {
    installChrome([{ id: 1, windowId: 1, url: "https://github.com/a", title: "gh", active: true }]);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
    const denied = { ok: false, error: "Message not allowed from this sender" };
    // no sender / foreign extension
    expect(await handleMessage(BG_MESSAGES[MSG.GET_STATE])).toEqual(denied);
    expect(await handleMessage(BG_MESSAGES[MSG.GET_STATE], { id: "other" })).toEqual(denied);
    // UI-only messages must not come from a content script (page context)
    for (const type of [MSG.START_SESSION, MSG.END_SESSION, MSG.SET_GOAL, MSG.SET_SETTINGS, MSG.GET_CONTEXT_RESET, MSG.GROUP_TABS]) {
      expect(await handleMessage(BG_MESSAGES[type], CONTENT), type).toEqual(denied);
    }
    // NUDGE_ACTION requires a tab sender
    expect(await handleMessage(BG_MESSAGES[MSG.NUDGE_ACTION], EXT)).toEqual(denied);
    expect(await handleMessage(BG_MESSAGES[MSG.NUDGE_ACTION], CONTENT)).toMatchObject({ ok: true });
    // allowed from both
    for (const type of [MSG.GET_STATE, MSG.KEEPALIVE_PING, MSG.DISMISS_NUDGE]) {
      expect(await handleMessage(BG_MESSAGES[type], EXT), type).toMatchObject({ ok: true });
      expect(await handleMessage(BG_MESSAGES[type], CONTENT), type).toMatchObject({ ok: true });
    }
  });
});
