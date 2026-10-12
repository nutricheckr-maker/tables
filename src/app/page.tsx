"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { accuracyByDay, overview } from "@/lib/engine/analytics";
import { stageReadiness } from "@/lib/engine/advancement";
import { STAGES } from "@/lib/engine/config";
import type { FactStatus, StageId } from "@/lib/engine/types";
import { useApp } from "@/lib/store/use-app";
import { useNow } from "@/lib/store/use-now";
import { fmtDate, fmtMs, fmtPct, MODE_LABEL, stageLabel } from "@/lib/format";
import { AccuracyChart } from "@/components/accuracy-chart";
import { WEAK_REASON_LABEL } from "@/components/fact-detail";
import { Heatmap, STATUS_CELL, STATUS_LABEL, StatusSwatch } from "@/components/heatmap";
import { ReadinessList } from "@/components/readiness";
import { Button, Kbd, Loading, Section, Stat } from "@/components/ui";

/** React's autoFocus ignores links; focus the primary action so Enter starts practice. */
function focusOnMount(el: HTMLAnchorElement | null) {
  if (el && document.activeElement === document.body) el.focus({ preventScroll: true });
}

const ORDER: FactStatus[] = ["mastered", "developing", "weak", "unpractised"];

export default function Dashboard() {
  const { snap, store } = useApp();
  const now = useNow();
  const [viewStage, setViewStage] = useState<StageId | null>(null);
  const [justUnlocked, setJustUnlocked] = useState<StageId | null>(null);

  const state = snap?.state;
  const unlocked = state?.progress.unlockedStage ?? 1;
  const ov = useMemo(() => (state ? overview(unlocked, state.facts, state.settings, now) : null), [state, unlocked, now]);
  const readiness = useMemo(
    () => (state ? stageReadiness(unlocked, state.facts, state.settings, now, state.assessments) : null),
    [state, unlocked, now],
  );
  const days = useMemo(() => (state ? accuracyByDay(state.sessions) : []), [state]);

  if (!snap || !store || !state || !ov || !readiness) return <Loading />;

  const week = state.sessions.filter((s) => s.startedAt > now - 7 * 86_400_000);
  const weekQ = week.reduce((n, s) => n + s.questions, 0);
  const weekC = week.reduce((n, s) => n + s.correct, 0);
  const isNew = state.sessions.length === 0;
  const hmStage = viewStage ?? unlocked;

  return (
    <div>
      {(snap.notices.length > 0 || snap.saveError) && (
        <div role="alert" className="mt-6 rounded-lg border border-bad p-3 text-sm">
          {snap.saveError && <p className="text-bad">{snap.saveError}</p>}
          {snap.notices.map((n) => (
            <p key={n}>{n}</p>
          ))}
          {snap.notices.length > 0 && (
            <button type="button" className="mt-1 text-xs text-muted underline" onClick={() => store.dismissNotices()}>
              Dismiss
            </button>
          )}
        </div>
      )}

      <div className="mt-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.14em] text-muted">Current stage</p>
          <h1 className="mt-1 font-mono text-3xl font-semibold tracking-tight sm:text-4xl">{stageLabel(unlocked)}</h1>
          <p className="mt-1 text-sm text-muted">
            {ov.counts.mastered} of {ov.total} facts mastered · both factors 1–{STAGES[unlocked - 1]!.max}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/train?mode=mixed&start=1"
            ref={focusOnMount}
            className="inline-flex h-12 items-center gap-2 rounded-md bg-ink px-6 text-base font-medium text-bg hover:opacity-90"
          >
            {isNew ? "Start practising" : "Practise now"} <Kbd>Enter</Kbd>
          </Link>
          <Link
            href="/train"
            className="inline-flex h-12 items-center rounded-md border border-line-strong bg-surface px-4 text-sm font-medium hover:border-ink"
          >
            Other modes
          </Link>
        </div>
      </div>

      <ProgressBar counts={ov.counts} total={ov.total} />

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Practised" value={ov.practised} sub={`of ${ov.total} facts`} />
        <Stat
          label="Due for review"
          value={ov.due}
          sub={ov.due > 0 ? <Link href="/train?mode=mixed&start=1" className="underline">review now</Link> : "nothing due"}
        />
        <Stat label="Median response" value={fmtMs(ov.medianMs)} sub={`mean ${fmtMs(ov.meanMs)} · correct answers`} />
        <Stat label="Accuracy, 7 days" value={fmtPct(weekQ ? weekC / weekQ : null)} sub={`${weekQ} answers`} />
      </div>

      {isNew && (
        <div className="mt-8 rounded-lg border border-line bg-surface p-5 text-sm leading-relaxed">
          <p className="font-medium">How this works</p>
          <p className="mt-1 text-muted">
            Press <Kbd>Enter</Kbd> to begin. Facts are introduced a few at a time, easiest first; facts you already
            know quickly move to long review intervals. A fact counts as mastered only after accurate, fast answers
            across several sessions, including recall after a day or more away. Untimed modes never penalise you for
            taking your time.
          </p>
        </div>
      )}

      <Section
        title={readiness.isFinalStage ? "Final stage — mastery checklist" : `Path to Stage ${unlocked + 1}`}
        id="path"
      >
        <ReadinessList readiness={readiness} />
        {readiness.canAdvance && !justUnlocked && (
          <Button
            variant="primary"
            className="mt-3"
            onClick={() => {
              const r = store.advanceStage(Date.now());
              if (r.ok) setJustUnlocked(r.stage);
            }}
          >
            Unlock {stageLabel((unlocked + 1) as StageId)}
          </Button>
        )}
        {justUnlocked && <p className="mt-3 text-sm font-medium text-good">{stageLabel(justUnlocked)} unlocked.</p>}
        {readiness.weakFacts.length > 0 && (
          <p className="mt-3 text-sm text-muted">
            Weak:{" "}
            <span className="font-mono text-ink">
              {readiness.weakFacts
                .slice(0, 12)
                .map((f) => `${f.a}×${f.b}`)
                .join("  ")}
              {readiness.weakFacts.length > 12 ? `  +${readiness.weakFacts.length - 12}` : ""}
            </span>{" "}
            · <Link href="/train?mode=weakness&start=1" className="underline">eliminate</Link>
          </p>
        )}
      </Section>

      <Section
        title="Heatmap"
        id="heatmap"
        aside={
          unlocked > 1 ? (
            <div className="flex gap-1 text-xs" role="tablist" aria-label="Stage">
              {STAGES.filter((s) => s.id <= unlocked).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="tab"
                  aria-selected={hmStage === s.id}
                  onClick={() => setViewStage(s.id)}
                  className="rounded px-2 py-1 text-muted aria-selected:bg-ink aria-selected:text-bg"
                >
                  1–{s.max}
                </button>
              ))}
            </div>
          ) : null
        }
      >
        <Heatmap stage={hmStage} records={state.facts} settings={state.settings} now={now} />
      </Section>

      <div className="grid gap-x-10 lg:grid-cols-2">
        <Section
          title="Weakest facts"
          id="weakest"
          aside={
            ov.weakest.length > 0 ? (
              <Link href="/train?mode=weakness&start=1" className="text-xs text-muted underline hover:text-ink">
                Drill these
              </Link>
            ) : null
          }
        >
          {ov.weakest.length === 0 ? (
            <p className="text-sm text-muted">No weaknesses recorded yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1 font-normal">Fact</th>
                  <th className="py-1 font-normal">State</th>
                  <th className="py-1 text-right font-normal">Recent</th>
                  <th className="py-1 text-right font-normal">Typical</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ov.weakest.map((r) => (
                  <tr key={r.fact.key}>
                    <td className="py-1.5 font-mono">
                      {r.fact.a} × {r.fact.b} <span className="text-faint">= {r.fact.product}</span>
                    </td>
                    <td className="py-1.5">
                      <span className="flex items-center gap-1.5">
                        <StatusSwatch status={r.status} />
                        <span className="text-xs text-muted">
                          {r.reasons.length ? r.reasons.map((x) => WEAK_REASON_LABEL[x]).join(", ") : STATUS_LABEL[r.status]}
                        </span>
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-mono">{fmtPct(r.accuracy)}</td>
                    <td className="py-1.5 text-right font-mono">{fmtMs(r.typicalMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Accuracy over time" id="accuracy">
          <AccuracyChart data={days} />
        </Section>
      </div>

      <Section title="Recent sessions" id="sessions">
        {state.sessions.length === 0 ? (
          <p className="text-sm text-muted">No sessions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1 font-normal">When</th>
                  <th className="py-1 font-normal">Mode</th>
                  <th className="py-1 text-right font-normal">Answers</th>
                  <th className="py-1 text-right font-normal">Accuracy</th>
                  <th className="py-1 text-right font-normal">Median</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {state.sessions
                  .slice(-10)
                  .reverse()
                  .map((s) => {
                    const a = state.assessments.find((x) => x.id === s.id);
                    return (
                      <tr key={s.id}>
                        <td className="py-1.5 text-muted">{fmtDate(s.startedAt)}</td>
                        <td className="py-1.5">
                          {MODE_LABEL[s.mode]}
                          {s.focus ? <span className="text-faint"> · {s.focus}</span> : null}
                          {a ? (
                            <span className={a.passed ? "text-good" : "text-bad"}>
                              {" "}
                              · {a.passed ? (a.qualified ? "passed" : "passed (practice)") : "not passed"}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-1.5 text-right font-mono">{s.questions}</td>
                        <td className="py-1.5 text-right font-mono">{fmtPct(s.correct / s.questions)}</td>
                        <td className="py-1.5 text-right font-mono">{fmtMs(s.medianMs)}</td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  );
}

function ProgressBar({ counts, total }: { counts: Record<FactStatus, number>; total: number }) {
  return (
    <div className="mt-6">
      <div
        className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full"
        role="img"
        aria-label={ORDER.map((s) => `${counts[s]} ${STATUS_LABEL[s].toLowerCase()}`).join(", ")}
      >
        {ORDER.filter((s) => counts[s] > 0).map((s) => (
          <div key={s} className={`h-full ${STATUS_CELL[s]}`} style={{ width: `${(counts[s] / total) * 100}%` }} />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
        {ORDER.map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <StatusSwatch status={s} /> {STATUS_LABEL[s]} <span className="font-mono text-faint">{counts[s]}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
