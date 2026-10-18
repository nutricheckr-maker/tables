import type { Records } from "../engine/selection";
import type { FactKey, FactRecord } from "../engine/types";
import { MAX_ASSESSMENTS, MAX_SESSIONS, type AppState } from "./schema";

/**
 * Progress only ever grows, so two copies can be merged without conflicts:
 *  - a fact keeps the record with more attempts (ties: the later practice wins),
 *  - sessions and assessments are unioned by id,
 *  - the unlocked stage is the higher of the two,
 *  - settings come from `primary` (the copy being written, or the server on load).
 * Used by the server when saving and by the browser when loading.
 */
export function mergeStates(primary: AppState, other: AppState): AppState {
  const facts: Records = { ...other.facts };
  for (const [k, rec] of Object.entries(primary.facts) as [FactKey, FactRecord][]) {
    facts[k] = newer(rec, facts[k]);
  }
  return {
    version: primary.version,
    settings: primary.settings,
    progress: {
      unlockedStage: Math.max(primary.progress.unlockedStage, other.progress.unlockedStage) as AppState["progress"]["unlockedStage"],
    },
    facts,
    sessions: unionById(primary.sessions, other.sessions, (s) => s.startedAt).slice(-MAX_SESSIONS),
    assessments: unionById(primary.assessments, other.assessments, (a) => a.at).slice(-MAX_ASSESSMENTS),
  };
}

function newer(a: FactRecord, b: FactRecord | undefined): FactRecord {
  if (!b) return a;
  if (a.attempts !== b.attempts) return a.attempts > b.attempts ? a : b;
  return (a.lastPractisedAt ?? 0) >= (b.lastPractisedAt ?? 0) ? a : b;
}

function unionById<T extends { id: string }>(a: readonly T[], b: readonly T[], time: (x: T) => number): T[] {
  const byId = new Map<string, T>();
  for (const x of b) byId.set(x.id, x);
  for (const x of a) byId.set(x.id, x);
  return [...byId.values()].sort((x, y) => time(x) - time(y));
}

/** Facts whose record object changed between two snapshots (records are replaced, never mutated). */
export function changedFacts(next: AppState, prev: AppState | null): Records {
  if (!prev) return next.facts;
  const out: Records = {};
  for (const [k, rec] of Object.entries(next.facts) as [FactKey, FactRecord][]) {
    if (prev.facts[k] !== rec) out[k] = rec;
  }
  return out;
}

/** Keys of facts that have been practised at least once. */
export function introducedKeys(state: AppState): FactKey[] {
  return (Object.values(state.facts) as FactRecord[]).filter((r) => r.attempts > 0).map((r) => r.key);
}
