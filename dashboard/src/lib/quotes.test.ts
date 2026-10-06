import { describe, expect, it } from "vitest";
import { QUOTES, hashSeed, quoteFor } from "./quotes";

const EXPECTED: Array<[string, string, string]> = [
  ["q1", "Arise, awake, and stop not till the goal is reached.", "Complete Works, Vol. 3: The Vedanta (after the Katha Upanishad)"],
  ["q2", "Take up one idea. Make that one idea your life — think of it, dream of it, live on that idea.", "Complete Works, Vol. 1: Raja-Yoga, Pratyahara and Dharana"],
  ["q3", "Those who really want to be Yogis must give up, once for all, this nibbling at things.", "Complete Works, Vol. 1: Raja-Yoga, Pratyahara and Dharana"],
  ["q5", "This, the power of concentration, is the only key to the treasure-house of knowledge.", "Complete Works, Vol. 2: The Ideal of a Universal Religion"],
  ["q6", "All the powers in the universe are already ours. It is we who have put our hands before our eyes and cry that it is dark.", "Complete Works, Vol. 2: Practical Vedanta, Part I"],
  ["q7", "Stand up, be bold, be strong. Take the whole responsibility on your own shoulders, and know that you are the creator of your own destiny.", "Complete Works, Vol. 2: Jnana-Yoga, The Cosmos: The Microcosm"],
  ["q8", "Each soul is potentially divine. The goal is to manifest this Divinity within by controlling nature, external and internal.", "Complete Works, Vol. 1: Raja-Yoga, Preface"],
  ["q9", "We are what our thoughts have made us; so take care of what you think.", "Complete Works, Vol. 7: Inspired Talks (a disciple's record)"],
  ["q10", "Do one thing at a time and while doing it put your whole soul into it to the exclusion of all else.", "Complete Works, Vol. 6: Notes of Class Talks, On Raja-Yoga (students' notes)"],
];

describe("QUOTES", () => {
  it("matches the canonical literal exactly (9 quotes, q4 absent)", () => {
    expect(QUOTES.map((q) => [q.id, q.text, q.source])).toEqual(EXPECTED);
    expect(QUOTES.some((q) => q.id === "q4")).toBe(false);
  });
  it("has unique ids", () => {
    expect(new Set(QUOTES.map((q) => q.id)).size).toBe(QUOTES.length);
  });
});

describe("quoteFor", () => {
  it("is deterministic", () => {
    expect(quoteFor("emptyDay", "2026-10-06")).toBe(quoteFor("emptyDay", "2026-10-06"));
    expect(hashSeed("abc")).toBe(hashSeed("abc"));
  });
  it("emptyDay stays within q5/q6 and uses both across seeds", () => {
    const ids = new Set<string>();
    for (let d = 1; d <= 28; d++) ids.add(quoteFor("emptyDay", `2026-10-${String(d).padStart(2, "0")}`).id);
    expect([...ids].sort()).toEqual(["q5", "q6"]);
    expect(["q5", "q6"]).toContain(quoteFor("emptyDay").id);
  });
  it("standupIdle is always q7", () => {
    expect(quoteFor("standupIdle").id).toBe("q7");
    expect(quoteFor("standupIdle", "anything").id).toBe("q7");
  });
});
