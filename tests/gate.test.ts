import { describe, expect, it } from "vitest";
import { factKey } from "@/lib/engine/facts";
import { seededRng } from "@/lib/engine/rng";
import type { StageId } from "@/lib/engine/types";
import { stageFacts } from "@/lib/engine/facts";
import { createChallenge, gatePool, gradeChallenge } from "@/lib/gate/challenge";
import { GATE } from "@/lib/gate/policy";
import { GateState, type GateMemory, type ProgressSource, type StartedChallenge, type StartOutcome } from "@/lib/gate/state";

/** The 58 non-trivial facts nebula had actually practised on 2026-10-13 (both factors 2–14). */
const PRACTISED = stageFacts(1)
  .filter((f) => f.a >= 2 && f.b <= 11)
  .map((f) => f.key);
const SOURCE: ProgressSource = { stage: 1, introduced: PRACTISED };

function started(out: StartOutcome): StartedChallenge {
  if ("error" in out) throw new Error(out.error);
  return out;
}

class FakeClock {
  w = Date.UTC(2026, 9, 12, 20);
  m = 1_000_000;
  wall = () => this.w;
  mono = () => this.m;
  /** Normal passage of time: both clocks move together. */
  advance(ms: number) {
    this.w += ms;
    this.m += ms;
  }
  /** Suspend: the wall clock moves, the monotonic clock does not. */
  sleep(ms: number) {
    this.w += ms;
  }
}

function setup(stage: StageId = 1, introduced: string[] = []) {
  const clock = new FakeClock();
  let saved: GateMemory = { stage, introduced };
  let n = 0;
  const gate = new GateState(clock, seededRng(7), { load: () => saved, save: (m) => (saved = m) }, () => `c${++n}`);
  return { clock, gate, saved: () => saved };
}

/** Answer the current challenge: `correct` right answers, the rest wrong, after `ms`. */
function answer(g: ReturnType<typeof setup>, correct: number, ms: number) {
  const ch = started(g.gate.start(SOURCE));
  const products = ch.questions.map((q) => q.left * q.right);
  g.clock.advance(ms);
  const answers = products.map((p, i) => (i < correct ? p : p + 1));
  return g.gate.submit(ch.id, answers);
}

describe("challenge generation", () => {
  it("has exactly 10 distinct facts from the pool, both factors ≥ 2", () => {
    for (const stage of [1, 2, 3, 4] as StageId[]) {
      const pool = gatePool(stage, new Set(stageFacts(stage).map((f) => f.key)));
      for (let seed = 0; seed < 50; seed++) {
        const ch = createChallenge("x", stage, pool, 0, seededRng(seed));
        expect(ch.questions).toHaveLength(GATE.questions);
        const keys = ch.questions.map((q) => factKey(q.left, q.right));
        expect(new Set(keys).size).toBe(10);
        const max = [20, 30, 40, 50][stage - 1]!;
        expect(ch.questions.every((q) => q.left >= 2 && q.right >= 2 && q.left <= max && q.right <= max)).toBe(true);
      }
    }
  });

  it("never sends answers to the page", () => {
    const { gate } = setup();
    const started = gate.start(SOURCE) as unknown as Record<string, unknown>;
    expect(Object.keys(started).sort()).toEqual(["id", "limitMs", "passCorrect", "questions", "stage"]);
    expect(JSON.stringify(started.questions)).not.toMatch(/answer|product/);
  });
});

describe("grading boundaries", () => {
  const ch = createChallenge("x", 1, gatePool(1, new Set(PRACTISED)), 1000, seededRng(1));
  const right = ch.answers;
  const with8 = right.map((a, i) => (i < 8 ? a : a + 1));
  const with7 = right.map((a, i) => (i < 7 ? a : a + 1));

  it("passes 8/10 at exactly 40.000 s", () => {
    expect(gradeChallenge(ch, with8, 1000 + 40_000)).toMatchObject({ correct: 8, passed: true });
  });
  it("fails 8/10 at 40.001 s", () => {
    expect(gradeChallenge(ch, with8, 1000 + 40_001).passed).toBe(false);
  });
  it("fails 7/10 even when fast", () => {
    expect(gradeChallenge(ch, with7, 1000 + 5_000)).toMatchObject({ correct: 7, passed: false });
  });
  it("passes 10/10 well inside the limit", () => {
    expect(gradeChallenge(ch, right, 1000 + 20_000).passed).toBe(true);
  });
  it("treats missing or malformed answers as wrong", () => {
    expect(gradeChallenge(ch, [], 2000).correct).toBe(0);
    expect(gradeChallenge(ch, right.map(() => null), 2000).correct).toBe(0);
  });
});

