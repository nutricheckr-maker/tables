import type { StageId } from "./types";

export interface StageConfig {
  id: StageId;
  /** Both factors range over 1..max. */
  max: number;
}

/** Stages are pure configuration: adding a stage means adding a row here. */
export const STAGES: readonly StageConfig[] = [
  { id: 1, max: 20 },
  { id: 2, max: 30 },
  { id: 3, max: 40 },
  { id: 4, max: 50 },
];

export const MAX_STAGE: StageId = 4;

export function stageConfig(id: StageId): StageConfig {
  const s = STAGES.find((x) => x.id === id);
  if (!s) throw new Error(`Unknown stage ${id}`);
  return s;
}

export function isStageId(v: unknown): v is StageId {
  return v === 1 || v === 2 || v === 3 || v === 4;
}

export interface Settings {
  mastery: {
    /** Minimum lifetime attempts before a fact can be mastered. */
    minAttempts: number;
    /** Required accuracy over the recent window (0..1). */
    accuracy: number;
    /** How many recent attempts are kept and judged. */
    recentWindow: number;
    /** Distinct sessions with a correct answer. */
    minCorrectSessions: number;
    /** Correct recalls after at least retentionGapHours since the previous attempt. */
    minSpacedSuccesses: number;
    retentionGapHours: number;
    /** Median correct response time target, by the fact's home stage. */
    speedTargetMs: Record<StageId, number>;
    /** Correct answers needed for the speed target to be judged. */
    minTimedSamples: number;
  };
  weak: {
    /** Misses within the last `window` attempts that make a fact weak. */
    misses: number;
    window: number;
    /** A fact is weak when its median correct time exceeds target × slowFactor. */
    slowFactor: number;
  };
  scheduler: {
    /** Review interval per level, in hours. Level 0 = immediate relearning. */
    intervalsHours: number[];
    /** Slow-but-correct answers cannot promote a fact beyond this level. */
    slowLevelCap: number;
    /** Questions to wait before re-asking a missed fact in the same session. */
    relearnAfter: number;
  };
  practice: {
    sessionLength: number;
    /** Max unpractised facts introduced per mixed session. */
    newPerSession: number;
    /** A fact is not repeated within this many questions (pool permitting). */
    minRepeatGap: number;
    /** Responses slower than this are treated as idle, not as slow recall. */
    idleCapMs: number;
    /** Delay before auto-advancing after a correct answer; 0 = immediate. */
    autoAdvanceMs: number;
    /** Retype the correct answer after a miss before moving on. */
    requireCorrection: boolean;
    /** Optional per-question limit for Speed Training only; null = off. */
    speedTimeLimitMs: number | null;
  };
  advancement: {
    /** Share of stage facts that must be mastered. */
    minMasteredShare: number;
    /** Share mastered required in every difficulty band (stops easy facts hiding hard ones). */
    minBandShare: number;
    maxWeak: number;
    maxOverdue: number;
    assessmentLength: number;
    assessmentAccuracy: number;
    assessmentBandAccuracy: number;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  mastery: {
    minAttempts: 6,
    accuracy: 0.95,
    recentWindow: 20,
    minCorrectSessions: 3,
    minSpacedSuccesses: 2,
    retentionGapHours: 20,
    speedTargetMs: { 1: 3000, 2: 4000, 3: 5000, 4: 6000 },
    minTimedSamples: 3,
  },
  weak: { misses: 2, window: 6, slowFactor: 2 },
  scheduler: {
    // learning, 10 min, 1 d, 3 d, 7 d, 16 d, 35 d, 75 d
    intervalsHours: [0, 1 / 6, 24, 72, 168, 384, 840, 1800],
    slowLevelCap: 3,
    relearnAfter: 3,
  },
  practice: {
    sessionLength: 40,
    newPerSession: 12,
    minRepeatGap: 4,
    idleCapMs: 60_000,
    autoAdvanceMs: 350,
    requireCorrection: true,
    speedTimeLimitMs: null,
  },
  advancement: {
    minMasteredShare: 0.9,
    minBandShare: 0.85,
    maxWeak: 0,
    maxOverdue: 10,
    assessmentLength: 60,
    assessmentAccuracy: 0.95,
    assessmentBandAccuracy: 0.9,
  },
};

type Bounds = [min: number, max: number, integer: boolean];

const NUMERIC_BOUNDS: Record<string, Bounds> = {
  "mastery.minAttempts": [1, 100, true],
  "mastery.accuracy": [0.5, 1, false],
  "mastery.recentWindow": [5, 50, true],
  "mastery.minCorrectSessions": [1, 20, true],
  "mastery.minSpacedSuccesses": [0, 10, true],
  "mastery.retentionGapHours": [1, 24 * 14, false],
  "mastery.minTimedSamples": [1, 20, true],
  "weak.misses": [1, 10, true],
  "weak.window": [2, 20, true],
  "weak.slowFactor": [1.2, 10, false],
  "scheduler.slowLevelCap": [1, 20, true],
  "scheduler.relearnAfter": [1, 20, true],
  "practice.sessionLength": [5, 500, true],
  "practice.newPerSession": [0, 100, true],
  "practice.minRepeatGap": [0, 20, true],
  "practice.idleCapMs": [5_000, 600_000, true],
  "practice.autoAdvanceMs": [0, 3_000, true],
  "advancement.minMasteredShare": [0.5, 1, false],
  "advancement.minBandShare": [0.5, 1, false],
  "advancement.maxWeak": [0, 100, true],
  "advancement.maxOverdue": [0, 1000, true],
  "advancement.assessmentLength": [20, 300, true],
  "advancement.assessmentAccuracy": [0.5, 1, false],
  "advancement.assessmentBandAccuracy": [0.5, 1, false],
};

export interface SettingsValidation {
  settings: Settings;
  errors: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Merge an untrusted partial settings object over the defaults.
 * Invalid values are replaced by the default and reported, never thrown.
 */
export function validateSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): SettingsValidation {
  const errors: string[] = [];
  const out: Settings = structuredClone(base);
  if (!isRecord(input)) {
    if (input !== undefined) errors.push("settings: expected an object");
    return { settings: out, errors };
  }

  for (const [path, [min, max, integer]] of Object.entries(NUMERIC_BOUNDS)) {
    const [group, field] = path.split(".") as [keyof Settings, string];
    const src = input[group];
    if (!isRecord(src) || !(field in src)) continue;
    const v = src[field];
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
      errors.push(`${path}: must be ${integer ? "an integer" : "a number"} between ${min} and ${max}`);
      continue;
    }
    (out[group] as unknown as Record<string, number>)[field] = v;
  }

