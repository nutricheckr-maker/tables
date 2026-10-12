import { describe, expect, it } from "vitest";
import { applyAttempt } from "@/lib/engine/attempt";
import { classifyError, looksLikeTypo, parseAnswer } from "@/lib/engine/evaluation";
import { schedule } from "@/lib/engine/scheduler";
import { emptyRecord } from "@/lib/engine/stats";
import { DAY, HOUR, T0, f, replay, settings } from "./helpers";

describe("answer parsing", () => {
  it("accepts digits and rejects everything else", () => {
    expect(parseAnswer("238")).toEqual({ ok: true, value: 238 });
    expect(parseAnswer(" 1 024 ")).toEqual({ ok: true, value: 1024 });
    expect(parseAnswer("")).toMatchObject({ ok: false });
    expect(parseAnswer("-4")).toMatchObject({ ok: false });
    expect(parseAnswer("12a")).toMatchObject({ ok: false });
    expect(parseAnswer("3.5")).toMatchObject({ ok: false });
  });

  it("recognises typo-shaped answers", () => {
    expect(looksLikeTypo(283, 238)).toBe(true);
    expect(looksLikeTypo(248, 238)).toBe(true);
    expect(looksLikeTypo(221, 238)).toBe(false);
    expect(looksLikeTypo(2380, 238)).toBe(false);
  });
});

describe("scheduler", () => {
  const s = settings().scheduler;
  it("promotes fast correct answers one level at a time", () => {
    expect(schedule(2, { ok: true, fast: true, firstAttempt: false }, T0, s)).toEqual({ level: 3, dueAt: T0 + 72 * HOUR });
  });
  it("lets a fast first answer skip the learning steps", () => {
    expect(schedule(0, { ok: true, fast: true, firstAttempt: true }, T0, s).level).toBe(2);
  });
  it("caps promotion for slow correct answers without demoting", () => {
    expect(schedule(1, { ok: true, fast: false, firstAttempt: false }, T0, s).level).toBe(2);
    expect(schedule(3, { ok: true, fast: false, firstAttempt: false }, T0, s).level).toBe(3);
    expect(schedule(5, { ok: true, fast: false, firstAttempt: false }, T0, s).level).toBe(5);
  });
  it("brings missed facts back sooner: gaps reset, slips step back", () => {
    expect(schedule(5, { ok: false, kind: "gap" }, T0, s)).toEqual({ level: 0, dueAt: T0 });
    expect(schedule(5, { ok: false, kind: "slip" }, T0, s).level).toBe(4);
    expect(schedule(1, { ok: false, kind: "slip" }, T0, s).level).toBe(1);
  });
  it("never exceeds the last interval", () => {
    const top = s.intervalsHours.length - 1;
    expect(schedule(top, { ok: true, fast: true, firstAttempt: false }, T0, s).level).toBe(top);
  });
});

describe("applyAttempt", () => {
  const fact = f(7, 12);

  it("records counts, orientation and time without mutating the input", () => {
    const prev = emptyRecord(fact.key);
    const { record, result } = applyAttempt(
      prev,
      fact,
      { given: 84, ms: 1234, smallerFirst: false, sessionId: "s1", now: T0 },
      settings(),
    );
    expect(result).toMatchObject({ ok: true, fast: true, ms: 1234, expected: 84 });
    expect(record).toMatchObject({ attempts: 1, correct: 1, incorrect: 0, correctSessions: 1, orientation: { ab: 0, ba: 1 } });
    expect(record.lastPractisedAt).toBe(T0);
    expect(prev.attempts).toBe(0);
  });

  it("records and schedules incorrect answers", () => {
    const { record, result } = applyAttempt(
      emptyRecord(fact.key),
      fact,
      { given: 74, ms: 2000, smallerFirst: true, sessionId: "s1", now: T0 },
      settings(),
    );
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe("unclassified");
    expect(record.incorrect).toBe(1);
    expect(record.level).toBe(0);
    expect(record.dueAt).toBe(T0);
  });

  it("treats a timeout as incorrect", () => {
    const { result } = applyAttempt(
      emptyRecord(fact.key),
      fact,
      { given: null, ms: 5000, timedOut: true, smallerFirst: true, sessionId: "s", now: T0 },
      settings(),
    );
    expect(result).toMatchObject({ ok: false, errorKind: "timeout" });
  });

  it("does not count idle time as slow recall", () => {
    const { result, record } = applyAttempt(
      emptyRecord(fact.key),
      fact,
      { given: 84, ms: 5 * 60_000, smallerFirst: true, sessionId: "s", now: T0 },
      settings(),
    );
    expect(result.ms).toBeNull();
    expect(result.ok).toBe(true);
    expect(record.recent[0]?.ms).toBeNull();
  });

  it("counts distinct correct sessions and spaced recalls", () => {
    const { record } = replay(fact, [
      { ok: true, session: "a" },
      { ok: true, session: "a" },
      { ok: true, session: "b", after: 2 * HOUR },
      { ok: true, session: "c", after: DAY },
    ]);
    expect(record.correctSessions).toBe(3);
    expect(record.spacedSuccesses).toBe(1);
  });

  it("trims the recent window", () => {
    const s = settings();
    s.mastery.recentWindow = 5;
    const { record } = replay(fact, Array.from({ length: 9 }, () => ({ ok: true })), s);
    expect(record.recent).toHaveLength(5);
    expect(record.attempts).toBe(9);
  });
});

describe("careless slip vs knowledge gap", () => {
  const fact = f(13, 17);

  it("needs history before classifying", () => {
    expect(classifyError(emptyRecord(fact.key), fact, 200)).toBe("unclassified");
  });

  it("calls an isolated miss on a strong fact a slip", () => {
    const { record } = replay(fact, Array.from({ length: 8 }, () => ({ ok: true })));
    expect(classifyError(record, fact, 200)).toBe("slip");
  });

  it("calls a repeated miss a gap, and resets spaced evidence", () => {
    const { record } = replay(fact, [
      { ok: true },
      { ok: false },
      { ok: true },
      { ok: false },
      { ok: true },
      { ok: true, after: DAY },
    ]);
    expect(record.spacedSuccesses).toBe(1);
    expect(classifyError(record, fact, 200)).toBe("gap");
    const after = applyAttempt(record, fact, { given: 200, ms: 2000, smallerFirst: true, sessionId: "z", now: T0 + 3 * DAY }, settings());
    expect(after.result.errorKind).toBe("gap");
    expect(after.record.spacedSuccesses).toBe(0);
  });

  it("forgives a typo-shaped answer on a good record", () => {
    const { record } = replay(fact, [{ ok: true }, { ok: true }, { ok: false }, { ok: true }, { ok: true }, { ok: true }]);
    expect(classifyError(record, fact, 212)).toBe("slip"); // 221 → 212
    expect(classifyError(record, fact, 150)).toBe("gap");
  });

  it("counts a forgotten fact as a lapse only for real gaps", () => {
    const strong = Array.from({ length: 5 }, () => ({ ok: true, after: DAY }));
    const { record } = replay(fact, [...strong, { ok: false, after: 7 * DAY }]);
    // The first miss on a strong record is a slip, not a lapse.
    expect(record.slips).toBe(1);
    expect(record.lapses).toBe(0);

    const weakish = [{ ok: true }, { ok: false }, { ok: true, after: DAY }, { ok: true, after: 3 * DAY }];
    const second = replay(fact, [...weakish, { ok: false, after: 7 * DAY }]).record;
    expect(second.lapses).toBe(1);
  });
});
