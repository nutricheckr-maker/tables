import { describe, expect, it } from "vitest";
import { factStatus, masteryChecks, weakReasons } from "@/lib/engine/mastery";
import { DAY, f, masteredSteps, replay, settings } from "./helpers";

const fact = f(14, 17);

describe("mastery", () => {
  it("is unpractised with no attempts", () => {
    expect(factStatus(undefined, fact, settings())).toBe("unpractised");
  });

  it("is never mastered from a single correct answer", () => {
    const { record } = replay(fact, [{ ok: true }]);
    expect(factStatus(record, fact, settings())).toBe("developing");
  });

  it("is not mastered by many correct answers in one sitting", () => {
    const { record } = replay(fact, Array.from({ length: 20 }, () => ({ ok: true, session: "one" })));
    const c = masteryChecks(record, fact, settings());
    expect(c.attempts && c.accuracy && c.speed).toBe(true);
    expect(c.sessions).toBe(false);
    expect(c.spaced).toBe(false);
    expect(factStatus(record, fact, settings())).toBe("developing");
  });

  it("is mastered with enough accurate, fast recall across spaced sessions", () => {
    const { record } = replay(fact, masteredSteps());
    expect(factStatus(record, fact, settings())).toBe("mastered");
  });

  it("requires the speed target, judged on correct answers only", () => {
    const slow = masteredSteps().map((s) => ({ ...s, ms: 4500 }));
    const { record } = replay(fact, slow);
    expect(masteryChecks(record, fact, settings()).speed).toBe(false);
    expect(factStatus(record, fact, settings())).toBe("developing");
  });

  it("is not mastered if the latest answer was wrong", () => {
    const { record } = replay(fact, [...masteredSteps(), { ok: true }, { ok: true }, { ok: false }]);
    expect(factStatus(record, fact, settings())).not.toBe("mastered");
  });

  it("marks repeated misses as weak, overriding past mastery", () => {
    const { record } = replay(fact, [...masteredSteps(), { ok: false, after: DAY }, { ok: true }, { ok: false }]);
    expect(weakReasons(record, fact, settings())).toContain("misses");
    expect(factStatus(record, fact, settings())).toBe("weak");
  });

  it("marks persistently slow correct recall as weak", () => {
    const { record } = replay(fact, [{ ok: true, ms: 9000 }, { ok: true, ms: 8000 }, { ok: true, ms: 7000 }]);
    expect(weakReasons(record, fact, settings())).toEqual(["slow"]);
  });

  it("respects configurable criteria", () => {
    const s = settings();
    s.mastery.minCorrectSessions = 1;
    s.mastery.minSpacedSuccesses = 0;
    const { record } = replay(fact, Array.from({ length: 6 }, () => ({ ok: true, session: "one" })), s);
    expect(factStatus(record, fact, s)).toBe("mastered");
  });

  it("uses the stage's own speed target for later-stage facts", () => {
    const hard = f(37, 48);
    const { record } = replay(hard, masteredSteps().map((st) => ({ ...st, ms: 5500 })));
    expect(factStatus(record, hard, settings())).toBe("mastered");
  });
});