  const m = input.mastery;
  if (isRecord(m) && isRecord(m.speedTargetMs)) {
    for (const s of STAGES) {
      const v = m.speedTargetMs[s.id];
      if (v === undefined) continue;
      if (typeof v === "number" && Number.isInteger(v) && v >= 500 && v <= 60_000) out.mastery.speedTargetMs[s.id] = v;
      else errors.push(`mastery.speedTargetMs.${s.id}: must be an integer between 500 and 60000`);
    }
  }

  const sch = input.scheduler;
  if (isRecord(sch) && "intervalsHours" in sch) {
    const iv = sch.intervalsHours;
    const ok =
      Array.isArray(iv) &&
      iv.length >= 3 &&
      iv.length <= 20 &&
      iv.every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0) &&
      iv.every((x, i) => i === 0 || x >= (iv[i - 1] as number));
    if (ok) out.scheduler.intervalsHours = [...(iv as number[])];
    else errors.push("scheduler.intervalsHours: must be 3–20 non-decreasing, non-negative numbers");
  }

  const p = input.practice;
  if (isRecord(p)) {
    if ("requireCorrection" in p) {
      if (typeof p.requireCorrection === "boolean") out.practice.requireCorrection = p.requireCorrection;
      else errors.push("practice.requireCorrection: must be true or false");
    }
    if ("speedTimeLimitMs" in p) {
      const v = p.speedTimeLimitMs;
      if (v === null || (typeof v === "number" && Number.isInteger(v) && v >= 1000 && v <= 60_000)) {
        out.practice.speedTimeLimitMs = v;
      } else errors.push("practice.speedTimeLimitMs: must be off or an integer between 1000 and 60000");
    }
  }

  if (out.weak.misses > out.weak.window) {
    errors.push("weak.misses: cannot exceed weak.window");
    out.weak.misses = base.weak.misses;
    out.weak.window = Math.max(base.weak.window, out.weak.misses);
  }
  out.scheduler.slowLevelCap = Math.min(out.scheduler.slowLevelCap, out.scheduler.intervalsHours.length - 1);

  return { settings: out, errors };
}
