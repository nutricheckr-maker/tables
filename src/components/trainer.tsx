"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { stageReadiness, type AssessmentRecord } from "@/lib/engine/advancement";
import type { AttemptResult } from "@/lib/engine/attempt";
import { evaluateAssessment, type AssessmentOutcome } from "@/lib/engine/assessment";
import { parseAnswer } from "@/lib/engine/evaluation";
import { factByKey } from "@/lib/engine/facts";
import { defaultRng } from "@/lib/engine/rng";
import {
  advance,
  effectiveTimeLimit,
  sessionLength,
  startSession,
  stopSession,
  submitAnswer,
  summarize,
  type SessionConfig,
  type SessionState,
  type SessionSummary,
} from "@/lib/engine/session";
import type { Fact, Question, StageId } from "@/lib/engine/types";
import type { AppStore } from "@/lib/store/app-store";
import { useNow } from "@/lib/store/use-now";
import { fmtMs, fmtPct, MODE_LABEL, stageLabel } from "@/lib/format";
import { Button, Kbd } from "./ui";

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

type Phase = "answering" | "feedback" | "done";

interface Feedback {
  question: Question;
  given: number | null;
  result: AttemptResult;
  timedOut: boolean;
}

interface Props {
  store: AppStore;
  config: SessionConfig;
  plan: Fact[] | null;
  /** Assessment only: whether the other advancement checks were met at start. */
  qualified: boolean;
  onRestart: () => void;
  onExit: () => void;
}

