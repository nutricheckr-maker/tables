import type { Settings } from "./config";
import { MAX_STAGE } from "./config";
import { newFactsInStage, stageFacts } from "./facts";
import { factStatus } from "./mastery";
import { isDue } from "./scheduler";
import type { Records } from "./selection";
import type { Band, Fact, FactStatus, StageId } from "./types";

export interface AssessmentRecord {
  id: string;
  stage: StageId;
  at: number;
  questions: number;
  correct: number;
  accuracy: number;
  bandAccuracy: Partial<Record<Band, number>>;
  medianMs: number | null;
  passed: boolean;
  /** Whether every other advancement requirement was met when the assessment started. */
  qualified: boolean;
  failures: string[];
}

export interface ReadinessCheck {
  id: "mastered" | "bands" | "newRange" | "weak" | "overdue" | "assessment";
  label: string;
  met: boolean;
  detail: string;
}

export interface StageReadiness {
  stage: StageId;
  checks: ReadinessCheck[];
  /** All checks except the assessment are met: a passing assessment now will unlock the next stage. */
  prerequisitesMet: boolean;
  canAdvance: boolean;
  isFinalStage: boolean;
  counts: Record<FactStatus, number>;
  weakFacts: Fact[];
  overdueFacts: Fact[];
}

export function statusCounts(facts: readonly Fact[], records: Records, s: Settings): Record<FactStatus, number> {
  const c: Record<FactStatus, number> = { unpractised: 0, developing: 0, weak: 0, mastered: 0 };
  for (const f of facts) c[factStatus(records[f.key], f, s)]++;
  return c;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function stageReadiness(
  stage: StageId,
  records: Records,
  settings: Settings,
  now: number,
  assessments: readonly AssessmentRecord[],
): StageReadiness {
  const a = settings.advancement;
  const facts = stageFacts(stage);
  const statuses = new Map(facts.map((f) => [f.key, factStatus(records[f.key], f, settings)]));
  const masteredShare = (fs: readonly Fact[]) =>
    fs.length === 0 ? 1 : fs.filter((f) => statuses.get(f.key) === "mastered").length / fs.length;

  const checks: ReadinessCheck[] = [];
  const total = masteredShare(facts);
  checks.push({
    id: "mastered",
    label: `Master ${pct(a.minMasteredShare)} of stage facts`,
    met: total >= a.minMasteredShare,
    detail: `${pct(total)} mastered`,
  });

  const bandParts: string[] = [];
  let bandsMet = true;
  for (const band of ["easy", "medium", "hard"] as Band[]) {
    const inBand = facts.filter((f) => f.band === band);
    if (inBand.length === 0) continue;
    const share = masteredShare(inBand);
    if (share < a.minBandShare) bandsMet = false;
    bandParts.push(`${band} ${pct(share)}`);
  }
  checks.push({
    id: "bands",
    label: `Master ${pct(a.minBandShare)} in every difficulty band`,
    met: bandsMet,
    detail: bandParts.join(" · "),
  });

  if (stage > 1) {
    const fresh = newFactsInStage(stage);
    const share = masteredShare(fresh);
    checks.push({
      id: "newRange",
      label: `Master ${pct(a.minMasteredShare)} of the facts new to this stage`,
      met: share >= a.minMasteredShare,
      detail: `${pct(share)} of ${fresh.length}`,
    });
  }

  const weakFacts = facts.filter((f) => statuses.get(f.key) === "weak");
  checks.push({
    id: "weak",
    label: a.maxWeak === 0 ? "No weak facts" : `At most ${a.maxWeak} weak facts`,
    met: weakFacts.length <= a.maxWeak,
    detail: `${weakFacts.length} weak`,
  });

  const overdueFacts = facts.filter((f) => isDue(records[f.key]?.dueAt ?? null, now));
  checks.push({
    id: "overdue",
    label: `At most ${a.maxOverdue} reviews outstanding`,
    met: overdueFacts.length <= a.maxOverdue,
    detail: `${overdueFacts.length} due`,
  });

  const prerequisitesMet = checks.every((c) => c.met);
  const passed = assessments.find((r) => r.stage === stage && r.passed && r.qualified);
  checks.push({
    id: "assessment",
    label: "Pass a qualifying mastery assessment",
    met: passed !== undefined,
    detail: passed
      ? `Passed ${new Date(passed.at).toLocaleDateString()}`
      : prerequisitesMet
        ? "Ready to take"
        : "After the checks above",
  });

  const counts: Record<FactStatus, number> = { unpractised: 0, developing: 0, weak: 0, mastered: 0 };
  for (const st of statuses.values()) counts[st]++;

  return {
    stage,
    checks,
    prerequisitesMet,
    canAdvance: stage < MAX_STAGE && checks.every((c) => c.met),
    isFinalStage: stage === MAX_STAGE,
    counts,
    weakFacts,
    overdueFacts,
  };
}