describe("gate state", () => {
  it("grants on a pass under the limit", () => {
    const g = setup();
    const out = answer(g, 10, 25_000);
    expect(out.ok && out.result.passed).toBe(true);
    expect(g.gate.isGranted()).toBe(true);
  });

  it("denies a passing score submitted after 40 s", () => {
    const g = setup();
    const out = answer(g, 10, 40_500);
    expect(out.ok && out.result.passed).toBe(false);
    expect(g.gate.isGranted()).toBe(false);
  });

  it("denies a failing score submitted in time", () => {
    const g = setup();
    answer(g, 7, 10_000);
    expect(g.gate.isGranted()).toBe(false);
  });

  it("accepts exactly 8 correct at exactly 40 s", () => {
    const g = setup();
    answer(g, 8, 40_000);
    expect(g.gate.isGranted()).toBe(true);
  });

  it("measures time itself, so a page cannot claim to be fast", () => {
    const g = setup();
    const ch = started(g.gate.start(SOURCE));
    g.clock.advance(60_000);
    const out = g.gate.submit(ch.id, ch.questions.map((q) => q.left * q.right));
    expect(out.ok && out.result.elapsedMs).toBe(60_000);
    expect(g.gate.isGranted()).toBe(false);
  });

  it("accepts one submission per challenge, and a new start voids the old one", () => {
    const g = setup();
    const first = started(g.gate.start(SOURCE));
    const second = started(g.gate.start(SOURCE));
    const answers = second.questions.map((q) => q.left * q.right);
    expect(g.gate.submit(first.id, answers).ok).toBe(false);
    expect(g.gate.submit(second.id, answers).ok).toBe(true);
    expect(g.gate.submit(second.id, answers).ok).toBe(false);
  });

  it("expires after the grant period", () => {
    const g = setup();
    answer(g, 10, 20_000);
    g.clock.advance(GATE.grantMs - 1);
    expect(g.gate.isGranted()).toBe(true);
    g.clock.advance(1);
    expect(g.gate.isGranted()).toBe(false);
    expect(g.gate.history().at(-1)?.kind).toBe("expire");
  });

  it("revokes on suspend/resume", () => {
    const g = setup();
    answer(g, 10, 20_000);
    g.clock.sleep(5 * 60_000);
    expect(g.gate.isGranted()).toBe(false);
    expect(g.gate.history().at(-1)).toMatchObject({ kind: "revoke", detail: "suspend" });
  });

  it("revokes when the system clock is set back (cannot extend a grant)", () => {
    const g = setup();
    answer(g, 10, 20_000);
    g.clock.w -= 3_600_000;
    expect(g.gate.isGranted()).toBe(false);
  });

  it("does not revoke for normal idle time", () => {
    const g = setup();
    answer(g, 10, 20_000);
    g.clock.advance(20 * 60_000);
    expect(g.gate.isGranted()).toBe(true);
  });

  it("a suspend in the middle of a challenge voids it", () => {
    const g = setup();
    const ch = started(g.gate.start(SOURCE));
    g.clock.sleep(60_000);
    g.gate.isGranted();
    expect(g.gate.submit(ch.id, ch.questions.map((q) => q.left * q.right)).ok).toBe(false);
  });

  it("manual revoke locks immediately and notifies listeners", () => {
    const g = setup();
    let calls = 0;
    g.gate.subscribe(() => calls++);
    answer(g, 10, 20_000);
    g.gate.revoke("manual");
    expect(g.gate.isGranted()).toBe(false);
    expect(calls).toBe(2);
  });

  it("the remembered stage and introduced facts only ever grow", () => {
    const g = setup(2);
    expect(started(g.gate.start({ stage: 1, introduced: PRACTISED })).stage).toBe(2);
    expect(started(g.gate.start({ stage: 3, introduced: PRACTISED })).stage).toBe(3);
    expect(g.saved().stage).toBe(3);
    // A reset trainer (nothing practised) cannot shrink the pool.
    expect(started(g.gate.start({ stage: 1, introduced: [] })).stage).toBe(3);
    expect(g.saved().introduced.length).toBe(PRACTISED.length);
  });
});

describe("only introduced facts", () => {
  it("asks only facts practised in the trainer", () => {
    const g = setup();
    const allowed = new Set(PRACTISED);
    for (let i = 0; i < 200; i++) {
      const ch = started(g.gate.start(SOURCE));
      for (const q of ch.questions) expect(allowed.has(factKey(q.left, q.right))).toBe(true);
    }
  });

  it("never asks an unintroduced fact even when the stage is larger", () => {
    const g = setup();
    const ch = started(g.gate.start({ stage: 1, introduced: PRACTISED }));
    expect(ch.questions.every((q) => q.left <= 11 && q.right <= 11)).toBe(true);
  });

  it("ignores introduced facts outside the unlocked stage", () => {
    expect(gatePool(1, new Set(["21x22", "3x4"])).map((f) => f.key)).toEqual(["3x4"]);
  });

  it("refuses, with a reason, when fewer than 10 facts are introduced", () => {
    const g = setup();
    const out = g.gate.start({ stage: 1, introduced: ["2x3", "4x5", "6x7"] });
    expect("error" in out && out.error).toMatch(/Only 3 facts/);
    expect(g.gate.isGranted()).toBe(false);
  });

  it("leaves out ×1 facts unless they are needed to reach 10", () => {
    const withOnes = ["1x2", "1x3", ...PRACTISED];
    expect(gatePool(1, new Set(withOnes)).some((f) => f.a === 1)).toBe(false);
    const few = ["1x2", "1x3", "1x4", "2x3", "2x4", "2x5", "3x4", "3x5", "4x5", "4x6"];
    expect(gatePool(1, new Set(few))).toHaveLength(10);
  });

  it("works without a progress file, from what it remembers", () => {
    const g = setup(1, PRACTISED);
    expect(started(g.gate.start(null)).questions).toHaveLength(10);
  });
});
