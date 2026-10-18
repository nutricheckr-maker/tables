import type { Settings } from "./config";
import { speedTarget } from "./evaluation";
import { factStatus } from "./mastery";
import { weightedIndex, type Rng } from "./rng";
import { intervalMs, isDue } from "./scheduler";
import { correctTimes, median } from "./stats";
import type { Fact, FactKey, FactRecord, Mode } from "./types";

export type Records = Partial<Record<FactKey, FactRecord>>;
export type PracticeMode = Exclude<Mode, "assessment" | "gate">;

export type SelectionReason = "relearn" | "weak" | "due" | "new" | "slow" | "review";

export interface RelearnItem {
  key: FactKey;
  /** Question index from which the fact may be re-asked. */
  at: number;
}

export interface SelectionInput {
  mode: PracticeMode;
  /** Eligible facts for this session (mode filters already applied). */
  pool: readonly Fact[];
  records: Records;
  settings: Settings;
  now: number;
  /** Keys asked so far this session, oldest first. */
  history: readonly FactKey[];
  relearn: readonly RelearnItem[];
  newIntroduced: number;
  rng: Rng;
}

export interface Selection {
  fact: Fact;
  reason: SelectionReason;
}

/** How many unpractised facts (in learning order) are candidates at once. */
export const NEW_FRONTIER = 5;
const HOUR = 3_600_000;

interface ModeWeights {
  weak: number;
  due: number;
  newFact: number;
  developing: number;
  mastered: number;
  /** Extra weight per unit of (median time / target − 1), capped. */
  slow: number;
  newLimited: boolean;
}

/** The whole scheduling policy per mode, in one inspectable table. */
export const MODE_WEIGHTS: Record<PracticeMode, ModeWeights> = {
  mixed: { weak: 8, due: 4, newFact: 3, developing: 0.6, mastered: 0.1, slow: 1, newLimited: true },
  focused: { weak: 8, due: 4, newFact: 3, developing: 1.5, mastered: 0.4, slow: 1, newLimited: false },
  speed: { weak: 3, due: 1.5, newFact: 0, developing: 1, mastered: 1, slow: 2, newLimited: true },
  weakness: { weak: 8, due: 3, newFact: 0, developing: 0, mastered: 0, slow: 2, newLimited: true },
};

export interface Priority {
  weight: number;
  reason: SelectionReason;
}

/** Selection weight for one fact. Pure; exported for tests and for explaining the scheduler. */
export function priority(
  fact: Fact,
  rec: FactRecord | undefined,
  mode: PracticeMode,
  settings: Settings,
  now: number,
  newAllowed: boolean,
): Priority {
  const w = MODE_WEIGHTS[mode];
  const status = factStatus(rec, fact, settings);
  if (status === "unpractised" || !rec) {
    return { weight: newAllowed ? w.newFact : 0, reason: "new" };
  }

  const med = median(correctTimes(rec.recent));
  const slowRatio = med === null ? 0 : Math.min(3, Math.max(0, med / speedTarget(fact, settings) - 1));

  if (status === "weak") return { weight: w.weak + slowRatio * w.slow, reason: "weak" };

  if (isDue(rec.dueAt, now)) {
    const overdue = (now - (rec.dueAt as number)) / Math.max(intervalMs(rec.level, settings.scheduler), HOUR);
    const weight = mode === "weakness" && status === "mastered" ? 0 : w.due + Math.min(4, overdue * 2);
    return { weight, reason: "due" };
  }

  if (slowRatio > 0 && w.slow > 0 && (mode === "speed" || mode === "weakness")) {
    return { weight: (status === "mastered" ? w.mastered : w.developing) + slowRatio * w.slow, reason: "slow" };
  }

  return { weight: status === "mastered" ? w.mastered : w.developing, reason: "review" };
}

/**
 * Choose the next fact.
 *
 * 1. A missed fact whose relearn slot has arrived is asked first.
 * 2. Otherwise every fact in the pool gets a priority weight (see MODE_WEIGHTS),
 *    facts asked in the last `minRepeatGap` questions are excluded,
 *    and one fact is drawn with probability proportional to its weight.
 *
 * Returns null when nothing in the pool currently needs practice in this mode.
 */
export function selectNext(input: SelectionInput): Selection | null {
  const { pool, records, settings, now, history, mode, rng } = input;
  if (pool.length === 0) return null;
  const lastKey = history[history.length - 1];

  const poolKeys = new Set(pool.map((f) => f.key));
  const due = input.relearn
    .filter((r) => r.at <= history.length && r.key !== lastKey && poolKeys.has(r.key))
    .sort((x, y) => x.at - y.at)[0];
  if (due) {
    const fact = pool.find((f) => f.key === due.key) as Fact;
    return { fact, reason: "relearn" };
  }

  const w = MODE_WEIGHTS[mode];
  const newBudgetLeft = !w.newLimited || input.newIntroduced < settings.practice.newPerSession;
  const frontier = new Set<FactKey>();
  if (w.newFact > 0 && newBudgetLeft) {
    for (const f of pool) {
      if ((records[f.key]?.attempts ?? 0) === 0) frontier.add(f.key);
      if (frontier.size >= NEW_FRONTIER) break;
    }
  }

  const scored = pool.map((f) => ({ f, p: priority(f, records[f.key], mode, settings, now, frontier.has(f.key)) }));
  const candidates = scored.filter((x) => x.p.weight > 0);
  if (candidates.length === 0) return null;

  // Exclude recent repeats, shrinking the gap if the candidate set is small.
  const gap = Math.min(settings.practice.minRepeatGap, candidates.length - 1);
  const recent = new Set(history.slice(history.length - gap));
  const eligible = gap > 0 ? candidates.filter((x) => !recent.has(x.f.key)) : candidates;

  const i = weightedIndex(
    eligible.map((x) => x.p.weight),
    rng,
  );
  if (i < 0) return null;
  const pick = eligible[i] as (typeof eligible)[number];
  return { fact: pick.f, reason: pick.p.reason };
}

/** Prefer the orientation seen less often; squares have only one. */
export function chooseSmallerFirst(fact: Fact, rec: FactRecord | undefined, rng: Rng): boolean {
  if (fact.a === fact.b) return true;
  const ab = rec?.orientation.ab ?? 0;
  const ba = rec?.orientation.ba ?? 0;
  return rng() < (ba + 1) / (ab + ba + 2);
}
