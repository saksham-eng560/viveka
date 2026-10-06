// QUOTES:BEGIN
export interface Quote { id: string; text: string; source: string }
export const QUOTES: readonly Quote[] = [
  { id: "q1", text: "Arise, awake, and stop not till the goal is reached.", source: "Complete Works, Vol. 3: The Vedanta (after the Katha Upanishad)" },
  { id: "q2", text: "Take up one idea. Make that one idea your life — think of it, dream of it, live on that idea.", source: "Complete Works, Vol. 1: Raja-Yoga, Pratyahara and Dharana" },
  { id: "q3", text: "Those who really want to be Yogis must give up, once for all, this nibbling at things.", source: "Complete Works, Vol. 1: Raja-Yoga, Pratyahara and Dharana" },
  { id: "q5", text: "This, the power of concentration, is the only key to the treasure-house of knowledge.", source: "Complete Works, Vol. 2: The Ideal of a Universal Religion" },
  { id: "q6", text: "All the powers in the universe are already ours. It is we who have put our hands before our eyes and cry that it is dark.", source: "Complete Works, Vol. 2: Practical Vedanta, Part I" },
  { id: "q7", text: "Stand up, be bold, be strong. Take the whole responsibility on your own shoulders, and know that you are the creator of your own destiny.", source: "Complete Works, Vol. 2: Jnana-Yoga, The Cosmos: The Microcosm" },
  { id: "q8", text: "Each soul is potentially divine. The goal is to manifest this Divinity within by controlling nature, external and internal.", source: "Complete Works, Vol. 1: Raja-Yoga, Preface" },
  { id: "q9", text: "We are what our thoughts have made us; so take care of what you think.", source: "Complete Works, Vol. 7: Inspired Talks (a disciple's record)" },
  { id: "q10", text: "Do one thing at a time and while doing it put your whole soul into it to the exclusion of all else.", source: "Complete Works, Vol. 6: Notes of Class Talks, On Raja-Yoga (students' notes)" },
];
// QUOTES:END

export type QuoteContext = "sessionStart" | "nudge" | "emptyFocus" | "receipt" | "emptyList";

const POOLS: Record<QuoteContext, readonly string[]> = {
  sessionStart: ["q1"],
  nudge: ["q9", "q2", "q3", "q10"],
  emptyFocus: ["q5"],
  receipt: ["q7"],
  emptyList: ["q3"],
};

/** Small, non-cryptographic string hash (FNV-1a, 32-bit). Exported for tests. */
export function hashSeed(seed: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Deterministic quote choice: the same context and seed always give the same quote. */
export function quoteFor(context: QuoteContext, seed?: string): Quote {
  const pool = POOLS[context];
  const id = pool[hashSeed(seed ?? "") % pool.length]!;
  return QUOTES.find((q) => q.id === id)!;
}
