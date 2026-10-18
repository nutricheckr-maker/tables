import type { AssessmentRecord } from "../engine/advancement";
import { DEFAULT_SETTINGS, isStageId, validateSettings, type Settings } from "../engine/config";
import { parseFactKey } from "../engine/facts";
import type { Records } from "../engine/selection";
import type { SessionSummary } from "../engine/session";
import type { FactKey, FactRecord, Mode, RecentAttempt, StageId } from "../engine/types";

export const SCHEMA_VERSION = 1;
export const MAX_SESSIONS = 1000;
export const MAX_ASSESSMENTS = 100;

/**
 * The whole persisted state. Each top-level collection maps to a future SQL table:
 * facts → fact_records (PK key), sessions → sessions, assessments → assessments,
 * settings/progress → a single-row profile table.
 */
export interface AppState {
  version: typeof SCHEMA_VERSION;
  settings: Settings;
  progress: {
    /** Highest stage unlocked. */
    unlockedStage: StageId;
  };
  facts: Records;
  sessions: SessionSummary[];
  assessments: AssessmentRecord[];
}

export function initialState(): AppState {
  return {
    version: SCHEMA_VERSION,
    settings: structuredClone(DEFAULT_SETTINGS),
    progress: { unlockedStage: 1 },
    facts: {},
    sessions: [],
    assessments: [],
  };
}

const MODES: readonly Mode[] = ["focused", "mixed", "speed", "weakness", "assessment", "gate"];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isNat = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;
const isNumOrNull = (v: unknown): v is number | null => v === null || isNum(v);

function validRecent(v: unknown): v is RecentAttempt {
  return isObj(v) && isNum(v.at) && typeof v.ok === "boolean" && isNumOrNull(v.ms) && typeof v.sessionId === "string";
}

export function validateFactRecord(key: string, v: unknown): FactRecord | null {
  if (!parseFactKey(key) || !isObj(v) || v.key !== key) return null;
  const nats = ["attempts", "correct", "incorrect", "level", "correctSessions", "spacedSuccesses", "lapses", "slips", "gaps"];
  if (!nats.every((k) => isNat(v[k]))) return null;
  if (!isNumOrNull(v.dueAt) || !isNumOrNull(v.lastPractisedAt)) return null;
  if (!(v.lastCorrectSessionId === null || typeof v.lastCorrectSessionId === "string")) return null;
  if (!Array.isArray(v.recent) || !v.recent.every(validRecent)) return null;
  if (!isObj(v.orientation) || !isNat(v.orientation.ab) || !isNat(v.orientation.ba)) return null;
  if ((v.correct as number) + (v.incorrect as number) !== v.attempts) return null;
  return v as unknown as FactRecord;
}

function validSession(v: unknown): v is SessionSummary {
  return (
    isObj(v) &&
    typeof v.id === "string" &&
    MODES.includes(v.mode as Mode) &&
    isStageId(v.stage) &&
    isNum(v.startedAt) &&
    isNum(v.endedAt) &&
    isNat(v.questions) &&
    isNat(v.correct) &&
    isNumOrNull(v.medianMs) &&
    isNumOrNull(v.meanMs)
  );
}

function validAssessment(v: unknown): v is AssessmentRecord {
  return (
    isObj(v) &&
    typeof v.id === "string" &&
    isStageId(v.stage) &&
    isNum(v.at) &&
    isNat(v.questions) &&
    isNat(v.correct) &&
    isNum(v.accuracy) &&
    isObj(v.bandAccuracy) &&
    isNumOrNull(v.medianMs) &&
    typeof v.passed === "boolean" &&
    typeof v.qualified === "boolean" &&
    Array.isArray(v.failures)
  );
}

export type ParseResult = { ok: true; state: AppState; warnings: string[] } | { ok: false; error: string };

/** Migrations keyed by the version they upgrade *from*. Empty until the schema changes. */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

/**
 * Validate untrusted stored or imported data. Structurally broken input is
 * rejected; individually corrupt records are dropped with a warning so one bad
 * row never loses the rest of the user's progress.
 */
export function parseState(raw: unknown): ParseResult {
  if (!isObj(raw)) return { ok: false, error: "Not a progress object" };
  let data = raw;
  if (!isNat(data.version)) return { ok: false, error: "Missing schema version" };
  let version: number = data.version;
  if (version > SCHEMA_VERSION) return { ok: false, error: `Saved with a newer app version (schema ${version})` };
  while (version < SCHEMA_VERSION) {
    const m = MIGRATIONS[version];
    if (!m) return { ok: false, error: `No migration from schema ${version}` };
    data = m(data);
    if (!isNat(data.version) || data.version <= version) return { ok: false, error: `Migration from ${version} failed` };
    version = data.version;
  }

  const warnings: string[] = [];
  const { settings, errors } = validateSettings(data.settings);
  warnings.push(...errors);

  const progress = isObj(data.progress) && isStageId(data.progress.unlockedStage) ? data.progress.unlockedStage : 1;

  const facts: Records = {};
  if (isObj(data.facts)) {
    for (const [k, v] of Object.entries(data.facts)) {
      const rec = validateFactRecord(k, v);
      if (rec) facts[k as FactKey] = rec;
      else warnings.push(`Dropped corrupt record for ${k}`);
    }
  }

  const sessions = Array.isArray(data.sessions) ? data.sessions.filter(validSession) : [];
  const assessments = Array.isArray(data.assessments) ? data.assessments.filter(validAssessment) : [];
  if (Array.isArray(data.sessions) && sessions.length !== data.sessions.length) warnings.push("Dropped corrupt sessions");
  if (Array.isArray(data.assessments) && assessments.length !== data.assessments.length) {
    warnings.push("Dropped corrupt assessments");
  }

  return {
    ok: true,
    warnings,
    state: {
      version: SCHEMA_VERSION,
      settings,
      progress: { unlockedStage: progress },
      facts,
      sessions: sessions.slice(-MAX_SESSIONS),
      assessments: assessments.slice(-MAX_ASSESSMENTS),
    },
  };
}
