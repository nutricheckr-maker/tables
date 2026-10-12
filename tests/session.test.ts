import { describe, expect, it } from "vitest";
import { buildAssessment } from "@/lib/engine/assessment";
import { seededRng } from "@/lib/engine/rng";
import type { Records } from "@/lib/engine/selection";
import { advance, effectiveTimeLimit, startSession, submitAnswer, summarize, type SessionConfig } from "@/lib/engine/session";
import { settings, T0 } from "./helpers";

const s = settings();
const cfg = (over: Partial<SessionConfig> = {}): SessionConfig => ({ mode: "mixed", stage: 1, length: 20, timeLimitMs: null, ...over });

function play(config: SessionConfig, answerer: (product: number, i: number) => number, records: Records = {}) {
  const rng = seededRng(123);
  let now = T0;
  let st = startSession("sess", config, records, s, now, rng);
  const recs = { ...records };
  let i = 0;
  while (st.current) {
    now += 2000;
    const out = submitAnswer(st, recs, s, { given: answerer(st.current.question.product, i++), ms: 1500 }, now);
    recs[out.record.key] = out.record;
    st = advance(out.state, recs, s, now, rng);
  }
  return { st, recs };
}

describe("session", () => {
  it("runs a full session, records every answer and summarises it", () => {
    const { st, recs } = play(cfg(), (p) => p);
    expect(st.done).toBe(true);
    expect(st.answers).toHaveLength(20);
    expect(Object.values(recs).reduce((n, r) => n + r!.attempts, 0)).toBe(20);
    const sum = summarize(st, T0 + 60_000);
    expect(sum).toMatchObject({ questions: 20, correct: 20, medianMs: 1500 });
  });

  it("records incorrect answers and re-asks the missed fact later in the session", () => {
    const { st, recs } = play(cfg(), (p, i) => (i === 0 ? p + 1 : p));
    const missed = st.answers[0]!.question.key;
    expect(recs[missed]!.incorrect).toBe(1);
    const again = st.answers.findIndex((a, i) => i > 0 && a.question.key === missed);
    expect(again).toBe(1 + s.scheduler.relearnAfter);
  });

  it("focused practice stays within the chosen table", () => {
    const { st } = play(cfg({ mode: "focused", filter: { table: 17 } }), (p) => p);
    expect(st.answers.every((a) => a.question.left === 17 || a.question.right === 17)).toBe(true);
  });

  it("assessment follows its fixed plan and does not re-ask misses", () => {
    const plan = buildAssessment(1, {}, s, seededRng(1));
    const rng = seededRng(2);
    let st = startSession("as", { ...cfg({ mode: "assessment" }) }, {}, s, T0, rng, plan);
    const recs: Records = {};
    while (st.current) {
      const out = submitAnswer(st, recs, s, { given: 0, ms: 1000 }, T0);
      recs[out.record.key] = out.record;
      st = advance(out.state, recs, s, T0, rng);
    }
    expect(st.answers.map((a) => a.question.key)).toEqual(plan.map((x) => x.key));
  });

  it("speed training with no practised facts ends immediately", () => {
    const st = startSession("sp", cfg({ mode: "speed" }), {}, s, T0, seededRng(1));
    expect(st.done).toBe(true);
    expect(st.endReason).toBe("exhausted");
  });

  it("relaxes the time limit when accuracy drops below 90%", () => {
    const base = startSession("sp", cfg({ mode: "speed", timeLimitMs: 4000 }), {}, s, T0, seededRng(1));
    const wrong = { question: { key: "2x3" as const, left: 2, right: 3, product: 6 }, given: 5, ok: false, ms: 900, errorKind: null, reason: "review" as const };
    const right = { ...wrong, given: 6, ok: true };
    expect(effectiveTimeLimit({ ...base, answers: [right, right, right, right, right] })).toEqual({ limitMs: 4000, relaxed: false });
    expect(effectiveTimeLimit({ ...base, answers: [right, wrong, right, right, right] })).toEqual({ limitMs: 6000, relaxed: true });
  });
});

describe("new-fact budget", () => {
  it("does not spend the budget on facts that were already known", () => {
    const known = play(cfg({ length: 60 }), (p) => p);
    const newAsked = known.st.answers.filter((a) => a.reason === "new").length;
    expect(newAsked).toBeGreaterThan(s.practice.newPerSession);

    const struggling = play(cfg({ length: 60 }), (p) => p + 1);
    expect(struggling.st.answers.filter((a) => a.reason === "new").length).toBeLessThanOrEqual(s.practice.newPerSession);
  });
});
