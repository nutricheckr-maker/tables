import { stageConfig } from "./engine/config";
import type { Mode, StageId } from "./engine/types";

export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

export function fmtPct(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return `${Math.round(x * 100)}%`;
}

export function stageLabel(id: StageId): string {
  const max = stageConfig(id).max;
  return `Stage ${id} · 1–${max}`;
}

export const MODE_LABEL: Record<Mode, string> = {
  mixed: "Mixed recall",
  focused: "Focused practice",
  speed: "Speed training",
  weakness: "Weakness elimination",
  assessment: "Mastery assessment",
  gate: "Gate challenge",
};

export function fmtRelative(ts: number | null, now: number): string {
  if (ts === null) return "—";
  const diff = ts - now;
  const abs = Math.abs(diff);
  const unit =
    abs < 60_000
      ? "now"
      : abs < 3_600_000
        ? `${Math.round(abs / 60_000)} min`
        : abs < 86_400_000
          ? `${Math.round(abs / 3_600_000)} h`
          : `${Math.round(abs / 86_400_000)} d`;
  if (unit === "now") return "now";
  return diff > 0 ? `in ${unit}` : `${unit} ago`;
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}
