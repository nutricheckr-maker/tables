"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { parseAnswer } from "@/lib/engine/evaluation";
import { APPS, GATE, isProtectedApp, type AppInfo } from "@/lib/gate/policy";
import type { GateResult } from "@/lib/gate/challenge";
import type { GateStatus, StartedChallenge } from "@/lib/gate/state";
import { applyAttempt } from "@/lib/engine/attempt";
import { makeFact } from "@/lib/engine/facts";
import { emptyRecord, mean, median } from "@/lib/engine/stats";
import type { AppStore } from "@/lib/store/app-store";
import { useApp } from "@/lib/store/use-app";
import Link from "next/link";
import { Button, Kbd, Loading } from "@/components/ui";

type Phase =
  | { kind: "intro" }
  | {
      kind: "running";
      ch: StartedChallenge;
      index: number;
      answers: (number | null)[];
      /** Per-question response times, for the learning record only (the server times the gate). */
      times: number[];
      startedAt: number;
    }
  | { kind: "submitting" }
  | { kind: "result"; result: GateResult; grantedUntil: number | null }
  | { kind: "error"; message: string; needsPractice?: boolean };

/** Only ever continue to the app's own origin. */
function continueUrl(app: AppInfo | null, next: string | null): string | null {
  if (!app) return null;
  if (next) {
    try {
      const u = new URL(next);
      if (u.origin === new URL(app.url).origin) return u.toString();
    } catch {
      // fall through to the default
    }
  }
  return app.url;
}

export default function GatePage() {
  return (
    <Suspense fallback={<Loading />}>
      <Gate />
    </Suspense>
  );
}

