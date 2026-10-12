import type { Settings } from "./config";
import type { ErrorKind } from "./types";

const HOUR = 3_600_000;

export type Outcome =
  | { ok: true; fast: boolean; firstAttempt: boolean }
  | { ok: false; kind: ErrorKind };

export interface ScheduleResult {
  level: number;
  dueAt: number;
}

/**
 * Leitner-style spaced repetition with fixed, configurable intervals.
 *
 *  correct + fast      → level + 1 (a first-ever fast answer jumps to level 2: you already knew it)
 *  correct + slow      → level + 1, but never above slowLevelCap, so slow facts keep returning
 *  slip / timeout      → level − 1 (min 1), review after intervals[1]
 *  gap / unclassified  → level 0, due immediately (relearn)
 *
 * The next review time is always now + intervals[newLevel].
 */
export function schedule(level: number, outcome: Outcome, now: number, s: Settings["scheduler"]): ScheduleResult {
  const top = s.intervalsHours.length - 1;
  let next: number;
  if (outcome.ok) {
    if (outcome.fast) next = outcome.firstAttempt ? Math.max(2, level + 1) : level + 1;
    else next = level >= s.slowLevelCap ? level : Math.min(level + 1, s.slowLevelCap);
  } else if (outcome.kind === "slip" || outcome.kind === "timeout") {
    next = Math.max(1, level - 1);
  } else {
    next = 0;
  }
  next = Math.max(0, Math.min(top, next));
  return { level: next, dueAt: now + (s.intervalsHours[next] as number) * HOUR };
}

export function intervalMs(level: number, s: Settings["scheduler"]): number {
  const iv = s.intervalsHours;
  return (iv[Math.max(0, Math.min(iv.length - 1, level))] as number) * HOUR;
}

export function isDue(dueAt: number | null, now: number): boolean {
  return dueAt !== null && dueAt <= now;
}
