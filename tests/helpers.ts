import { applyAttempt } from "@/lib/engine/attempt";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/engine/config";
import { makeFact } from "@/lib/engine/facts";
import { emptyRecord } from "@/lib/engine/stats";
import type { Fact, FactRecord } from "@/lib/engine/types";

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;
export const T0 = Date.UTC(2026, 0, 1, 9);

export const settings = (): Settings => structuredClone(DEFAULT_SETTINGS);

export interface Step {
  ok: boolean;
  ms?: number;
  /** Time since the previous step (default 1 minute). */
  after?: number;
  session?: string;
  given?: number;
}

/** Replay a sequence of answers for one fact through the real engine. */
export function replay(fact: Fact, steps: Step[], s = settings(), start = T0): { record: FactRecord; now: number } {
  let rec = emptyRecord(fact.key);
  let now = start;
  steps.forEach((st, i) => {
    if (i > 0) now += st.after ?? 60_000;
    rec = applyAttempt(
      rec,
      fact,
      {
        given: st.ok ? fact.product : (st.given ?? fact.product + 1000),
        ms: st.ms ?? 1500,
        smallerFirst: i % 2 === 0,
        sessionId: st.session ?? `s${Math.floor((now - start) / DAY)}`,
        now,
      },
      s,
    ).record;
  });
  return { record: rec, now };
}

/** A history that satisfies every default mastery criterion. */
export function masteredSteps(): Step[] {
  return [
    { ok: true, session: "a" },
    { ok: true, session: "a" },
    { ok: true, after: DAY, session: "b" },
    { ok: true, session: "b" },
    { ok: true, after: DAY, session: "c" },
    { ok: true, session: "c" },
  ];
}

export function masteredRecord(fact: Fact, s = settings()): FactRecord {
  return replay(fact, masteredSteps(), s).record;
}

export const f = makeFact;
