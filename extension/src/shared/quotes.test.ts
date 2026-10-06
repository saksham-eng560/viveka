import { describe, expect, it } from "vitest";
import { hashSeed, QUOTES, quoteFor, type QuoteContext } from "./quotes";

const VOL1 = "Complete Works, Vol. 1: Raja-Yoga";
const CANONICAL = [
  { id: "q1", text: "Arise, awake, and stop not till the goal is reached.", source: "Complete Works, Vol. 3: The Vedanta (after the Katha Upanishad)" },
  { id: "q2", text: "Take up one idea. Make that one idea your life — think of it, dream of it, live on that idea.", source: `${VOL1}, Pratyahara and Dharana` },
  { id: "q3", text: "Those who really want to be Yogis must give up, once for all, this nibbling at things.", source: `${VOL1}, Pratyahara and Dharana` },
  { id: "q5", text: "This, the power of concentration, is the only key to the treasure-house of knowledge.", source: "Complete Works, Vol. 2: The Ideal of a Universal Religion" },
  { id: "q6", text: "All the powers in the universe are already ours. It is we who have put our hands before our eyes and cry that it is dark.", source: "Complete Works, Vol. 2: Practical Vedanta, Part I" },
  { id: "q7", text: "Stand up, be bold, be strong. Take the whole responsibility on your own shoulders, and know that you are the creator of your own destiny.", source: "Complete Works, Vol. 2: Jnana-Yoga, The Cosmos: The Microcosm" },
  { id: "q8", text: "Each soul is potentially divine. The goal is to manifest this Divinity within by controlling nature, external and internal.", source: `${VOL1}, Preface` },
  { id: "q9", text: "We are what our thoughts have made us; so take care of what you think.", source: "Complete Works, Vol. 7: Inspired Talks (a disciple's record)" },
  { id: "q10", text: "Do one thing at a time and while doing it put your whole soul into it to the exclusion of all else.", source: "Complete Works, Vol. 6: Notes of Class Talks, On Raja-Yoga (students' notes)" },
];

const POOLS: Record<QuoteContext, string[]> = {
  sessionStart: ["q1"],
  nudge: ["q9", "q2", "q3", "q10"],
  emptyFocus: ["q5"],
  receipt: ["q7"],
  emptyList: ["q3"],
};

describe("quotes", () => {
  it("matches the canonical text exactly: 9 quotes, q4 absent", () => {
    expect(QUOTES).toEqual(CANONICAL);
    expect(QUOTES).toHaveLength(9);
    expect(QUOTES.map((q) => q.id)).not.toContain("q4");
    expect(new Set(QUOTES.map((q) => q.id)).size).toBe(QUOTES.length);
  });

  it("is deterministic and stays within each context pool", () => {
    for (const [ctx, pool] of Object.entries(POOLS) as [QuoteContext, string[]][]) {
      for (const seed of [undefined, "", "reddit.com|goal|10", "x|y|99"]) {
        const a = quoteFor(ctx, seed);
        expect(quoteFor(ctx, seed)).toEqual(a);
        expect(pool).toContain(a.id);
      }
    }
    expect(quoteFor("sessionStart").id).toBe("q1");
  });

  it("spreads nudge quotes across seeds and hashes deterministically", () => {
    const ids = new Set(Array.from({ length: 60 }, (_, i) => quoteFor("nudge", `host${i}|goal|${i}`).id));
    expect(ids.size).toBeGreaterThan(1);
    expect(hashSeed("abc")).toBe(hashSeed("abc"));
    expect(hashSeed("abc")).not.toBe(hashSeed("abd"));
    expect(Number.isInteger(hashSeed("abc"))).toBe(true);
  });
});
