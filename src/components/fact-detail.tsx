import type { Settings } from "@/lib/engine/config";
import { speedTarget } from "@/lib/engine/evaluation";
import { factStatus, masteryChecks, weakReasons, type WeakReason } from "@/lib/engine/mastery";
import { recentAccuracy, typicalMs } from "@/lib/engine/stats";
import type { Fact, FactRecord } from "@/lib/engine/types";
import { fmtMs, fmtPct, fmtRelative } from "@/lib/format";
import { STATUS_LABEL, StatusSwatch } from "./heatmap";

export const WEAK_REASON_LABEL: Record<WeakReason, string> = {
  misses: "repeated misses",
  lapse: "forgotten after a delay",
  slow: "slow recall",
};

export function FactDetail({
  fact,
  shown,
  record,
  settings,
  now,
}: {
  fact: Fact;
  shown: [number, number];
  record: FactRecord | undefined;
  settings: Settings;
  now: number;
}) {
  const status = factStatus(record, fact, settings);
  const checks = masteryChecks(record, fact, settings);
  const reasons = weakReasons(record, fact, settings);
  const m = settings.mastery;
  const rows: [string, boolean, string][] = record
    ? [
        [`${m.minAttempts}+ attempts`, checks.attempts, String(record.attempts)],
        [`${fmtPct(m.accuracy)} recent accuracy`, checks.accuracy, fmtPct(recentAccuracy(record))],
        ["Last answer correct", checks.lastCorrect, record.recent.at(-1)?.ok ? "yes" : "no"],
        [`Correct in ${m.minCorrectSessions}+ sessions`, checks.sessions, String(record.correctSessions)],
        [`${m.minSpacedSuccesses}+ recalls after ${m.retentionGapHours}h`, checks.spaced, String(record.spacedSuccesses)],
        [`Median ≤ ${fmtMs(speedTarget(fact, settings))}`, checks.speed, fmtMs(typicalMs(record))],
      ]
    : [];

  return (
    <div className="rounded-lg border border-line bg-surface p-4" aria-live="polite">
      <div className="font-mono text-2xl font-semibold">
        {shown[0]} × {shown[1]} = {fact.product}
      </div>
      <div className="mt-1 flex items-center gap-2 text-sm">
        <StatusSwatch status={status} />
        {STATUS_LABEL[status]}
        <span className="text-faint">· {fact.band}</span>
      </div>
      {reasons.length > 0 && (
        <p className="mt-2 text-sm text-bad">Weak: {reasons.map((r) => WEAK_REASON_LABEL[r]).join(", ")}</p>
      )}
      {record ? (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-y-1 text-sm">
            <dt className="text-muted">Next review</dt>
            <dd className="text-right font-mono">{fmtRelative(record.dueAt, now)}</dd>
            <dt className="text-muted">Last practised</dt>
            <dd className="text-right font-mono">{fmtRelative(record.lastPractisedAt, now)}</dd>
            <dt className="text-muted">Correct / wrong</dt>
            <dd className="text-right font-mono">
              {record.correct} / {record.incorrect}
            </dd>
            <dt className="text-muted">Slips · gaps · lapses</dt>
            <dd className="text-right font-mono">
              {record.slips} · {record.gaps} · {record.lapses}
            </dd>
            <dt className="text-muted">Review level</dt>
            <dd className="text-right font-mono">{record.level}</dd>
          </dl>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-muted">Mastery checks</h3>
          <ul className="mt-2 space-y-1 text-sm">
            {rows.map(([label, ok, value]) => (
              <li key={label} className="flex items-center justify-between gap-3">
                <span>
                  <span aria-hidden className={ok ? "text-good" : "text-faint"}>
                    {ok ? "✓" : "○"}
                  </span>{" "}
                  {label}
                  <span className="sr-only">{ok ? " — met" : " — not met"}</span>
                </span>
                <span className="font-mono text-muted">{value}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted">Not practised yet.</p>
      )}
    </div>
  );
}