export function Trainer({ store, config, plan, qualified, onRestart, onExit }: Props) {
  const settings = store.state.settings;
  const [session, setSessionState] = useState<SessionState>(() =>
    startSession(newId(), config, store.state.facts, settings, Date.now(), defaultRng, plan),
  );
  const sessionRef = useRef(session);
  const setSession = useCallback((s: SessionState) => {
    sessionRef.current = s;
    setSessionState(s);
  }, []);

  const [phase, setPhase] = useState<Phase>(session.done ? "done" : "answering");
  const [input, setInput] = useState("");
  const [hint, setHint] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [summary, setSummary] = useState<SessionSummary | null>(null);
  const [outcome, setOutcome] = useState<AssessmentOutcome | null>(null);
  const shownAt = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = useCallback(
    (final: SessionState) => {
      if (final.answers.length === 0 && final.endReason === "stopped") {
        onExit();
        return;
      }
      const now = Date.now();
      const sum = summarize(final, now);
      store.recordSession(sum);
      if (final.config.mode === "assessment" && final.endReason === "complete") {
        const answers = final.answers.map((a) => ({ fact: factByKey(a.question.key), ok: a.ok, ms: a.ms }));
        const out = evaluateAssessment(final.config.stage, answers, store.state.settings);
        const rec: AssessmentRecord = {
          id: final.id,
          stage: final.config.stage,
          at: now,
          questions: out.questions,
          correct: out.correct,
          accuracy: out.accuracy,
          bandAccuracy: out.bandAccuracy,
          medianMs: out.medianMs,
          passed: out.passed,
          qualified,
          failures: out.failures,
        };
        store.recordAssessment(rec);
        setOutcome(out);
      }
      void store.flush();
      setSession(final);
      setSummary(sum);
      setPhase("done");
    },
    [store, qualified, setSession, onExit],
  );

  const next = useCallback(() => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
    advanceTimer.current = null;
    const s = advance(sessionRef.current, store.state.facts, store.state.settings, Date.now(), defaultRng);
    setInput("");
    setHint(null);
    setFeedback(null);
    if (s.done) finish(s);
    else {
      setSession(s);
      setPhase("answering");
    }
  }, [store, finish, setSession]);

  const record = useCallback(
    (given: number | null, timedOut: boolean) => {
      const s = sessionRef.current;
      if (!s.current) return;
      const ms = performance.now() - shownAt.current;
      const out = submitAnswer(s, store.state.facts, store.state.settings, { given, ms, timedOut }, Date.now());
      store.commitRecord(out.record);
      setSession(out.state);
      setFeedback({ question: s.current.question, given, result: out.result, timedOut });
      setPhase("feedback");
      setInput("");
      const delay = store.state.settings.practice.autoAdvanceMs;
      if (out.result.ok) {
        if (delay === 0) next();
        else advanceTimer.current = setTimeout(next, delay);
      }
    },
    [store, next, setSession],
  );

  // Start the clock and focus the field whenever a new question appears.
  const qKey = session.current ? `${session.history.length}` : null;
  useEffect(() => {
    if (qKey === null) return;
    shownAt.current = performance.now();
    inputRef.current?.focus();
  }, [qKey]);

  // Optional time limit (Speed Training only).
  const { limitMs, relaxed } = effectiveTimeLimit(session);
  useEffect(() => {
    if (phase !== "answering" || limitMs === null || qKey === null) return;
    const t = setTimeout(() => record(null, true), limitMs);
    return () => clearTimeout(t);
  }, [phase, limitMs, qKey, record]);

  // Distraction-free: hide the site navigation while a session runs.
  useEffect(() => {
    if (phase === "done") delete document.body.dataset.focus;
    else document.body.dataset.focus = "1";
    return () => {
      delete document.body.dataset.focus;
    };
  }, [phase]);

  useEffect(() => () => {
    if (advanceTimer.current) clearTimeout(advanceTimer.current);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || phase === "done") return;
      e.preventDefault();
      if (advanceTimer.current) clearTimeout(advanceTimer.current);
      finish(stopSession(sessionRef.current));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, finish]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (phase === "answering") {
      const parsed = parseAnswer(input);
      if (!parsed.ok) {
        setHint(parsed.error);
        return;
      }
      record(parsed.value, false);
      return;
    }
    if (phase === "feedback" && feedback) {
      const needsCorrection = !feedback.result.ok && store.state.settings.practice.requireCorrection;
      if (needsCorrection) {
        const parsed = parseAnswer(input);
        if (!parsed.ok || parsed.value !== feedback.result.expected) {
          setHint(`Type ${feedback.result.expected} to continue`);
          return;
        }
      }
      next();
    }
  };

  if (phase === "done" || session.done) {
    return (
      <SessionEnd
        store={store}
        session={session}
        summary={summary}
        outcome={outcome}
        qualified={qualified}
        onRestart={onRestart}
        onExit={onExit}
      />
    );
  }

  const total = sessionLength(session);
  const answered = session.answers.length;
  const correct = session.answers.filter((a) => a.ok).length;
  const q = phase === "feedback" && feedback ? feedback.question : session.current?.question;
  const reason = session.current?.reason;
  const wrong = phase === "feedback" && feedback && !feedback.result.ok;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex h-14 items-center gap-4 text-xs text-muted">
        <span className="font-medium text-ink">{MODE_LABEL[config.mode]}</span>
        <span className="hidden sm:inline">{stageLabel(config.stage)}</span>
        <span className="ml-auto font-mono">
          {answered}/{total}
        </span>
        {answered > 0 && <span className="font-mono">{fmtPct(correct / answered)}</span>}
        <button type="button" onClick={() => finish(stopSession(sessionRef.current))} className="hover:text-ink">
          End <Kbd>Esc</Kbd>
        </button>
      </div>
      <div className="h-[2px] w-full bg-line" aria-hidden>
        <div className="h-full bg-ink" style={{ width: `${(answered / total) * 100}%` }} />
      </div>

      <div className="flex flex-1 flex-col items-center justify-center py-12">
        {q && (
          <form onSubmit={onSubmit} className="flex w-full flex-col items-center" autoComplete="off">
            <div className="h-5 text-xs uppercase tracking-[0.14em] text-faint">
              {phase === "answering" && reason === "new" ? "new fact" : phase === "answering" && reason === "relearn" ? "again" : ""}
            </div>
            <h1 className="mt-2 font-mono text-6xl font-semibold tracking-tight sm:text-8xl" aria-live="off">
              <span className="sr-only">What is </span>
              {q.left} <span className="text-faint">×</span> {q.right}
            </h1>
            <label htmlFor="answer" className="sr-only">
              Answer
            </label>
            <input
              id="answer"
              ref={inputRef}
              value={phase === "feedback" && feedback?.result.ok ? String(feedback.given) : input}
              onChange={(e) => {
                setHint(null);
                setInput(e.target.value.replace(/[^\d\s]/g, "").slice(0, 7));
              }}
              readOnly={phase === "feedback" && !wrong}
              inputMode="numeric"
              enterKeyHint="go"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder={wrong && store.state.settings.practice.requireCorrection ? String(feedback.result.expected) : "?"}
              aria-invalid={hint ? true : undefined}
              aria-describedby="feedback"
              className={`mt-8 w-[6ch] border-b-2 bg-transparent pb-1 focus-visible:outline-none text-center font-mono text-5xl font-semibold outline-none placeholder:text-line-strong sm:text-6xl ${
                phase === "feedback" ? (wrong ? "border-bad" : "border-good text-good") : "border-ink focus:border-accent"
              }`}
            />
            {limitMs !== null && phase === "answering" && (
              <div className="mt-4 h-[2px] w-40 overflow-hidden bg-line" aria-hidden>
                <div
                  key={qKey}
                  className="h-full origin-left bg-muted"
                  style={{ animation: `countdown ${limitMs}ms linear forwards` }}
                />
              </div>
            )}
            <div id="feedback" role="status" className="mt-6 min-h-16 text-center text-sm">
              {phase === "answering" && hint && <span className="text-bad">{hint}</span>}
              {phase === "feedback" && feedback && feedback.result.ok && (
                <span className="text-good">
                  ✓ Correct <span className="font-mono text-muted">· {fmtMs(feedback.result.ms)}</span>
                </span>
              )}
              {wrong && feedback && (
                <div>
                  <div className="text-bad">
                    ✗ {feedback.timedOut ? "Time’s up" : `You answered ${feedback.given}`}
                    {feedback.result.errorKind === "slip" && <span className="text-muted"> · looks like a slip</span>}
                  </div>
                  <div className="mt-1 font-mono text-2xl font-semibold text-ink">
                    {feedback.question.left} × {feedback.question.right} = {feedback.result.expected}
                  </div>
                  <div className="mt-2 text-xs text-muted">
                    {hint ?? (store.state.settings.practice.requireCorrection ? "Type the answer, then Enter" : "Enter to continue")}
                  </div>
                </div>
              )}
              {relaxed && phase === "answering" && (
                <div className="mt-2 text-xs text-muted">Accuracy first — time limit relaxed until accuracy is back above 90%.</div>
              )}
            </div>
          </form>
        )}
      </div>
      <p className="pb-4 text-center text-xs text-faint">
        <Kbd>Enter</Kbd> submit / continue · <Kbd>Esc</Kbd> end session
      </p>
    </div>
  );
}

