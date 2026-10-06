import { beforeEach, describe, expect, it, vi } from "vitest";
import { jsonResponse } from "../test/chrome-mock";
import { DEFAULT_SETTINGS } from "../shared/config";
import { cacheKey, classify, parseClassification, probeOllama } from "./llm-client";

const settings = { ...DEFAULT_SETTINGS };
const input = { goal: "Building a React dashboard", url: "https://github.com/a/b#readme", title: "GitHub" };

function mockOllama(response: unknown, status = 200) {
  const fetchMock = vi.fn(async () => jsonResponse({ response }, status));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("classify", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));

  it("parses a valid JSON answer and sends the C4 request body", async () => {
    const f = mockOllama(JSON.stringify({ score: 92, category: "coding", reasoning: "Relevant to the dashboard." }));
    const out = await classify(input, settings);
    expect(out.result).toMatchObject({ score: 92, category: "Coding", source: "llm" });
    expect(out.aiOk).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:11434/api/generate");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: "qwen3.5:4b", stream: false, think: false, options: { temperature: 0, num_predict: 120 } });
    expect(body.format.required).toEqual(["score", "category", "reasoning"]);
    expect(body.system).toContain("Examples");
    expect(body.prompt).toContain("GOAL: Building a React dashboard");
    expect(body.prompt).not.toContain("#readme");
  });

  it("clamps scores to 0-100 and reduces category to one word", async () => {
    mockOllama(JSON.stringify({ score: 140, category: "Deep coding work", reasoning: "ok" }));
    const hi = await classify(input, settings);
    expect(hi.result.score).toBe(100);
    expect(hi.result.category).toBe("Deep");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ response: JSON.stringify({ score: -5, category: "x", reasoning: "y" }) })));
    const lo = await classify({ ...input, url: "https://other.example/" }, settings);
    expect(lo.result.score).toBe(0);
  });

  it.each([
    ["invalid JSON", () => mockOllama("not json at all")],
    ["HTTP 403", () => mockOllama("", 403)],
    ["network error", () => vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("Failed to fetch"); }))],
  ])("falls back to heuristic on %s", async (_name, arrange) => {
    arrange();
    const out = await classify(input, settings);
    expect(out.aiOk).toBe(false);
    expect(out.result.source).toBe("heuristic");
    expect(out.result.score).toBeGreaterThanOrEqual(85);
  });

  it("falls back to heuristic on timeout (8 s)", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_u: string, init: RequestInit) =>
      new Promise((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")))),
    ));
    const p = classify(input, settings);
    await vi.advanceTimersByTimeAsync(8100);
    const out = await p;
    expect(out.aiOk).toBe(false);
    expect(out.result.source).toBe("heuristic");
  });

  it("serves cache hits without fetching and keys on goal + url without hash", async () => {
    const f = mockOllama(JSON.stringify({ score: 77, category: "Research", reasoning: "fine" }));
    await classify(input, settings);
    const again = await classify({ ...input, url: "https://github.com/a/b#other" }, settings);
    expect(f).toHaveBeenCalledTimes(1);
    expect(again.result).toMatchObject({ score: 77, source: "llm" });
    expect(again.aiOk).toBeNull();
    await classify({ ...input, goal: "Different goal" }, settings);
    expect(f).toHaveBeenCalledTimes(2);
    expect(cacheKey("g", "https://x.com/a#h")).toBe("g|https://x.com/a");
  });

  it("skips the LLM for internal pages, missing goals and when AI is known offline", async () => {
    const f = mockOllama("{}");
    await classify({ ...input, url: "chrome://settings" }, settings);
    await classify({ ...input, goal: null }, settings);
    await classify(input, settings, { aiAvailable: false });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("parseClassification / probe", () => {
  it("extracts JSON wrapped in prose or fences", () => {
    expect(parseClassification('```json\n{"score":"61","category":"Planning","reasoning":"ok"}\n```')?.score).toBe(61);
    expect(parseClassification('{"score": 5}')).toBeNull();
  });
  it("probeOllama reports reachability", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ models: [] })));
    expect(await probeOllama(settings)).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 403)));
    expect(await probeOllama(settings)).toBe(false);
  });
});
