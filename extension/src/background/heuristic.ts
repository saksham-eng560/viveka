import type { Classification } from "../shared/types";

// Pure, deterministic fallback classifier used when the local LLM is unavailable.

const STOPWORDS = new Set([
  "about", "after", "again", "also", "build", "building", "built", "from", "have", "into", "make",
  "making", "need", "needs", "that", "their", "them", "then", "these", "this", "those", "with",
  "work", "working", "your", "doing", "using", "write", "writing", "today", "some", "more", "just",
  "for", "the", "and", "are", "was", "will", "get", "getting", "learn", "learning", "finish",
]);

const DEV_TERMS =
  /\b(build|building|code|coding|develop|developing|dashboard|app|api|react|vue|svelte|typescript|javascript|python|rust|bug|fix|hackathon|project|software|frontend|backend|deploy|repo|feature|website|extension)\b/i;

interface DomainRule {
  hosts: string[];
  category: string;
  base: number;
  reasoning: string;
  coding?: boolean;
}

const PRODUCTIVE: DomainRule[] = [
  { hosts: ["github.com", "gitlab.com", "bitbucket.org", "vscode.dev", "github.dev", "codesandbox.io", "stackblitz.com", "replit.com", "codepen.io", "localhost", "127.0.0.1"], category: "Coding", base: 78, coding: true, reasoning: "A developer workspace that supports building." },
  { hosts: ["stackoverflow.com", "stackexchange.com", "developer.mozilla.org", "react.dev", "nextjs.org", "vitejs.dev", "tailwindcss.com", "typescriptlang.org", "nodejs.org", "docs.python.org", "readthedocs.io", "devdocs.io", "npmjs.com"], category: "Research", base: 74, reasoning: "Reference material that helps you make progress." },
  { hosts: ["linear.app", "atlassian.net", "jira.com", "notion.so", "trello.com", "asana.com", "docs.google.com", "figma.com"], category: "Planning", base: 68, reasoning: "Planning and collaboration tools for your work." },
];

const DISTRACTING: DomainRule[] = [
  { hosts: ["reddit.com", "twitter.com", "x.com", "instagram.com", "facebook.com", "tiktok.com", "netflix.com", "9gag.com", "twitch.tv", "buzzfeed.com", "pinterest.com", "imgur.com"], category: "Distraction", base: 10, reasoning: "Social or entertainment content, unrelated to your goal." },
];

const NEUTRAL: DomainRule[] = [
  { hosts: ["slack.com", "mail.google.com", "outlook.com", "teams.microsoft.com", "discord.com", "zoom.us", "meet.google.com"], category: "Communication", base: 55, reasoning: "Communication tools, neutral for your goal." },
  { hosts: ["google.com", "bing.com", "duckduckgo.com"], category: "Search", base: 55, reasoning: "Searching can be part of the work." },
];

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function isBrowserInternal(url: string): boolean {
  try {
    const p = new URL(url).protocol;
    return p !== "http:" && p !== "https:";
  } catch {
    return true;
  }
}

function matches(host: string, rule: DomainRule): boolean {
  return rule.hosts.some((h) => host === h || host.endsWith("." + h));
}

export function goalKeywords(goal: string | null): string[] {
  if (!goal) return [];
  const words = goal.toLowerCase().match(/[a-z0-9+#.]{3,}/g) ?? [];
  const seen = new Set<string>();
  for (const w of words) {
    const clean = w.replace(/^[.]+|[.]+$/g, "");
    if (clean.length >= 4 && !STOPWORDS.has(clean)) seen.add(clean);
  }
  return [...seen];
}

export function shortGoal(goal: string, maxWords = 6): string {
  const words = goal.trim().replace(/\s+/g, " ").split(" ");
  const short = words.slice(0, maxWords).join(" ");
  return words.length > maxWords ? `${short}…` : short;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export function heuristicClassify(goal: string | null, url: string, title: string): Classification {
  if (isBrowserInternal(url)) {
    return { score: 50, category: "Browser", reasoning: "Browser page, neutral for your goal." };
  }
  const host = hostnameOf(url);
  const haystack = `${title} ${host} ${safePath(url)}`.toLowerCase();
  const hits = goalKeywords(goal).filter((k) => haystack.includes(k));

  const rule = PRODUCTIVE.find((r) => matches(host, r));
  const distracting = rule ? undefined : DISTRACTING.find((r) => matches(host, r));
  const neutral = rule || distracting ? undefined : NEUTRAL.find((r) => matches(host, r));
  const isYoutube = host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";

  let score = 50;
  let category = "Browsing";
  let reasoning = "Not clearly related to your goal.";

  if (rule) {
    score = rule.base;
    category = rule.category;
    reasoning = rule.reasoning;
    if (rule.coding && goal && DEV_TERMS.test(goal)) score += 10;
  } else if (distracting) {
    score = distracting.base;
    category = distracting.category;
    reasoning = distracting.reasoning;
  } else if (isYoutube) {
    const isWatch = /\/(watch|shorts)|youtu\.be/.test(url);
    if (isWatch && hits.length === 0) {
      score = 12;
      category = "Distraction";
      reasoning = "Video content that doesn't match your goal.";
    } else {
      score = 50;
      category = hits.length ? "Research" : "Video";
      reasoning = hits.length ? "Looks related to your goal." : "Video site, neutral for your goal.";
    }
  } else if (neutral) {
    score = neutral.base;
    category = neutral.category;
    reasoning = neutral.reasoning;
  }

  if (hits.length > 0) {
    score += 25;
    if (category === "Browsing") category = "Research";
    reasoning = `Matches your goal: ${hits.slice(0, 3).join(", ")}.`;
    score = Math.min(score, 95);
  }
  return { score: clamp(score), category, reasoning };
}

function safePath(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname).replace(/[-_/]+/g, " ");
  } catch {
    return "";
  }
}
