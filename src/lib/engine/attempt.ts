import type { Settings } from "./config";
import { classifyError, effectiveMs, speedTarget } from "./evaluation";
import { schedule } from "./scheduler";
import type { ErrorKind, Fact, FactRecord } from "./types";

const HOUR = 3_600_000;

export interface AttemptInput {
  /** The submitted answer; null when the time limit expired first. */
  given: number | null;
  /** Raw elapsed time from question shown to submission. */
  ms: number;
  timedOut?: boolean;
  /** True when the smaller factor was shown first. */
  smallerFirst: boolean;
  sessionId: string;
  now: number;
}

export interface AttemptResult {
  ok: boolean;
  /** Correct and within the fact's speed target. */
  fast: boolean;
  ms: number | null;
  errorKind: ErrorKind | null;
  expected: number;
}

/**
 * Pure update of one fact's record from one answer.
 * Returns a new record; the input record is not mutated.
 */
export function applyAttempt(
  prev: FactRecord,
  fact: Fact,
  input: AttemptInput,
  settings: Settings,
): { record: FactRecord; result: AttemptResult } {
  const { now, sessionId } = input;
  const ok = !input.timedOut && input.given === fact.product;
  const ms = effectiveMs(input.ms, settings.practice);
  const fast = ok && ms !== null && ms <= speedTarget(fact, settings);
  const errorKind: ErrorKind | null = ok ? null : input.timedOut ? "timeout" : classifyError(prev, fact, input.given);

  const gapSincePrev = prev.lastPractisedAt === null ? 0 : now - prev.lastPractisedAt;
  const afterDelay = prev.lastPractisedAt !== null && gapSincePrev >= settings.mastery.retentionGapHours * HOUR;
  const spacedRecall = ok && afterDelay;

  const sched = schedule(
    prev.level,
    ok ? { ok: true, fast, firstAttempt: prev.attempts === 0 } : { ok: false, kind: errorKind as ErrorKind },
    now,
    settings.scheduler,
  );

  const isGap = errorKind === "gap" || errorKind === "unclassified";
  const record: FactRecord = {
    ...prev,
    attempts: prev.attempts + 1,
    correct: prev.correct + (ok ? 1 : 0),
    incorrect: prev.incorrect + (ok ? 0 : 1),
    recent: [...prev.recent, { at: now, ok, ms, sessionId }].slice(-settings.mastery.recentWindow),
    level: sched.level,
    dueAt: sched.dueAt,
    lastPractisedAt: now,
    correctSessions: prev.correctSessions + (ok && prev.lastCorrectSessionId !== sessionId ? 1 : 0),
    lastCorrectSessionId: ok ? sessionId : prev.lastCorrectSessionId,
    spacedSuccesses: isGap ? 0 : prev.spacedSuccesses + (spacedRecall ? 1 : 0),
    // Forgotten after a delay: a real miss on a learned fact, after the retention gap.
    lapses: prev.lapses + (isGap && prev.level >= 2 && afterDelay ? 1 : 0),
    slips: prev.slips + (errorKind === "slip" ? 1 : 0),
    gaps: prev.gaps + (errorKind === "gap" ? 1 : 0),
    orientation: {
      ab: prev.orientation.ab + (input.smallerFirst ? 1 : 0),
      ba: prev.orientation.ba + (input.smallerFirst ? 0 : 1),
    },
  };

  return { record, result: { ok, fast, ms, errorKind, expected: fact.product } };
}
