import { STAGES, stageConfig } from "./config";
import type { Band, Fact, FactKey, Question, StageId } from "./types";

export function factKey(x: number, y: number): FactKey {
  const a = Math.min(x, y);
  const b = Math.max(x, y);
  return `${a}x${b}`;
}

export function parseFactKey(key: string): { a: number; b: number } | null {
  const m = /^(\d{1,3})x(\d{1,3})$/.exec(key);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a < 1 || a > b) return null;
  return { a, b };
}

export function homeStageOf(maxFactor: number): StageId {
  const s = STAGES.find((st) => maxFactor <= st.max);
  if (!s) throw new Error(`Factor ${maxFactor} is outside every stage`);
  return s.id;
}

/**
 * Difficulty band, deterministic and documented:
 *  easy   – a "trick" factor (1, 2, 10, multiples of 10, or 11 with a single digit), or both factors ≤ 10.
 *  hard   – both factors ≥ 13 and no trick factor.
 *  medium – everything else.
 */
export function bandOf(a: number, b: number): Band {
  const trick = (x: number, other: number) => x === 1 || x === 2 || x % 10 === 0 || (x === 11 && other <= 9);
  if (trick(a, b) || trick(b, a) || b <= 10) return "easy";
  if (a >= 13) return "hard";
  return "medium";
}

const BAND_RANK: Record<Band, number> = { easy: 0, medium: 1, hard: 2 };

export function makeFact(x: number, y: number): Fact {
  const a = Math.min(x, y);
  const b = Math.max(x, y);
  if (!Number.isInteger(a) || a < 1) throw new Error(`Invalid factor ${x}×${y}`);
  return { key: factKey(a, b), a, b, product: a * b, homeStage: homeStageOf(b), band: bandOf(a, b) };
}

const cache = new Map<number, Fact[]>();

/** All unordered facts with both factors in 1..max, in learning order. */
export function factsUpTo(max: number): Fact[] {
  const hit = cache.get(max);
  if (hit) return hit;
  const out: Fact[] = [];
  for (let b = 1; b <= max; b++) for (let a = 1; a <= b; a++) out.push(makeFact(a, b));
  out.sort(compareLearningOrder);
  cache.set(max, out);
  return out;
}

export function stageFacts(stage: StageId): Fact[] {
  return factsUpTo(stageConfig(stage).max);
}

/** Facts first introduced in this stage (not present in the previous one). */
export function newFactsInStage(stage: StageId): Fact[] {
  return stageFacts(stage).filter((f) => f.homeStage === stage);
}

/** Introduce earlier stages first, then easier bands, then smaller factors. */
export function compareLearningOrder(x: Fact, y: Fact): number {
  return x.homeStage - y.homeStage || BAND_RANK[x.band] - BAND_RANK[y.band] || x.b - y.b || x.a - y.a;
}

export function factByKey(key: FactKey): Fact {
  const p = parseFactKey(key);
  if (!p) throw new Error(`Invalid fact key ${key}`);
  return makeFact(p.a, p.b);
}

export interface FactFilter {
  /** Facts containing this factor (a "times table"). */
  table?: number;
  /** Facts whose factors both lie in [min, max]. */
  range?: { min: number; max: number };
  band?: Band;
}

export function filterFacts(facts: Fact[], filter: FactFilter): Fact[] {
  return facts.filter((f) => {
    if (filter.table !== undefined && f.a !== filter.table && f.b !== filter.table) return false;
    if (filter.range && (f.a < filter.range.min || f.b > filter.range.max)) return false;
    if (filter.band && f.band !== filter.band) return false;
    return true;
  });
}

export function toQuestion(fact: Fact, smallerFirst: boolean): Question {
  return smallerFirst
    ? { key: fact.key, left: fact.a, right: fact.b, product: fact.product }
    : { key: fact.key, left: fact.b, right: fact.a, product: fact.product };
}
