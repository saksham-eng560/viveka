import { describe, expect, it, vi } from "vitest";
import { jsonResponse } from "../test/chrome-mock";
import type { LighthouseEventData } from "../shared/types";
import { AW_BUFFER_CAP, awStatus, buildEvent, ensureBucket, flush, planHeartbeat, submit } from "./aw-client";

const AW = "http://localhost:5600";
const data = (over: Partial<LighthouseEventData> = {}): LighthouseEventData => ({
  url: "https://github.com/a",
  title: "A",
  audible: false,
  incognito: false,
  tabCount: 3,
  goal_active: "g",
  ai_score: 90,
  ai_category: "Coding",
  ai_reasoning: "r",
  ai_source: "heuristic",
  ...over,
});

describe("aw-client", () => {
  it("creates the bucket with the contract body (304 is fine)", async () => {
    const f = vi.fn(async () => new Response(null, { status: 304 }));
    vi.stubGlobal("fetch", f);
    expect(await ensureBucket(AW)).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${AW}/api/0/buckets/aw-watcher-web-lighthouse`);
    expect(JSON.parse(init.body as string)).toEqual({
      id: "aw-watcher-web-lighthouse",
      client: "lighthouse-extension",
      type: "web.tab.current",
      hostname: "lighthouse",
    });
  });

  it("posts heartbeats with pulsetime=30 and a zero-duration event", async () => {
    const f = vi.fn(async () => jsonResponse({}));
    vi.stubGlobal("fetch", f);
    const status = await submit(AW, [buildEvent(1_700_000_000_000, data())], 1_700_000_000_000);
    expect(status).toEqual({ online: true, buffered: 0 });
    const hb = f.mock.calls.map((c) => c as unknown as [string, RequestInit]).find(([u]) => u.includes("/heartbeat"))!;
    expect(hb[0]).toBe(`${AW}/api/0/buckets/aw-watcher-web-lighthouse/heartbeat?pulsetime=30`);
    const body = JSON.parse(hb[1].body as string);
    expect(body.duration).toBe(0);
    expect(body.timestamp).toBe(new Date(1_700_000_000_000).toISOString());
    expect(body.data.ai_score).toBe(90);
  });

  it("double-heartbeats on change: previous data at now-1ms, then new data at now", () => {
    const prev = data();
    const next = data({ url: "https://reddit.com", ai_score: 10 });
    const events = planHeartbeat(10_000, next, prev);
    expect(events.map((e) => [e.timestamp, e.data.url])).toEqual([
      [new Date(9_999).toISOString(), prev.url],
      [new Date(10_000).toISOString(), next.url],
    ]);
    expect(planHeartbeat(10_000, prev, prev)).toHaveLength(1);
    expect(planHeartbeat(10_000, prev, null)).toHaveLength(1);
  });

  it("buffers while ActivityWatch is offline, then flushes in order", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
    const t0 = 1_000_000;
    const s1 = await submit(AW, [buildEvent(t0, data({ title: "one" }))], t0);
    expect(s1).toEqual({ online: false, buffered: 1 });
    expect((await submit(AW, [buildEvent(t0 + 1, data({ title: "two" }))], t0 + 1)).buffered).toBe(2);
    expect(chrome.storage.local.set).toHaveBeenCalled();

    const sent: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (u: string, init: RequestInit) => {
      if (u.includes("/heartbeat")) sent.push(JSON.parse(init.body as string).data.title);
      return jsonResponse({});
    }));
    // still inside the backoff window: no attempt
    expect((await flush(AW, { now: t0 + 10 })).online).toBe(false);
    expect(sent).toEqual([]);
    const after = await flush(AW, { now: t0 + 70_000 });
    expect(after).toEqual({ online: true, buffered: 0 });
    expect(sent).toEqual(["one", "two"]);
  });

  it("caps the offline buffer, dropping the oldest events", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("down"); }));
    const events = Array.from({ length: AW_BUFFER_CAP + 25 }, (_, i) => buildEvent(i, data({ title: `e${i}` })));
    await submit(AW, events, 0);
    expect(awStatus().buffered).toBe(AW_BUFFER_CAP);
    const stored = (await chrome.storage.local.get("lighthouse_aw_buffer"))["lighthouse_aw_buffer"] as { data: { title: string } }[];
    expect(stored[0]?.data.title).toBe("e25");
  });
});
