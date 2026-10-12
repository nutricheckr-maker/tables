import { describe, expect, it } from "vitest";
import { STAGES } from "@/lib/engine/config";
import { bandOf, factKey, filterFacts, makeFact, newFactsInStage, parseFactKey, stageFacts, toQuestion } from "@/lib/engine/facts";

describe("facts", () => {
  it("treats a×b and b×a as one fact", () => {
    expect(factKey(12, 7)).toBe("7x12");
    expect(factKey(7, 12)).toBe("7x12");
    expect(makeFact(12, 7)).toEqual(makeFact(7, 12));
  });

  it("covers both factors up to the stage limit (n(n+1)/2 unordered facts)", () => {
    for (const s of STAGES) {
      const facts = stageFacts(s.id);
      expect(facts).toHaveLength((s.max * (s.max + 1)) / 2);
      expect(new Set(facts.map((x) => x.key)).size).toBe(facts.length);
      expect(facts.every((x) => x.a >= 1 && x.a <= x.b && x.b <= s.max && x.product === x.a * x.b)).toBe(true);
    }
    // Stage 1 includes 20×20 and 19×17, not merely the tables 1..20 up to ×10.
    const keys = new Set(stageFacts(1).map((x) => x.key));
    expect(keys.has("20x20")).toBe(true);
    expect(keys.has("17x19")).toBe(true);
    expect(keys.has("1x21")).toBe(false);
  });

  it("each stage builds on the previous one", () => {
    expect(newFactsInStage(2)).toHaveLength(465 - 210);
    const prev = new Set(stageFacts(1).map((x) => x.key));
    expect(newFactsInStage(2).some((x) => prev.has(x.key))).toBe(false);
    expect(makeFact(3, 21).homeStage).toBe(2);
    expect(makeFact(20, 20).homeStage).toBe(1);
    expect(makeFact(41, 50).homeStage).toBe(4);
  });

  it("orders stage facts easiest-first for introduction", () => {
    const facts = stageFacts(1);
    expect(facts[0]?.band).toBe("easy");
    expect(facts[facts.length - 1]?.band).toBe("hard");
  });

  it("assigns difficulty bands deterministically", () => {
    expect(bandOf(1, 19)).toBe("easy");
    expect(bandOf(10, 17)).toBe("easy");
    expect(bandOf(7, 8)).toBe("easy");
    expect(bandOf(6, 17)).toBe("medium");
    expect(bandOf(12, 17)).toBe("medium");
    expect(bandOf(13, 17)).toBe("hard");
    expect(bandOf(17, 20)).toBe("easy");
  });

  it("filters by table, range and band", () => {
    const t17 = filterFacts(stageFacts(1), { table: 17 });
    expect(t17).toHaveLength(20);
    expect(t17.every((x) => x.a === 17 || x.b === 17)).toBe(true);
    const r = filterFacts(stageFacts(1), { range: { min: 11, max: 15 } });
    expect(r).toHaveLength(15);
  });

  it("parses keys strictly and keeps orientation in questions", () => {
    expect(parseFactKey("7x12")).toEqual({ a: 7, b: 12 });
    expect(parseFactKey("12x7")).toBeNull();
    expect(parseFactKey("0x3")).toBeNull();
    expect(parseFactKey("ax3")).toBeNull();
    const q = toQuestion(makeFact(7, 12), false);
    expect([q.left, q.right, q.product]).toEqual([12, 7, 84]);
  });
});