function SessionEnd({
  store,
  session,
  summary,
  outcome,
  qualified,
  onRestart,
  onExit,
}: {
  store: AppStore;
  session: SessionState;
  summary: SessionSummary | null;
  outcome: AssessmentOutcome | null;
  qualified: boolean;
  onRestart: () => void;
  onExit: () => void;
}) {
  const [unlocked, setUnlocked] = useState<StageId | null>(null);
  const againRef = useRef<HTMLButtonElement>(null);
  useEffect(() => againRef.current?.focus(), []);

  const missed = new Map<string, { q: Question; given: number | null; times: number }>();
  for (const a of session.answers) {
    if (a.ok) continue;
    const cur = missed.get(a.question.key);
    missed.set(a.question.key, { q: a.question, given: a.given, times: (cur?.times ?? 0) + 1 });
  }

  const now = useNow();
  const s = store.state;
  const readiness =
    outcome && session.config.stage === s.progress.unlockedStage
      ? stageReadiness(session.config.stage, s.facts, s.settings, now, s.assessments)
      : null;

  if (session.answers.length === 0) {
    const msg: Record<string, string> = {
      speed: "Speed training uses facts you have already practised. Do some mixed recall first.",
      weakness: "Nothing to eliminate right now: no weak, slow or due facts in this stage.",
    };
    return (
      <div className="mt-16 max-w-lg">
        <h1 className="text-2xl font-semibold">Nothing to practise</h1>
        <p className="mt-2 text-muted">{msg[session.config.mode] ?? "No facts match this selection."}</p>
        <div className="mt-6 flex gap-3">
          <Button variant="primary" onClick={onExit}>
            Back
          </Button>
          <Link href="/" className="inline-flex h-10 items-center px-4 text-sm text-muted hover:text-ink">
            Dashboard
          </Link>
        </div>
      </div>
    );
  }

  const acc = summary && summary.questions ? summary.correct / summary.questions : null;
  return (
    <div className="mt-12 max-w-2xl">
      <p className="text-xs uppercase tracking-[0.14em] text-muted">
        {MODE_LABEL[session.config.mode]} · {session.endReason === "stopped" ? "ended early" : "complete"}
      </p>
      {outcome ? (
        <h1 className={`mt-2 text-3xl font-semibold ${outcome.passed ? "text-good" : ""}`}>
          {outcome.passed ? (qualified ? "Assessment passed" : "Passed — practice run") : "Not yet"}
        </h1>
      ) : (
        <h1 className="mt-2 text-3xl font-semibold">Session complete</h1>
      )}

      <dl className="mt-6 grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-line bg-surface px-4 py-3">
          <dt className="text-xs text-muted">Answered</dt>
          <dd className="font-mono text-2xl font-semibold">{summary?.questions ?? 0}</dd>
        </div>
        <div className="rounded-lg border border-line bg-surface px-4 py-3">
          <dt className="text-xs text-muted">Accuracy</dt>
          <dd className="font-mono text-2xl font-semibold">{fmtPct(acc)}</dd>
        </div>
        <div className="rounded-lg border border-line bg-surface px-4 py-3">
          <dt className="text-xs text-muted">Median time</dt>
          <dd className="font-mono text-2xl font-semibold">{fmtMs(summary?.medianMs)}</dd>
        </div>
      </dl>

      {outcome && (
        <div className="mt-6 rounded-lg border border-line bg-surface p-4 text-sm">
          <div className="flex flex-wrap gap-x-6 gap-y-1">
            {(["easy", "medium", "hard"] as const).map((b) =>
              outcome.bandAccuracy[b] !== undefined ? (
                <span key={b}>
                  <span className="text-muted">{b}</span> <span className="font-mono">{fmtPct(outcome.bandAccuracy[b])}</span>
                </span>
              ) : null,
            )}
          </div>
          {outcome.failures.length > 0 && (
            <ul className="mt-3 list-inside list-disc text-bad">
              {outcome.failures.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          {outcome.passed && !qualified && (
            <p className="mt-3 text-muted">
              This run was taken before the other stage requirements were met, so it does not unlock the next stage.
              Retake it once the checklist on the dashboard is complete.
            </p>
          )}
          {readiness?.canAdvance && !unlocked && (
            <div className="mt-4">
              <Button
                variant="primary"
                onClick={() => {
                  const r = store.advanceStage(Date.now());
                  if (r.ok) setUnlocked(r.stage);
                }}
              >
                Unlock Stage {session.config.stage + 1}
              </Button>
            </div>
          )}
          {unlocked && <p className="mt-4 font-medium text-good">{stageLabel(unlocked)} unlocked.</p>}
        </div>
      )}

      {missed.size > 0 && (
        <div className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Missed — scheduled for review</h2>
          <ul className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm sm:grid-cols-3">
            {[...missed.values()].map(({ q, given, times }) => (
              <li key={q.key}>
                {q.left} × {q.right} = <span className="font-semibold">{q.product}</span>
                <span className="text-faint">
                  {" "}
                  ({given ?? "—"}
                  {times > 1 ? ` ×${times}` : ""})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8 flex flex-wrap gap-3">
        <Button ref={againRef} variant="primary" onClick={onRestart}>
          Again <Kbd>Enter</Kbd>
        </Button>
        <Button onClick={onExit}>Change mode</Button>
        <Link href="/" className="inline-flex h-10 items-center px-4 text-sm text-muted hover:text-ink">
          Dashboard
        </Link>
      </div>
    </div>
  );
}
