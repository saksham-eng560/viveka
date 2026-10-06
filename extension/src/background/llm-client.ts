import type { Classification, ClassifiedResult, Settings } from "../shared/types";
import { heuristicClassify, isBrowserInternal } from "./heuristic";

export const CACHE_KEY = "lighthouse_cache";
export const CACHE_MAX_ENTRIES = 500;
export const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
export const CLASSIFY_TIMEOUT_MS = 8000;

interface CacheEntry extends Classification {
  ts: number;
}

let cache: Record<string, CacheEntry> | null = null;

export function resetLlmClientForTests(): void {
  cache = null;
}

export function stripHash(url: string): string {
  const i = url.indexOf("#");
  return i === -1 ? url : url.slice(0, i);
}

export function cacheKey(goal: string | null, url: string): string {
  return `${goal ?? ""}|${stripHash(url)}`;
}

async function loadCache(): Promise<Record<string, CacheEntry>> {
  if (cache) return cache;
  const raw = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] as Record<string, CacheEntry> | undefined;
  cache = raw && typeof raw === "object" ? raw : {};
  return cache;
}

export async function peekCache(goal: string | null, url: string, now = Date.now()): Promise<Classification | null> {
  const c = await loadCache();
  const hit = c[cacheKey(goal, url)];
  if (!hit || now - hit.ts > CACHE_TTL_MS) return null;
  return { score: hit.score, category: hit.category, reasoning: hit.reasoning };
}

async function putCache(goal: string | null, url: string, value: Classification, now: number): Promise<void> {
  const c = await loadCache();
  c[cacheKey(goal, url)] = { ...value, ts: now };
  const keys = Object.keys(c);
  if (keys.length > CACHE_MAX_ENTRIES) {
    keys
      .sort((a, b) => (c[a]?.ts ?? 0) - (c[b]?.ts ?? 0))
      .slice(0, keys.length - CACHE_MAX_ENTRIES)
      .forEach((k) => delete c[k]);
  }
  await chrome.storage.local.set({ [CACHE_KEY]: c });
}

export const CLASSIFY_SYSTEM_PROMPT = `You are an intent classifier for a gentle focus coach.
Given the user's GOAL, a page URL and its title, rate how much the page supports the goal.
Reply with ONLY a JSON object: {"score": <integer 0-100>, "category": "<ONE word>", "reasoning": "<one short sentence>"}.
Scoring: 0-39 distraction, 40-69 neutral or loosely related, 70-100 directly helps the goal.
Category is a single word such as Coding, Research, Learning, Planning, Communication, Entertainment, Social, Distraction.
Reasoning is one short, kind sentence. Judge by context: the same site can help or distract depending on the goal.

Examples:
GOAL: Building a React dashboard
URL: https://github.com/acme/dashboard/pull/12
TITLE: Add chart component by sam - Pull Request #12
{"score": 95, "category": "Coding", "reasoning": "Reviewing a pull request for the dashboard."}

GOAL: Building a React dashboard
URL: https://www.reddit.com/r/funny
TITLE: r/funny - Hilarious cat fails
{"score": 8, "category": "Distraction", "reasoning": "Humor content unrelated to the dashboard."}

GOAL: Learn Rust ownership
URL: https://www.youtube.com/watch?v=abc123
TITLE: Rust Ownership Explained in 15 Minutes
{"score": 88, "category": "Learning", "reasoning": "A tutorial on exactly the topic being studied."}

GOAL: Write quarterly report
URL: https://www.youtube.com/watch?v=xyz789
TITLE: 10 Funniest Cat Videos of 2025
{"score": 6, "category": "Entertainment", "reasoning": "Entertainment video unrelated to the report."}`;

export const CLASSIFY_FORMAT = {
  type: "object",
  properties: {
    score: { type: "integer" },
    category: { type: "string" },
    reasoning: { type: "string" },
  },
  required: ["score", "category", "reasoning"],
} as const;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

interface GenerateOptions {
  numPredict: number;
  temperature?: number;
  format?: unknown;
  timeoutMs?: number;
}

/** POST /api/generate per contract C4; returns the model's `.response` text or throws. */
export async function generate(
  settings: Settings,
  system: string,
  prompt: string,
  opts: GenerateOptions,
): Promise<string> {
  const body: Record<string, unknown> = {
    model: settings.model,
    system,
    prompt,
    stream: false,
    think: false,
    options: { temperature: opts.temperature ?? 0, num_predict: opts.numPredict },
  };
  if (opts.format) body["format"] = opts.format;
  const res = await fetchWithTimeout(
    `${settings.ollamaUrl}/api/generate`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    opts.timeoutMs ?? CLASSIFY_TIMEOUT_MS,
  );
  if (!res.ok) throw new Error(`Ollama responded ${res.status}`);
  const json = (await res.json()) as { response?: unknown };
  if (typeof json.response !== "string") throw new Error("Malformed Ollama response");
  return json.response;
}

export async function probeOllama(settings: Settings, timeoutMs = 3000): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${settings.ollamaUrl}/api/tags`, { method: "GET" }, timeoutMs);
    return res.ok;
  } catch {
    return false;
  }
}

function titleCaseWord(raw: string): string {
  const w = raw.trim().split(/[\s,/&|-]+/)[0]?.replace(/[^A-Za-z0-9+#]/g, "") ?? "";
  return w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : "Uncategorized";
}

export function parseClassification(text: string): Classification | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
    const rawScore = typeof obj["score"] === "string" ? Number(obj["score"]) : obj["score"];
    if (typeof rawScore !== "number" || !Number.isFinite(rawScore)) return null;
    if (typeof obj["category"] !== "string" || typeof obj["reasoning"] !== "string") return null;
    return {
      score: Math.max(0, Math.min(100, Math.round(rawScore))),
      category: titleCaseWord(obj["category"]),
      reasoning: obj["reasoning"].trim().slice(0, 200) || "Classified by your local model.",
    };
  } catch {
    return null;
  }
}

export interface ClassifyInput {
  goal: string | null;
  url: string;
  title: string;
}

export interface ClassifyOutcome {
  result: ClassifiedResult;
  /** true: LLM answered, false: LLM attempted and failed, null: LLM not involved. */
  aiOk: boolean | null;
}

export async function classify(
  input: ClassifyInput,
  settings: Settings,
  opts: { aiAvailable?: boolean; now?: number } = {},
): Promise<ClassifyOutcome> {
  const now = opts.now ?? Date.now();
  const heuristic = (): ClassifiedResult => ({
    ...heuristicClassify(input.goal, input.url, input.title),
    source: "heuristic",
  });
  if (isBrowserInternal(input.url) || !input.goal) return { result: heuristic(), aiOk: null };

  const cached = await peekCache(input.goal, input.url, now);
  if (cached) return { result: { ...cached, source: "llm" }, aiOk: null };
  if (opts.aiAvailable === false) return { result: heuristic(), aiOk: null };

  try {
    const text = await generate(
      settings,
      CLASSIFY_SYSTEM_PROMPT,
      `GOAL: ${input.goal}\nURL: ${stripHash(input.url)}\nTITLE: ${input.title}`,
      { numPredict: 120, temperature: 0, format: CLASSIFY_FORMAT },
    );
    const parsed = parseClassification(text);
    if (!parsed) return { result: heuristic(), aiOk: false };
    await putCache(input.goal, input.url, parsed, now);
    return { result: { ...parsed, source: "llm" }, aiOk: true };
  } catch {
    return { result: heuristic(), aiOk: false };
  }
}
