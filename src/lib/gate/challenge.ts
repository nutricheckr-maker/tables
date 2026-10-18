import { stageFacts } from "../engine/facts";
import { sample, type Rng } from "../engine/rng";
import type { Fact, StageId } from "../engine/types";
import { GATE } from "./policy";

export interface GateQuestion {
  left: number;
  right: number;
}

/** Server-side only: carries the answers. Never serialise this to the client. */
export interface Challenge {
  id: string;
  stage: StageId;
  /** Server wall-clock time the questions were issued. */
  startedAt: number;
  questions: GateQuestion[];
  answers: number[];
}

export interface GateResult {
  correct: number;
  total: number;
  elapsedMs: number;
  passed: boolean;
  /** Empty when passed. */
  reasons: string[];
  review: { left: number; right: number; given: number | null; answer: number; ok: boolean }[];
}

/**
 * The facts a challenge may use: only facts already introduced in the trainer
 * (practised at least once), within the unlocked stage. Trivial ×1 facts are
 * left out while there are enough others to fill a challenge.
 * Returns fewer than GATE.questions facts when too few have been introduced.
 */
export function gatePool(stage: StageId, introduced: ReadonlySet<string>): Fact[] {
  const known = stageFacts(stage).filter((f) => introduced.has(f.key));
  const nonTrivial = known.filter((f) => f.a >= GATE.minFactor);
  return nonTrivial.length >= GATE.questions ? nonTrivial : known;
}

/** Ten distinct facts from the pool, each shown in a random factor order. */
export function createChallenge(id: string, stage: StageId, pool: readonly Fact[], now: number, rng: Rng): Challenge {
  const facts = sample(pool, GATE.questions, rng);
  if (facts.length < GATE.questions) throw new Error("Not enough introduced facts for a challenge");
  const questions = facts.map((f) => (rng() < 0.5 ? { left: f.a, right: f.b } : { left: f.b, right: f.a }));
  return { id, stage, startedAt: now, questions, answers: facts.map((f) => f.product) };
}

/** Accept only whole non-negative numbers; anything else counts as unanswered. */
export function normaliseAnswers(raw: unknown, n: number): (number | null)[] {
  const list = Array.isArray(raw) ? raw : [];
  return Array.from({ length: n }, (_, i) => {
    const v = list[i];
    return typeof v === "number" && Number.isInteger(v) && v >= 0 && v < 1e6 ? v : null;
  });
}

/** Both conditions are inclusive: 8/10 passes, exactly 40.000 s passes. */
export function gradeChallenge(ch: Challenge, given: (number | null)[], submittedAt: number): GateResult {
  const review = ch.questions.map((q, i) => {
    const answer = ch.answers[i] as number;
    const g = given[i] ?? null;
    return { left: q.left, right: q.right, given: g, answer, ok: g === answer };
  });
  const correct = review.filter((r) => r.ok).length;
  const elapsedMs = Math.max(0, submittedAt - ch.startedAt);
  const reasons: string[] = [];
  if (correct < GATE.passCorrect) reasons.push(`${correct}/${ch.questions.length} correct — needs ${GATE.passCorrect}`);
  if (elapsedMs > GATE.timeLimitMs) {
    reasons.push(`${(elapsedMs / 1000).toFixed(1)} s — limit ${GATE.timeLimitMs / 1000} s`);
  }
  return { correct, total: ch.questions.length, elapsedMs, passed: reasons.length === 0, reasons, review };
}
