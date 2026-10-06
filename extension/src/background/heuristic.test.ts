import { describe, expect, it } from "vitest";
import { goalKeywords, heuristicClassify, shortGoal } from "./heuristic";

const GOAL = "Building a React dashboard for the hackathon";

describe("heuristicClassify", () => {
  it("scores github as high-scoring Coding for the demo goal (G1)", () => {
    const r = heuristicClassify(GOAL, "https://github.com/acme/app", "GitHub - acme/app");
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.category).toBe("Coding");
  });

  it("scores reddit as a low Distraction for the demo goal (G1)", () => {
    const r = heuristicClassify(GOAL, "https://www.reddit.com/r/funny", "r/funny");
    expect(r.score).toBeLessThanOrEqual(15);
    expect(r.category).toBe("Distraction");
  });

  it("boosts +25 on goal keyword match and caps at 95", () => {
    const base = heuristicClassify(GOAL, "https://example.com/", "Hello");
    const boosted = heuristicClassify(GOAL, "https://example.com/", "React tips");
    expect(boosted.score - base.score).toBe(25);
    const capped = heuristicClassify(GOAL, "https://github.com/acme/dashboard", "dashboard repo");
    expect(capped.score).toBe(95);
  });

  it("treats a youtube watch page as a distraction unless it matches the goal", () => {
    expect(heuristicClassify(GOAL, "https://www.youtube.com/watch?v=1", "Funny cats").score).toBeLessThan(40);
    expect(heuristicClassify(GOAL, "https://www.youtube.com/watch?v=2", "React dashboard tutorial").score).toBeGreaterThanOrEqual(60);
  });

  it("returns neutral 50 Browser for chrome:// and extension pages", () => {
    for (const url of ["chrome://extensions", "chrome-extension://abc/page.html", "about:blank"]) {
      expect(heuristicClassify(GOAL, url, "x")).toMatchObject({ score: 50, category: "Browser" });
    }
  });

  it("is deterministic", () => {
    const a = heuristicClassify(GOAL, "https://stackoverflow.com/q/1", "How to center a div");
    const b = heuristicClassify(GOAL, "https://stackoverflow.com/q/1", "How to center a div");
    expect(a).toEqual(b);
  });

  it("works without a goal", () => {
    expect(heuristicClassify(null, "https://news.example.org/", "Headlines").score).toBe(50);
  });
});

describe("helpers", () => {
  it("extracts meaningful goal keywords", () => {
    expect(goalKeywords(GOAL)).toEqual(expect.arrayContaining(["react", "dashboard", "hackathon"]));
    expect(goalKeywords(null)).toEqual([]);
  });
  it("shortens long goals", () => {
    expect(shortGoal("one two three four five six seven eight", 4)).toBe("one two three four…");
  });
});
