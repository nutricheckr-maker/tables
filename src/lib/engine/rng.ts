/** Random source returning floats in [0, 1). Injected everywhere so tests are deterministic. */
export type Rng = () => number;

/** mulberry32: tiny, fast, seedable. */
export function seededRng(seed: number): Rng {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export const defaultRng: Rng = () => Math.random();

/** Pick an index with probability proportional to its weight; -1 if all weights are 0. */
export function weightedIndex(weights: readonly number[], rng: Rng): number {
  let total = 0;
  for (const w of weights) total += w > 0 ? w : 0;
  if (total <= 0) return -1;
  let r = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i] as number;
    if (w <= 0) continue;
    r -= w;
    if (r < 0) return i;
  }
  // Floating-point fallthrough: return the last positive weight.
  for (let i = weights.length - 1; i >= 0; i--) if ((weights[i] as number) > 0) return i;
  return -1;
}

export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j] as T, out[i] as T];
  }
  return out;
}

/** Draw up to n distinct items uniformly at random. */
export function sample<T>(items: readonly T[], n: number, rng: Rng): T[] {
  return shuffle(items, rng).slice(0, Math.max(0, n));
}
