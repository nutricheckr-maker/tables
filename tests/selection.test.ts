import { describe, expect, it } from "vitest";
import { stageFacts } from "@/lib/engine/facts";
import { seededRng } from "@/lib/engine/rng";
import { chooseSmallerFirst, priority, selectNext, type Records } from "@/lib/engine/selection";
import { emptyRecord } from "@/lib/engine/stats";
import type { FactKey } from "@/lib/engine/types";
import { DAY, f, masteredRecord, replay, settings, T0 } from "./helpers";

const s = settings();

function run(pool = stageFacts(1), records: Records = {}, n = 200, mode: "mixed" | "focused" | "speed" | "weakness" = "mixed") {
  const rng = seededRng(42);
  const history: FactKey[] = [];
  let newIntroduced = 0;
  for (let i = 0; i < n; i++) {
    const pick = selectNext({ mode, pool, records, settings: s, now: T0 + 30 * DAY, history, relearn: [], newIntroduced, rng });
    if (!pick) break;
    if (pick.reason === "new") newIntroduced++;
    history.push(pick.fact.key);
  }
  return { history, newIntroduced };
}

describe("selection", () => {
  it("introduces new facts in learning order and within the per-session budget", () => {
    const { history, newIntroduced } = run(stageFacts(1), {}, 40);
    expect(newIntroduced).toBeLessThanOrEqual(s.practice.newPerSession);
    // Only the first NEW_FRONTIER (5) facts in learning order are candidates on an empty profile.
    const first = new Set(stageFacts(1).slice(0, 5).map((x) => x.key));
    expect(first.has(history[0] as FactKey)).toBe(true);
  });

  it("never repeats a fact within the repeat gap when the pool allows", () => {
    const pool = stageFacts(1).slice(0, 30);
    const records: Records = {};
    for (const x of pool) records[x.key] = replay(x, [{ ok: true }]).record;
    const { history } = run(pool, records, 300);
    for (let i = 1; i < history.length; i++) {
      const window = history.slice(Math.max(0, i - s.practice.minRepeatGap), i);
      expect(window).not.toContain(history[i]);
    }
  });

  it("asks weak facts far more often than mastered ones", () => {
    const pool = stageFacts(1).slice(0, 40);
    const records: Records = {};
    for (const x of pool) records[x.key] = masteredRecord(x);
    const weakFact = pool[10]!;
    records[weakFact.key] = replay(weakFact, [{ ok: true }, { ok: false }, { ok: false }]).record;
    const { history } = run(pool, records, 300);
    const weakCount = history.filter((k) => k === weakFact.key).length;
    const masteredAvg = (history.length - weakCount) / (pool.length - 1);
    expect(weakCount).toBeGreaterThan(masteredAvg * 5);
  });

  it("re-asks a missed fact after the relearn delay", () => {
    const pool = stageFacts(1).slice(0, 30);
    const missed = pool[3]!.key;
    const pick = selectNext({
      mode: "mixed",
      pool,
      records: {},
      settings: s,
      now: T0,
      history: ["1x1", "1x2", "1x3", "1x4"] as FactKey[],
      relearn: [{ key: missed, at: 4 }],
      newIntroduced: 0,
      rng: seededRng(1),
    });
    expect(pick).toEqual({ fact: pool[3], reason: "relearn" });
  });

  it("prioritises due and overdue facts over not-yet-due ones", () => {
    const x = f(13, 14);
    const rec = masteredRecord(x);
    const notDue = priority(x, rec, "mixed", s, rec.lastPractisedAt! + 1000, false);
    const overdue = priority(x, rec, "mixed", s, rec.dueAt! + 10 * DAY, false);
    expect(notDue.reason).toBe("review");
    expect(overdue.reason).toBe("due");
    expect(overdue.weight).toBeGreaterThan(notDue.weight * 10);
  });

  it("weakness mode only offers weak, due or slow facts", () => {
    const pool = stageFacts(1).slice(0, 20);
    const records: Records = {};
    for (const x of pool) records[x.key] = masteredRecord(x);
    // Everything mastered and not due at that moment → nothing to eliminate.
    const now = Math.min(...pool.map((x) => records[x.key]!.dueAt!)) - 1000;
    const none = selectNext({ mode: "weakness", pool, records, settings: s, now, history: [], relearn: [], newIntroduced: 0, rng: seededRng(3) });
    expect(none).toBeNull();
  });

  it("speed and weakness modes never introduce unpractised facts", () => {
    expect(priority(f(3, 4), emptyRecord("3x4"), "speed", s, T0, true).weight).toBe(0);
    expect(priority(f(3, 4), undefined, "weakness", s, T0, true).weight).toBe(0);
  });

  it("balances question orientation", () => {
    const x = f(7, 12);
    const rec = { ...emptyRecord(x.key), orientation: { ab: 20, ba: 0 } };
    const rng = seededRng(9);
    let smallFirst = 0;
    for (let i = 0; i < 500; i++) if (chooseSmallerFirst(x, rec, rng)) smallFirst++;
    expect(smallFirst).toBeLessThan(100);
    expect(chooseSmallerFirst(f(9, 9), rec, rng)).toBe(true);
  });
});
