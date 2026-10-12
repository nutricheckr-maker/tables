import type { Settings } from "./config";
import { stageFacts } from "./facts";
import { factStatus, weakReasons, weaknessScore, type WeakReason } from "./mastery";
import { isDue } from "./scheduler";
import type { Records } from "./selection";
import type { SessionSummary } from "./session";
import { correctTimes, mean, median, recentAccuracy, typicalMs } from "./stats";
import type { Fact, FactStatus, StageId } from "./types";

export interface DayPoint {
  /** Local date, YYYY-MM-DD. */
  day: string;
  questions: number;
  correct: number;
  accuracy: number;
}

export function localDay(ts: number): string {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Accuracy per day, oldest first, last `days` days that had practice. */
export function accuracyByDay(sessions: readonly SessionSummary[], days = 30): DayPoint[] {
  const by = new Map<string, { q: number; c: number }>();
  for (const s of sessions) {
    if (s.questions === 0) continue;
    const k = localDay(s.startedAt);
    const cur = by.get(k) ?? { q: 0, c: 0 };
    cur.q += s.questions;
    cur.c += s.correct;
    by.set(k, cur);
  }
  return [...by.entries()]
    .sort(([x], [y]) => (x < y ? -1 : 1))
    .slice(-days)
    .map(([day, v]) => ({ day, questions: v.q, correct: v.c, accuracy: v.c / v.q }));
}

export interface FactRow {
  fact: Fact;
  status: FactStatus;
  attempts: number;
  accuracy: number | null;
  typicalMs: number | null;
  reasons: WeakReason[];
  score: number;
}

export interface Overview {
  stage: StageId;
  total: number;
  counts: Record<FactStatus, number>;
  practised: number;
  due: number;
  meanMs: number | null;
  medianMs: number | null;
  weakest: FactRow[];
}

export function overview(stage: StageId, records: Records, settings: Settings, now: number, weakestN = 10): Overview {
  const facts = stageFacts(stage);
  const counts: Record<FactStatus, number> = { unpractised: 0, developing: 0, weak: 0, mastered: 0 };
  const allTimes: number[] = [];
  const rows: FactRow[] = [];
  let due = 0;
  for (const f of facts) {
    const rec = records[f.key];
    const status = factStatus(rec, f, settings);
    counts[status]++;
    if (!rec || rec.attempts === 0) continue;
    if (isDue(rec.dueAt, now)) due++;
    allTimes.push(...correctTimes(rec.recent));
    rows.push({
      fact: f,
      status,
      attempts: rec.attempts,
      accuracy: recentAccuracy(rec),
      typicalMs: typicalMs(rec),
      reasons: weakReasons(rec, f, settings),
      score: weaknessScore(rec, f, settings),
    });
  }
  rows.sort((x, y) => y.score - x.score || x.fact.product - y.fact.product);
  return {
    stage,
    total: facts.length,
    counts,
    practised: facts.length - counts.unpractised,
    due,
    meanMs: mean(allTimes),
    medianMs: median(allTimes),
    weakest: rows.filter((r) => r.score > 0).slice(0, weakestN),
  };
}
