/**
 * Core domain types for the multiplication engine.
 *
 * Everything here is plain serialisable data so the same shapes can be stored
 * in localStorage today and in PostgreSQL rows later.
 */

export type StageId = 1 | 2 | 3 | 4;

/** Canonical key for an unordered fact: smaller factor first, e.g. "7x12". */
export type FactKey = `${number}x${number}`;

export type Band = "easy" | "medium" | "hard";

export interface Fact {
  key: FactKey;
  /** Smaller factor. */
  a: number;
  /** Larger factor (or equal). */
  b: number;
  product: number;
  /** First stage whose range contains this fact. */
  homeStage: StageId;
  band: Band;
}

/** A question as shown: a fact plus the order its factors appear in. */
export interface Question {
  key: FactKey;
  left: number;
  right: number;
  product: number;
}

export type Mode = "focused" | "mixed" | "speed" | "weakness" | "assessment";

/**
 * slip         – an isolated miss on a fact with a strong recent record.
 * gap          – a miss that the history says is a real knowledge gap.
 * unclassified – too little history to tell; scheduled like a gap.
 * timeout      – an explicit time limit expired before an answer.
 */
export type ErrorKind = "slip" | "gap" | "unclassified" | "timeout";

export interface RecentAttempt {
  at: number;
  ok: boolean;
  /** Response time in ms; null when the user was idle past the idle cap. */
  ms: number | null;
  sessionId: string;
}

export interface FactRecord {
  key: FactKey;
  attempts: number;
  correct: number;
  incorrect: number;
  /** Newest last; trimmed to settings.mastery.recentWindow. */
  recent: RecentAttempt[];
  /** Spaced-repetition box (0 = learning). */
  level: number;
  /** Next recommended review time (epoch ms); null until first attempt. */
  dueAt: number | null;
  lastPractisedAt: number | null;
  /** Distinct sessions in which this fact was answered correctly. */
  correctSessions: number;
  lastCorrectSessionId: string | null;
  /** Correct recalls after a gap of at least retentionGapHours. Reset by a gap error. */
  spacedSuccesses: number;
  /** Gap errors on a learned fact (level >= 2) after the retention gap: forgotten after a delay. */
  lapses: number;
  slips: number;
  gaps: number;
  /** How often each orientation was asked: ab = smaller factor first. */
  orientation: { ab: number; ba: number };
}

export type FactStatus = "unpractised" | "developing" | "weak" | "mastered";
