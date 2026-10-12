import { describe, expect, it } from "vitest";
import { stageReadiness, type AssessmentRecord } from "@/lib/engine/advancement";
import { buildAssessment, evaluateAssessment, type AssessmentAnswer } from "@/lib/engine/assessment";
import { stageFacts } from "@/lib/engine/facts";
import { seededRng } from "@/lib/engine/rng";
import type { Records } from "@/lib/engine/selection";
import { AppStore } from "@/lib/store/app-store";
import { MemoryRepository } from "@/lib/persistence/repository";
import { DAY, f, masteredRecord, replay, settings, T0 } from "./helpers";

const s = settings();

function allMastered(stage: 1 | 2 = 1): Records {
  const r: Records = {};
  for (const x of stageFacts(stage)) r[x.key] = masteredRecord(x);
  return r;
}
const NOW = T0 + 3 * DAY;

const passed = (stage: 1 | 2 = 1): AssessmentRecord => ({
  id: "a1",
  stage,
  at: NOW,
  questions: 60,
  correct: 60,
  accuracy: 1,
  bandAccuracy: {},
  medianMs: 1500,
  passed: true,
  qualified: true,
  failures: [],
});

describe("assessment construction", () => {
  it("has the configured length, no duplicates, and over-represents hard facts", () => {
    const plan = buildAssessment(1, {}, s, seededRng(5));
    expect(plan).toHaveLength(60);
    expect(new Set(plan.map((x) => x.key)).size).toBe(60);
    const hard = plan.filter((x) => x.band === "hard").length;
    expect(hard).toBeGreaterThanOrEqual(25);
  });

  it("always includes weak facts", () => {
    const records: Records = {};
    const weak = [f(13, 17), f(16, 19), f(18, 19)];
    for (const w of weak) records[w.key] = replay(w, [{ ok: false }, { ok: false }]).record;
    const plan = buildAssessment(1, records, s, seededRng(7));
    for (const w of weak) expect(plan.map((x) => x.key)).toContain(w.key);
  });

  it("mixes earlier-stage facts with facts new to the stage", () => {
    const plan = buildAssessment(2, {}, s, seededRng(11));
    expect(plan.filter((x) => x.homeStage === 1).length).toBeGreaterThanOrEqual(6);
    expect(plan.filter((x) => x.homeStage === 2).length).toBeGreaterThanOrEqual(25);
  });
});

describe("assessment evaluation", () => {
  const plan = buildAssessment(1, {}, s, seededRng(5));
  const answer = (wrong: (i: number, band: string) => boolean): AssessmentAnswer[] =>
    plan.map((fact, i) => ({ fact, ok: !wrong(i, fact.band), ms: 1500 }));

  it("passes a clean, fast run", () => {
    expect(evaluateAssessment(1, answer(() => false), s).passed).toBe(true);
  });

  it("does not let easy facts conceal a weak hard band", () => {
    let hardMisses = 0;
    const answers = answer((_, band) => band === "hard" && hardMisses++ < 3);
    const out = evaluateAssessment(1, answers, s);
    expect(out.accuracy).toBeGreaterThanOrEqual(0.95);
    expect(out.passed).toBe(false);
    expect(out.failures.join(" ")).toMatch(/hard/);
  });

  it("fails on low overall accuracy, slow median, or an incomplete run", () => {
    expect(evaluateAssessment(1, answer((i) => i % 10 === 0), s).passed).toBe(false);
    const slow = plan.map((fact) => ({ fact, ok: true, ms: 4000 }));
    expect(evaluateAssessment(1, slow, s).failures.join(" ")).toMatch(/Median/);
    expect(evaluateAssessment(1, answer(() => false).slice(0, 30), s).failures[0]).toMatch(/Incomplete/);
  });
});

describe("stage advancement", () => {
  it("is locked on a fresh profile and says what remains", () => {
    const r = stageReadiness(1, {}, s, NOW, []);
    expect(r.canAdvance).toBe(false);
    expect(r.prerequisitesMet).toBe(false);
    expect(r.counts.unpractised).toBe(210);
    expect(r.checks.find((c) => c.id === "mastered")?.met).toBe(false);
  });

  it("requires a qualifying assessment even when every fact is mastered", () => {
    const records = allMastered();
    const without = stageReadiness(1, records, s, NOW, []);
    expect(without.prerequisitesMet).toBe(true);
    expect(without.canAdvance).toBe(false);
    expect(stageReadiness(1, records, s, NOW, [{ ...passed(), qualified: false }]).canAdvance).toBe(false);
    expect(stageReadiness(1, records, s, NOW, [passed()]).canAdvance).toBe(true);
  });

  it("does not let easy facts hide unmastered hard facts", () => {
    const records = allMastered();
    const hard = stageFacts(1).filter((x) => x.band === "hard");
    // Un-master 20% of the hard facts: overall share still ≥ 90%, hard band is not.
    for (const x of hard.slice(0, Math.ceil(hard.length * 0.2))) records[x.key] = replay(x, [{ ok: true }]).record;
    const r = stageReadiness(1, records, s, NOW, [passed()]);
    expect(r.checks.find((c) => c.id === "mastered")?.met).toBe(true);
    expect(r.checks.find((c) => c.id === "bands")?.met).toBe(false);
    expect(r.canAdvance).toBe(false);
  });

  it("blocks advancement while weak facts or overdue reviews remain", () => {
    const records = allMastered();
    const w = f(13, 19);
    records[w.key] = replay(w, [...Array.from({ length: 4 }, () => ({ ok: true })), { ok: false }, { ok: false }]).record;
    expect(stageReadiness(1, records, s, NOW, [passed()]).weakFacts.map((x) => x.key)).toEqual([w.key]);
    expect(stageReadiness(1, records, s, NOW, [passed()]).canAdvance).toBe(false);

    const later = T0 + 400 * DAY; // everything overdue
    expect(stageReadiness(1, allMastered(), s, later, [passed()]).checks.find((c) => c.id === "overdue")?.met).toBe(false);
  });

  it("the store only unlocks a stage when readiness allows it", async () => {
    const store = new AppStore(new MemoryRepository(), 0);
    await store.init();
    expect(store.advanceStage(NOW).ok).toBe(false);
    expect(store.state.progress.unlockedStage).toBe(1);
    for (const r of Object.values(allMastered())) store.commitRecord(r!);
    store.recordAssessment(passed());
    expect(store.advanceStage(NOW)).toEqual({ ok: true, stage: 2 });
    expect(store.state.progress.unlockedStage).toBe(2);
    // Stage 2 must be earned on its own.
    expect(store.advanceStage(NOW).ok).toBe(false);
  });
});
