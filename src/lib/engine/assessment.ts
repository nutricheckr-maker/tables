import type { Settings } from "./config";
import { stageFacts } from "./facts";
import { factStatus } from "./mastery";
import { sample, shuffle, type Rng } from "./rng";
import type { Records } from "./selection";
import { median } from "./stats";
import type { Band, Fact, StageId } from "./types";

/** Target share of non-weak questions per band. Hard facts are over-represented on purpose. */
export const BAND_QUOTA: Record<Band, number> = { easy: 0.2, medium: 0.35, hard: 0.45 };
const WEAK_SHARE = 0.25;
const PRIOR_SHARE = 0.1;
const NEW_RANGE_SHARE = 0.5;

/**
 * Build a stratified assessment so a pile of easy facts cannot carry the score:
 *  - every weak fact (up to 25% of the test),
 *  - ~10% from earlier stages (retention check), for stage ≥ 2,
 *  - the rest split 20/35/45 across easy/medium/hard, with at least half drawn from
 *    facts new to this stage where available.
 * No fact appears twice. Order is shuffled.
 */
export function buildAssessment(stage: StageId, records: Records, settings: Settings, rng: Rng): Fact[] {
  const all = stageFacts(stage);
  const n = Math.min(settings.advancement.assessmentLength, all.length);
  const chosen = new Map<string, Fact>();
  const take = (facts: Fact[], k: number) => {
    for (const f of sample(
      facts.filter((x) => !chosen.has(x.key)),
      k,
      rng,
    )) {
      if (chosen.size >= n) break;
      chosen.set(f.key, f);
    }
  };

  const weak = all.filter((f) => factStatus(records[f.key], f, settings) === "weak");
  take(weak, Math.floor(n * WEAK_SHARE));

  if (stage > 1) {
    take(
      all.filter((f) => f.homeStage < stage),
      Math.round(n * PRIOR_SHARE),
    );
  }

  const remaining = n - chosen.size;
  for (const band of ["hard", "medium", "easy"] as Band[]) {
    const quota = Math.round(remaining * BAND_QUOTA[band]);
    const inBand = all.filter((f) => f.band === band);
    const fresh = inBand.filter((f) => f.homeStage === stage);
    const before = chosen.size;
    if (stage > 1) take(fresh, Math.ceil(quota * NEW_RANGE_SHARE));
    take(inBand, quota - (chosen.size - before));
  }
  // Top up if a band pool was too small.
  take(all, n - chosen.size);

  return shuffle([...chosen.values()], rng);
}

export interface AssessmentAnswer {
  fact: Fact;
  ok: boolean;
  ms: number | null;
}

export interface AssessmentOutcome {
  questions: number;
  correct: number;
  accuracy: number;
  bandAccuracy: Partial<Record<Band, number>>;
  medianMs: number | null;
  passed: boolean;
  /** Human-readable reasons for failing; empty when passed. */
  failures: string[];
}

/** Bands with fewer questions than this are not judged on their own. */
const MIN_BAND_QUESTIONS = 5;

export function evaluateAssessment(
  stage: StageId,
  answers: readonly AssessmentAnswer[],
  settings: Settings,
): AssessmentOutcome {
  const a = settings.advancement;
  const correct = answers.filter((x) => x.ok).length;
  const accuracy = answers.length ? correct / answers.length : 0;
  const bandAccuracy: Partial<Record<Band, number>> = {};
  const failures: string[] = [];

  for (const band of ["easy", "medium", "hard"] as Band[]) {
    const inBand = answers.filter((x) => x.fact.band === band);
    if (inBand.length === 0) continue;
    const acc = inBand.filter((x) => x.ok).length / inBand.length;
    bandAccuracy[band] = acc;
    if (inBand.length >= MIN_BAND_QUESTIONS && acc < a.assessmentBandAccuracy) {
      failures.push(`${band} facts: ${pct(acc)} (needs ${pct(a.assessmentBandAccuracy)})`);
    }
  }

  const times = answers.filter((x) => x.ok && x.ms !== null).map((x) => x.ms as number);
  const medianMs = median(times);
  const target = settings.mastery.speedTargetMs[stage];

  const minQuestions = Math.min(a.assessmentLength, stageFacts(stage).length);
  if (answers.length < minQuestions) failures.unshift(`Incomplete: ${answers.length}/${minQuestions} answered`);
  if (accuracy < a.assessmentAccuracy) failures.unshift(`Accuracy ${pct(accuracy)} (needs ${pct(a.assessmentAccuracy)})`);
  if (medianMs === null || medianMs > target) {
    failures.push(`Median time ${medianMs === null ? "—" : `${(medianMs / 1000).toFixed(1)}s`} (target ${(target / 1000).toFixed(1)}s)`);
  }

  return {
    questions: answers.length,
    correct,
    accuracy,
    bandAccuracy,
    medianMs,
    passed: failures.length === 0,
    failures,
  };
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
