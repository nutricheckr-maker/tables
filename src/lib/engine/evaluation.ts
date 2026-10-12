import type { Settings } from "./config";
import { missesInLast, recentAccuracy } from "./stats";
import type { ErrorKind, Fact, FactRecord } from "./types";

export type ParsedAnswer = { ok: true; value: number } | { ok: false; error: string };

/** Accepts digits with optional surrounding/grouping spaces. Rejects everything else. */
export function parseAnswer(raw: string): ParsedAnswer {
  const s = raw.replace(/[\s,_]/g, "");
  if (s === "") return { ok: false, error: "Enter a number" };
  if (!/^\d{1,6}$/.test(s)) return { ok: false, error: "Digits only" };
  return { ok: true, value: Number(s) };
}

/** Same digits in a different order, or exactly one digit different: the shape of a typing slip. */
export function looksLikeTypo(given: number, expected: number): boolean {
  const g = String(given);
  const e = String(expected);
  if (g === e) return false;
  if (g.length === e.length) {
    let diff = 0;
    for (let i = 0; i < g.length; i++) if (g[i] !== e[i]) diff++;
    if (diff === 1) return true;
    return [...g].sort().join("") === [...e].sort().join("");
  }
  return false;
}

/**
 * Careless slip vs persistent gap, judged from history *before* this attempt.
 *
 * - Fewer than 4 previous attempts → "unclassified" (not enough data).
 * - Strong record (≥ 90% over the last 5–10) and no other miss in the last 5 → "slip".
 * - Good record (≥ 80%) and the wrong answer looks like a typo → "slip".
 * - Otherwise → "gap".
 */
export function classifyError(prev: FactRecord, fact: Fact, given: number | null): ErrorKind {
  if (prev.recent.length < 4) return "unclassified";
  const acc = recentAccuracy(prev, 10) ?? 0;
  if (acc >= 0.9 && missesInLast(prev, 5) === 0) return "slip";
  if (acc >= 0.8 && given !== null && looksLikeTypo(given, fact.product)) return "slip";
  return "gap";
}

/** Response times above the idle cap are recorded as unknown, not as slow recall. */
export function effectiveMs(ms: number, s: Settings["practice"]): number | null {
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms > s.idleCapMs ? null : Math.round(ms);
}

export function speedTarget(fact: Fact, s: Settings): number {
  return s.mastery.speedTargetMs[fact.homeStage];
}
