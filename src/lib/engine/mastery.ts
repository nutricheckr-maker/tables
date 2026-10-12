import type { Settings } from "./config";
import { speedTarget } from "./evaluation";
import { correctTimes, lastAttempt, median, missesInLast, recentAccuracy } from "./stats";
import type { Fact, FactRecord, FactStatus } from "./types";

export type WeakReason = "misses" | "lapse" | "slow";

/** Why a fact is weak; empty when it is not. */
export function weakReasons(rec: FactRecord | undefined, fact: Fact, s: Settings): WeakReason[] {
  if (!rec || rec.attempts === 0) return [];
  const out: WeakReason[] = [];
  if (missesInLast(rec, s.weak.window) >= s.weak.misses) out.push("misses");
  // Forgotten after having been learned, and not yet re-established by a correct answer.
  const last = lastAttempt(rec);
  if (last && !last.ok && rec.lapses > 0 && rec.level <= 1) out.push("lapse");
  const times = correctTimes(rec.recent);
  const med = median(times);
  if (times.length >= s.mastery.minTimedSamples && med !== null && med > speedTarget(fact, s) * s.weak.slowFactor) {
    out.push("slow");
  }
  return out;
}

export interface MasteryCheck {
  attempts: boolean;
  accuracy: boolean;
  lastCorrect: boolean;
  sessions: boolean;
  spaced: boolean;
  speed: boolean;
}

/** Each mastery criterion individually, so the UI can show exactly what is missing. */
export function masteryChecks(rec: FactRecord | undefined, fact: Fact, s: Settings): MasteryCheck {
  if (!rec || rec.attempts === 0) {
    return { attempts: false, accuracy: false, lastCorrect: false, sessions: false, spaced: false, speed: false };
  }
  const m = s.mastery;
  const times = correctTimes(rec.recent);
  const med = median(times);
  return {
    attempts: rec.attempts >= m.minAttempts,
    accuracy: (recentAccuracy(rec) ?? 0) >= m.accuracy,
    lastCorrect: lastAttempt(rec)?.ok === true,
    sessions: rec.correctSessions >= m.minCorrectSessions,
    spaced: rec.spacedSuccesses >= m.minSpacedSuccesses,
    speed: times.length >= m.minTimedSamples && med !== null && med <= speedTarget(fact, s),
  };
}

/**
 * Status precedence: unpractised → weak → mastered → developing.
 * Weak always wins over mastered, so one old success can't hide a current problem.
 */
export function factStatus(rec: FactRecord | undefined, fact: Fact, s: Settings): FactStatus {
  if (!rec || rec.attempts === 0) return "unpractised";
  if (weakReasons(rec, fact, s).length > 0) return "weak";
  const c = masteryChecks(rec, fact, s);
  if (c.attempts && c.accuracy && c.lastCorrect && c.sessions && c.spaced && c.speed) return "mastered";
  return "developing";
}

/** Higher = weaker. Used to rank the "weakest facts" list. */
export function weaknessScore(rec: FactRecord | undefined, fact: Fact, s: Settings): number {
  if (!rec || rec.attempts === 0) return 0;
  const acc = recentAccuracy(rec, s.weak.window) ?? 1;
  const med = median(correctTimes(rec.recent));
  const slowRatio = med === null ? 0 : Math.max(0, med / speedTarget(fact, s) - 1);
  return (1 - acc) * 3 + Math.min(slowRatio, 3) + rec.lapses * 0.3 + (lastAttempt(rec)?.ok ? 0 : 0.5);
}
