import type { Settings } from "./config";
import { stageConfig } from "./config";
import { applyAttempt, type AttemptResult } from "./attempt";
import { factByKey, factsUpTo, filterFacts, stageFacts, toQuestion, type FactFilter } from "./facts";
import type { Rng } from "./rng";
import {
  chooseSmallerFirst,
  selectNext,
  type PracticeMode,
  type Records,
  type RelearnItem,
  type SelectionReason,
} from "./selection";
import { emptyRecord, mean, median } from "./stats";
import type { ErrorKind, Fact, FactKey, FactRecord, Mode, Question, StageId } from "./types";

export interface SessionConfig {
  mode: Mode;
  /** Facts are drawn from 1..stage.max (which includes every earlier stage). */
  stage: StageId;
  /** Focused practice only. */
  filter?: FactFilter;
  /** Number of questions (ignored for assessments, which use their plan). */
  length: number;
  /** Speed Training only. */
  timeLimitMs: number | null;
}

export interface AnsweredItem {
  question: Question;
  given: number | null;
  ok: boolean;
  ms: number | null;
  errorKind: ErrorKind | null;
  reason: SelectionReason | "assessment";
}

export interface SessionState {
  id: string;
  config: SessionConfig;
  startedAt: number;
  /** Assessment question order, fixed at start. */
  plan: FactKey[] | null;
  history: FactKey[];
  answers: AnsweredItem[];
  relearn: RelearnItem[];
  newIntroduced: number;
  current: { question: Question; reason: SelectionReason | "assessment" } | null;
  done: boolean;
  endReason: "complete" | "exhausted" | "stopped" | null;
}

export interface SessionSummary {
  id: string;
  mode: Mode;
  stage: StageId;
  startedAt: number;
  endedAt: number;
  questions: number;
  correct: number;
  medianMs: number | null;
  meanMs: number | null;
  focus?: string;
}

/** The facts a session may draw from. */
export function sessionPool(config: SessionConfig, records: Records): Fact[] {
  const base = config.mode === "mixed" ? factsUpTo(stageConfig(config.stage).max) : stageFacts(config.stage);
  const filtered = config.filter ? filterFacts(base, config.filter) : base;
  if (config.mode === "speed") return filtered.filter((f) => (records[f.key]?.attempts ?? 0) > 0);
  return filtered;
}

export function startSession(
  id: string,
  config: SessionConfig,
  records: Records,
  settings: Settings,
  now: number,
  rng: Rng,
  plan: Fact[] | null = null,
): SessionState {
  const state: SessionState = {
    id,
    config,
    startedAt: now,
    plan: plan ? plan.map((f) => f.key) : null,
    history: [],
    answers: [],
    relearn: [],
    newIntroduced: 0,
    current: null,
    done: false,
    endReason: null,
  };
  return advance(state, records, settings, now, rng);
}

export function sessionLength(state: SessionState): number {
  return state.plan ? state.plan.length : state.config.length;
}

/** Move to the next question, or finish the session. */
export function advance(state: SessionState, records: Records, settings: Settings, now: number, rng: Rng): SessionState {
  if (state.done) return state;
  const asked = state.history.length;
  if (asked >= sessionLength(state)) return { ...state, current: null, done: true, endReason: "complete" };

  let fact: Fact;
  let reason: SelectionReason | "assessment";
  if (state.plan) {
    fact = factByKey(state.plan[asked] as FactKey);
    reason = "assessment";
  } else {
    const pick = selectNext({
      mode: state.config.mode as PracticeMode,
      pool: sessionPool(state.config, records),
      records,
      settings,
      now,
      history: state.history,
      relearn: state.relearn,
      newIntroduced: state.newIntroduced,
      rng,
    });
    if (!pick) return { ...state, current: null, done: true, endReason: asked === 0 ? "exhausted" : "complete" };
    fact = pick.fact;
    reason = pick.reason;
  }

  const question = toQuestion(fact, chooseSmallerFirst(fact, records[fact.key], rng));
  return {
    ...state,
    history: [...state.history, fact.key],
    newIntroduced: state.newIntroduced + (reason === "new" ? 1 : 0),
    current: { question, reason },
  };
}

export interface SubmitInput {
  given: number | null;
  ms: number;
  timedOut?: boolean;
}

/**
 * Record an answer to the current question. Returns the updated session, the
 * updated fact record (to persist), and the evaluated result (for feedback).
 */
export function submitAnswer(
  state: SessionState,
  records: Records,
  settings: Settings,
  input: SubmitInput,
  now: number,
): { state: SessionState; record: FactRecord; result: AttemptResult } {
  if (!state.current) throw new Error("No question to answer");
  const { question, reason } = state.current;
  const fact = factByKey(question.key);
  const prev = records[question.key] ?? emptyRecord(question.key);
  const { record, result } = applyAttempt(
    prev,
    fact,
    {
      given: input.given,
      ms: input.ms,
      timedOut: input.timedOut,
      smallerFirst: question.left === fact.a,
      sessionId: state.id,
      now,
    },
    settings,
  );

  let relearn = state.relearn.filter((r) => r.key !== question.key);
  if (!result.ok && !state.plan) {
    relearn = [...relearn, { key: question.key, at: state.history.length + settings.scheduler.relearnAfter }];
  }

  const answered: AnsweredItem = {
    question,
    given: input.given,
    ok: result.ok,
    ms: result.ms,
    errorKind: result.errorKind,
    reason,
  };

  return {
    state: {
      ...state,
      answers: [...state.answers, answered],
      relearn,
      // A new fact answered correctly and fast was already known: it does not use up the new-fact budget.
      newIntroduced: state.newIntroduced - (reason === "new" && result.fast ? 1 : 0),
      current: null,
    },
    record,
    result,
  };
}

export function stopSession(state: SessionState): SessionState {
  return { ...state, current: null, done: true, endReason: state.endReason ?? "stopped" };
}

/**
 * Speed Training puts accuracy first: if accuracy over the last 10 answers drops
 * below 90%, the time limit is relaxed by 50% until it recovers.
 */
export function effectiveTimeLimit(state: SessionState): { limitMs: number | null; relaxed: boolean } {
  const base = state.config.mode === "speed" ? state.config.timeLimitMs : null;
  if (base === null) return { limitMs: null, relaxed: false };
  const last = state.answers.slice(-10);
  if (last.length >= 5 && last.filter((a) => a.ok).length / last.length < 0.9) {
    return { limitMs: Math.round(base * 1.5), relaxed: true };
  }
  return { limitMs: base, relaxed: false };
}

export function summarize(state: SessionState, endedAt: number): SessionSummary {
  const times = state.answers.filter((a) => a.ok && a.ms !== null).map((a) => a.ms as number);
  const f = state.config.filter;
  const focus = f?.table
    ? `${f.table}× table`
    : f?.range
      ? `${f.range.min}–${f.range.max}`
      : f?.band
        ? `${f.band} facts`
        : undefined;
  return {
    id: state.id,
    mode: state.config.mode,
    stage: state.config.stage,
    startedAt: state.startedAt,
    endedAt,
    questions: state.answers.length,
    correct: state.answers.filter((a) => a.ok).length,
    medianMs: median(times),
    meanMs: mean(times),
    ...(focus ? { focus } : {}),
  };
}
