import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AxiosError } from "axios";
import { apiErrorMessage, client, generateStandup, getHealth, getSummary, getTimeline, localTimeZone } from "./api";

describe("api", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  it("uses default baseURL", () => {
    expect(client.defaults.baseURL).toBe("http://localhost:8000");
  });

  it("getSummary sends date and tz params", async () => {
    const get = vi.spyOn(client, "get").mockResolvedValue({ data: { date: "2026-10-06" } });
    await getSummary("2026-10-06", "Asia/Kolkata");
    expect(get).toHaveBeenCalledWith("/api/summary", { params: { date: "2026-10-06", tz: "Asia/Kolkata" } });
  });

  it("getTimeline defaults tz to the browser zone", async () => {
    const get = vi.spyOn(client, "get").mockResolvedValue({ data: { events: [] } });
    await getTimeline("2026-10-06");
    expect(get).toHaveBeenCalledWith("/api/timeline", { params: { date: "2026-10-06", tz: localTimeZone() } });
  });

  it("generateStandup posts date and tz", async () => {
    const post = vi.spyOn(client, "post").mockResolvedValue({ data: { markdown: "x" } });
    const res = await generateStandup("2026-10-06", "UTC");
    expect(post).toHaveBeenCalledWith("/api/generate-standup", { date: "2026-10-06", tz: "UTC" });
    expect(res.markdown).toBe("x");
  });

  it("getHealth hits /api/health", async () => {
    const get = vi.spyOn(client, "get").mockResolvedValue({ data: { status: "ok" } });
    await getHealth();
    expect(get).toHaveBeenCalledWith("/api/health");
  });

  it("apiErrorMessage prefers backend detail", () => {
    const e = new AxiosError("fail", "ERR_BAD_RESPONSE", undefined, undefined, {
      status: 503,
      data: { detail: "Ollama unreachable at http://localhost:11434" },
    } as never);
    expect(apiErrorMessage(e)).toBe("Ollama unreachable at http://localhost:11434");
  });

  it("apiErrorMessage falls back to a connectivity message", () => {
    const e = new AxiosError("Network Error", "ERR_NETWORK");
    expect(apiErrorMessage(e)).toBe("Cannot reach Pulse backend at http://localhost:8000");
  });

  it("apiErrorMessage reads FastAPI 422 detail arrays", () => {
    const e = new AxiosError("bad", "ERR_BAD_REQUEST", undefined, undefined, {
      status: 422,
      data: { detail: [{ msg: "Invalid date" }] },
    } as never);
    expect(apiErrorMessage(e)).toBe("Invalid date");
  });
});