function Gate() {
  const search = useSearchParams();
  const appId = search.get("app");
  const app = isProtectedApp(appId) ? APPS[appId] : null;
  const target = continueUrl(app, search.get("next"));
  const [status, setStatus] = useState<GateStatus | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "intro" });

  const refresh = useCallback(
    () =>
      fetch("/api/gate/status", { cache: "no-store" })
        .then((r) => r.json())
        .then(setStatus, () => setStatus(null)),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const { store } = useApp();

  const start = useCallback(async () => {
    try {
      // Make sure the service has this browser's latest progress before it picks facts.
      await store?.flush();
      const r = await fetch("/api/gate/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const body = await r.json();
      if (!r.ok) {
        setPhase({ kind: "error", message: body.error ?? r.statusText, needsPractice: r.status === 409 });
        return;
      }
      const ch: StartedChallenge = body;
      setPhase({ kind: "running", ch, index: 0, answers: [], times: [], startedAt: performance.now() });
    } catch (e) {
      setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, [store]);

  const submit = useCallback(
    async (ch: StartedChallenge, answers: (number | null)[], times: number[], startedAt: number) => {
      setPhase({ kind: "submitting" });
      try {
        const r = await fetch("/api/gate/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: ch.id, answers }),
        });
        const out = await r.json();
        if (!out.ok) throw new Error(out.error ?? "Submission refused");
        setPhase({ kind: "result", result: out.result, grantedUntil: out.grantedUntil });
        if (store) recordPractice(store, ch, out.result, answers.length, times, startedAt);
        void refresh();
      } catch (e) {
        setPhase({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    },
    [refresh, store],
  );

  // Distraction-free while the clock runs.
  const running = phase.kind === "running";
  useEffect(() => {
    if (running) document.body.dataset.focus = "1";
    else delete document.body.dataset.focus;
    return () => {
      delete document.body.dataset.focus;
    };
  }, [running]);

  return (
    <div className="mx-auto mt-12 w-full max-w-xl">
      {phase.kind === "intro" && (
        <Intro app={app} status={status} target={target} onStart={start} onLocked={refresh} />
      )}
      {phase.kind === "running" && (
        <Run
          phase={phase}
          onAnswer={(value, ms) => {
            const answers = [...phase.answers, value];
            const times = [...phase.times, ms];
            if (answers.length >= phase.ch.questions.length) void submit(phase.ch, answers, times, phase.startedAt);
            else setPhase({ ...phase, index: phase.index + 1, answers, times });
          }}
          onTimeout={() => void submit(phase.ch, phase.answers, phase.times, phase.startedAt)}
        />
      )}
      {phase.kind === "submitting" && <p className="text-sm text-muted">Checking…</p>}
      {phase.kind === "result" && (
        <Result result={phase.result} grantedUntil={phase.grantedUntil} app={app} target={target} onRetry={start} />
      )}
      {phase.kind === "error" && (
        <div>
          <p role="alert" className={phase.needsPractice ? "" : "text-bad"}>
            {phase.message}
          </p>
          <div className="mt-4 flex gap-3">
            {phase.needsPractice ? (
              <Link href="/train?mode=mixed&start=1" className="inline-flex h-10 items-center rounded-md bg-ink px-4 text-sm font-medium text-bg">
                Practise now
              </Link>
            ) : null}
            <Button variant={phase.needsPractice ? "secondary" : "primary"} onClick={start}>
              Try again
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Focus the primary button whenever it (re)appears, so Enter always does the obvious thing. */
function useEnterFocus(key: unknown) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => ref.current?.focus(), [key]);
  return ref;
}

function Intro({
  app,
  status,
  target,
  onStart,
  onLocked,
}: {
  app: AppInfo | null;
  status: GateStatus | null;
  target: string | null;
  onStart: () => void;
  onLocked: () => void;
}) {
  const startRef = useEnterFocus(status?.granted);
  const minutes = status?.granted ? Math.ceil(status.remainingMs / 60_000) : 0;
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.14em] text-muted">Mental-math gate</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">{app ? `Unlock ${app.label}` : "Unlock protected apps"}</h1>
      <p className="mt-3 text-muted">
        {GATE.questions} questions from facts you have already practised, {GATE.timeLimitMs / 1000} seconds for the
        whole set, at least {GATE.passCorrect} correct. A pass opens ChatGPT, Gemini and Stream for {GATE.grantMs / 60_000} minutes; sleep, restart or a new
        login locks them again.
      </p>
      {status?.granted ? (
        <div className="mt-6 rounded-lg border border-line bg-surface p-4 text-sm">
          <p className="text-good">Open — {minutes} min left.</p>
          <div className="mt-3 flex flex-wrap gap-3">
            {target && (
              <a href={target} className="inline-flex h-10 items-center rounded-md bg-ink px-4 text-sm font-medium text-bg">
                Continue to {app?.label}
              </a>
            )}
            <Button
              onClick={async () => {
                await fetch("/api/gate/revoke", { method: "POST" });
                onLocked();
              }}
            >
              Lock now
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-8">
          <Button ref={startRef} variant="primary" className="h-12 px-6 text-base" onClick={onStart}>
            Start — clock begins now <Kbd>Enter</Kbd>
          </Button>
          <p className="mt-3 text-xs text-faint">Your answers also count as practice in the trainer.</p>
        </div>
      )}
    </div>
  );
}

function Run({
  phase,
  onAnswer,
  onTimeout,
}: {
  phase: Extract<Phase, { kind: "running" }>;
  onAnswer: (v: number | null, ms: number) => void;
  onTimeout: () => void;
}) {
  const { ch, index, startedAt } = phase;
  const [input, setInput] = useState("");
  const [left, setLeft] = useState(ch.limitMs);
  const inputRef = useRef<HTMLInputElement>(null);
  const q = ch.questions[index]!;

  // Each question's clock starts when it appears.
  const shownAt = useRef(0);
  useEffect(() => {
    shownAt.current = performance.now();
    inputRef.current?.focus();
  }, [index]);

  // Display-only countdown. The server measures the real elapsed time.
  const timeoutRef = useRef(onTimeout);
  useEffect(() => {
    timeoutRef.current = onTimeout;
  });
  useEffect(() => {
    const t = setInterval(() => {
      const remaining = ch.limitMs - (performance.now() - startedAt);
      setLeft(remaining);
      if (remaining < -500) {
        clearInterval(t);
        timeoutRef.current();
      }
    }, 100);
    return () => clearInterval(t);
  }, [ch.limitMs, startedAt]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const p = parseAnswer(input);
    setInput("");
    onAnswer(p.ok ? p.value : null, performance.now() - shownAt.current);
  };

  return (
    <form onSubmit={onSubmit} className="flex flex-col items-center" autoComplete="off">
      <div className="flex w-full justify-between font-mono text-sm text-muted">
        <span>
          {index + 1}/{ch.questions.length}
        </span>
        <span className={left < 10_000 ? "text-bad" : ""} aria-live="off">
          {Math.max(0, left / 1000).toFixed(1)}s
        </span>
      </div>
      <div className="mt-2 h-[2px] w-full bg-line" aria-hidden>
        <div className="h-full bg-ink" style={{ width: `${Math.max(0, left / ch.limitMs) * 100}%` }} />
      </div>
      <h1 className="mt-16 font-mono text-6xl font-semibold tracking-tight sm:text-7xl">
        <span className="sr-only">What is </span>
        {q.left} <span className="text-faint">×</span> {q.right}
      </h1>
      <label htmlFor="gate-answer" className="sr-only">
        Answer
      </label>
      <input
        id="gate-answer"
        ref={inputRef}
        value={input}
        onChange={(e) => setInput(e.target.value.replace(/[^\d]/g, "").slice(0, 6))}
        inputMode="numeric"
        enterKeyHint="next"
        autoComplete="off"
        spellCheck={false}
        placeholder="?"
        className="mt-8 w-[6ch] border-b-2 border-ink bg-transparent pb-1 text-center font-mono text-5xl font-semibold outline-none placeholder:text-line-strong focus:border-accent focus-visible:outline-none"
      />
      <p className="mt-6 text-xs text-faint">
        <Kbd>Enter</Kbd> next — no feedback until the end
      </p>
    </form>
  );
}

function Result({
  result,
  grantedUntil,
  app,
  target,
  onRetry,
}: {
  result: GateResult;
  grantedUntil: number | null;
  app: AppInfo | null;
  target: string | null;
  onRetry: () => void;
}) {
  const primary = useRef<HTMLElement>(null);
  useEffect(() => primary.current?.focus(), []);
  const granted = result.passed && grantedUntil !== null;
  return (
    <div>
      <p className="text-xs uppercase tracking-[0.14em] text-muted">Result</p>
      <h1 className={`mt-2 text-3xl font-semibold ${granted ? "text-good" : "text-bad"}`}>
        {granted ? "Access granted" : "Access denied"}
      </h1>
      <dl className="mt-6 grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-line bg-surface px-4 py-3">
          <dt className="text-xs text-muted">Score</dt>
          <dd className="font-mono text-2xl font-semibold">
            {result.correct}/{result.total}
          </dd>
        </div>
        <div className="rounded-lg border border-line bg-surface px-4 py-3">
          <dt className="text-xs text-muted">Time</dt>
          <dd className="font-mono text-2xl font-semibold">{(result.elapsedMs / 1000).toFixed(1)}s</dd>
        </div>
      </dl>
      {result.reasons.length > 0 && (
        <ul className="mt-4 list-inside list-disc text-sm text-bad">
          {result.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      {granted && (
        <p className="mt-4 text-sm text-muted">
          Open until {new Date(grantedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.
        </p>
      )}
      <ul className="mt-6 grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm">
        {result.review.map((r, i) => (
          <li key={i} className={r.ok ? "text-muted" : ""}>
            <span aria-hidden className={r.ok ? "text-good" : "text-bad"}>
              {r.ok ? "✓" : "✗"}
            </span>{" "}
            {r.left} × {r.right} = <span className="font-semibold">{r.answer}</span>
            {!r.ok && <span className="text-faint"> ({r.given ?? "—"})</span>}
          </li>
        ))}
      </ul>
      <div className="mt-8 flex gap-3">
        {granted && target ? (
          <a
            ref={primary as React.RefObject<HTMLAnchorElement>}
            href={target}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-4 text-sm font-medium text-bg"
          >
            Continue to {app?.label} <Kbd>Enter</Kbd>
          </a>
        ) : !granted ? (
          <Button ref={primary as React.RefObject<HTMLButtonElement>} variant="primary" onClick={onRetry}>
            New challenge <Kbd>Enter</Kbd>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Record the challenge as practice: every answered question goes through the
 * same engine as the trainer (accuracy, speed, spaced repetition), as one
 * "Gate challenge" session. Questions left unanswered at the time limit are
 * not recorded — they were never attempted.
 */
function recordPractice(
  store: AppStore,
  ch: StartedChallenge,
  result: GateResult,
  answered: number,
  times: number[],
  startedAt: number,
) {
  const now = Date.now();
  const settings = store.state.settings;
  let correct = 0;
  const okTimes: number[] = [];
  result.review.slice(0, answered).forEach((r, i) => {
    const fact = makeFact(r.left, r.right);
    const prev = store.state.facts[fact.key] ?? emptyRecord(fact.key);
    const { record, result: res } = applyAttempt(
      prev,
      fact,
      { given: r.given, ms: times[i] ?? 0, smallerFirst: r.left === fact.a, sessionId: ch.id, now },
      settings,
    );
    store.commitRecord(record);
    if (res.ok) {
      correct++;
      if (res.ms !== null) okTimes.push(res.ms);
    }
  });
  if (answered > 0) {
    store.recordSession({
      id: ch.id,
      mode: "gate",
      stage: ch.stage,
      startedAt: now - Math.round(performance.now() - startedAt),
      endedAt: now,
      questions: answered,
      correct,
      medianMs: median(okTimes),
      meanMs: mean(okTimes),
    });
  }
  void store.flush();
}
