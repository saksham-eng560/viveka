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

export type DashboardQuoteContext = "emptyDay" | "standupIdle";

const POOLS: Record<DashboardQuoteContext, readonly string[]> = {
  emptyDay: ["q5", "q6"],
  standupIdle: ["q7"],
};

/** Small deterministic non-crypto string hash (djb2, unsigned 32-bit). */
export function hashSeed(seed: string): number {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h * 33) ^ seed.charCodeAt(i)) >>> 0;
  return h;
}

export function quoteFor(context: DashboardQuoteContext, seed?: string): Quote {
  const pool = POOLS[context].map((id) => QUOTES.find((q) => q.id === id) as Quote);
  return pool[hashSeed(seed ?? "") % pool.length];
}
