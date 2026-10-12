import type { FactKey, FactRecord, RecentAttempt } from "./types";

export function emptyRecord(key: FactKey): FactRecord {
  return {
    key,
    attempts: 0,
    correct: 0,
    incorrect: 0,
    recent: [],
    level: 0,
    dueAt: null,
    lastPractisedAt: null,
    correctSessions: 0,
    lastCorrectSessionId: null,
    spacedSuccesses: 0,
    lapses: 0,
    slips: 0,
    gaps: 0,
    orientation: { ab: 0, ba: 0 },
  };
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((x, y) => x + y, 0) / values.length;
}

/** Accuracy over the last `n` attempts (all kept attempts when n is omitted); null if none. */
export function recentAccuracy(rec: FactRecord, n?: number): number | null {
  const slice = n === undefined ? rec.recent : rec.recent.slice(-n);
  if (slice.length === 0) return null;
  return slice.filter((r) => r.ok).length / slice.length;
}

export function missesInLast(rec: FactRecord, n: number): number {
  return rec.recent.slice(-n).filter((r) => !r.ok).length;
}

/** Timed correct responses only: wrong answers and idle-capped answers say nothing about recall speed. */
export function correctTimes(recent: readonly RecentAttempt[]): number[] {
  return recent.filter((r) => r.ok && r.ms !== null).map((r) => r.ms as number);
}

/** "Typical response time": median of recent timed correct answers. */
export function typicalMs(rec: FactRecord): number | null {
  return median(correctTimes(rec.recent));
}

export function lastAttempt(rec: FactRecord): RecentAttempt | undefined {
  return rec.recent[rec.recent.length - 1];
}
