"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { stageReadiness } from "@/lib/engine/advancement";
import { buildAssessment } from "@/lib/engine/assessment";
import { STAGES, stageConfig } from "@/lib/engine/config";
import { filterFacts, stageFacts, type FactFilter } from "@/lib/engine/facts";
import { defaultRng } from "@/lib/engine/rng";
import type { SessionConfig } from "@/lib/engine/session";
import type { Band, Fact, Mode, StageId } from "@/lib/engine/types";
import { getStore, useApp } from "@/lib/store/use-app";
import { useNow } from "@/lib/store/use-now";
import { MODE_LABEL, stageLabel } from "@/lib/format";
import { Trainer } from "@/components/trainer";
import { Button, Kbd, Loading } from "@/components/ui";

const MODES: { id: Mode; blurb: string }[] = [
  { id: "mixed", blurb: "Adaptive, unpredictable order across everything unlocked. The default daily session." },
  { id: "focused", blurb: "One table, a factor range or a difficulty band." },
  { id: "speed", blurb: "Practised facts only. Optional time limit; accuracy comes first." },
  { id: "weakness", blurb: "Weak, slow and due facts until they hold across sessions." },
  { id: "assessment", blurb: "Stratified test of the whole stage. Required to advance." },
];

type FocusKind = "all" | "table" | "range" | "band";

interface Running {
  config: SessionConfig;
  plan: Fact[] | null;
  qualified: boolean;
  run: number;
}

const LIMITS = [null, 3000, 5000, 8000] as const;

function readParams(p: URLSearchParams): { mode?: Mode; table?: string; start: boolean } {
  const m = p.get("mode");
  const t = Number(p.get("table"));
  return {
    ...(m && MODES.some((x) => x.id === m) ? { mode: m as Mode } : {}),
    ...(Number.isInteger(t) && t > 0 ? { table: String(t) } : {}),
    start: p.get("start") === "1",
  };
}

export default function TrainPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Train />
    </Suspense>
  );
}

function Train() {
  const search = useSearchParams();
  const { snap, store } = useApp();
  const now = useNow();
  // Deep links from the dashboard: /train?mode=weakness&start=1&table=17
  const [params] = useState(() => readParams(search));
  const [mode, setMode] = useState<Mode>(params.mode ?? "mixed");
  const [stage, setStage] = useState<StageId | null>(null);
  const [focusKind, setFocusKind] = useState<FocusKind>("table");
  const [table, setTable] = useState(params.table ?? "17");
  const [rangeMin, setRangeMin] = useState("11");
  const [rangeMax, setRangeMax] = useState("20");
  const [band, setBand] = useState<Band>("hard");
  const [length, setLength] = useState<number | null>(null);
  const [limit, setLimit] = useState<number | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<Running | null>(null);

  const unlocked = snap?.state.progress.unlockedStage ?? 1;
  const activeStage = stage ?? unlocked;
  const max = stageConfig(activeStage).max;
  const sessionLength = length ?? snap?.state.settings.practice.sessionLength ?? 40;
  const timeLimit = limit === undefined ? (snap?.state.settings.practice.speedTimeLimitMs ?? null) : limit;


  const filter = useMemo((): FactFilter | string | undefined => {
    if (mode !== "focused" || focusKind === "all") return undefined;
    if (focusKind === "table") {
      const t = Number(table);
      if (!Number.isInteger(t) || t < 1 || t > max) return `Table must be a whole number from 1 to ${max}`;
      return { table: t };
    }
    if (focusKind === "range") {
      const lo = Number(rangeMin);
      const hi = Number(rangeMax);
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < 1 || hi > max || lo > hi) {
        return `Range must satisfy 1 ≤ from ≤ to ≤ ${max}`;
      }
      return { range: { min: lo, max: hi } };
    }
    return { band };
  }, [mode, focusKind, table, rangeMin, rangeMax, band, max]);

  const poolSize = useMemo(() => {
    if (typeof filter === "string") return 0;
    return filter ? filterFacts(stageFacts(activeStage), filter).length : stageFacts(activeStage).length;
  }, [filter, activeStage]);

  const start = (e?: FormEvent) => {
    e?.preventDefault();
    if (!store || !snap) return;
    if (typeof filter === "string") {
      setError(filter);
      return;
    }
    setError(null);
    const s = snap.state;
    const config: SessionConfig = {
      mode,
      stage: activeStage,
      ...(filter ? { filter } : {}),
      length: sessionLength,
      timeLimitMs: mode === "speed" ? timeLimit : null,
    };
    const isAssessment = mode === "assessment";
    setRunning((prev) => ({
      config,
      plan: isAssessment ? buildAssessment(activeStage, s.facts, s.settings, defaultRng) : null,
      qualified: isAssessment
        ? stageReadiness(activeStage, s.facts, s.settings, Date.now(), s.assessments).prerequisitesMet
        : false,
      run: (prev?.run ?? 0) + 1,
    }));
  };

  // Latest start() for keyboard and auto-start callbacks; assigned in an effect, never during render.
  const startRef = useRef<() => void>(() => {});
  useEffect(() => {
    startRef.current = start;
  });

  // Number keys pick a mode when not typing; Enter starts from anywhere.
  useEffect(() => {
    if (running) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key === "Enter" && el === document.body) {
        e.preventDefault();
        startRef.current();
        return;
      }
      if (el.tagName === "INPUT" || el.tagName === "SELECT" || e.metaKey || e.ctrlKey || e.altKey) return;
      const i = Number(e.key) - 1;
      const m = MODES[i];
      if (m) {
        setMode(m.id);
        document.getElementById(`mode-${m.id}`)?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running]);

  // Auto-start once progress has loaded (start() runs in a callback, not during render).
  useEffect(() => {
    if (!params.start) return;
    let cancelled = false;
    void getStore()
      .init()
      .then(() => {
        if (!cancelled) startRef.current();
      });
    return () => {
      cancelled = true;
    };
  }, [params.start]);

  if (!snap || !store) return <Loading />;

  if (running) {
    return (
      <Trainer
        key={running.run}
        store={store}
        config={running.config}
        plan={running.plan}
        qualified={running.qualified}
        onRestart={() => start()}
        onExit={() => setRunning(null)}
      />
    );
  }

  const readiness = stageReadiness(activeStage, snap.state.facts, snap.state.settings, now, snap.state.assessments);

  return (
    <form
      onSubmit={start}
      onKeyDown={(e) => {
        // Radios do not trigger implicit submission in every browser.
        if (e.key === "Enter" && (e.target as HTMLInputElement).type === "radio") start(e);
      }}
      className="mt-10 max-w-3xl"
    >
      <h1 className="text-2xl font-semibold tracking-tight">Train</h1>
      <p className="mt-1 text-sm text-muted">
        Pick a mode with <Kbd>1</Kbd>–<Kbd>5</Kbd> or the arrow keys, then <Kbd>Enter</Kbd>.
      </p>

      <fieldset className="mt-6">
        <legend className="sr-only">Mode</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {MODES.map((m, i) => (
            <label
              key={m.id}
              className="flex cursor-pointer gap-3 rounded-lg border border-line bg-surface p-4 has-[:checked]:border-ink has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--focus)]"
            >
              <input
                id={`mode-${m.id}`}
                type="radio"
                name="mode"
                value={m.id}
                checked={mode === m.id}
                onChange={() => setMode(m.id)}
                className="sr-only"
              />
              <span className="font-mono text-xs text-faint">{i + 1}</span>
              <span>
                <span className="block font-medium">{MODE_LABEL[m.id]}</span>
                <span className="mt-0.5 block text-sm text-muted">{m.blurb}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-6 flex flex-wrap items-end gap-x-6 gap-y-4 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-muted">Stage</span>
          <select
            value={activeStage}
            onChange={(e) => setStage(Number(e.target.value) as StageId)}
            className="h-10 rounded-md border border-line-strong bg-surface px-3"
          >
            {STAGES.map((s) => (
              <option key={s.id} value={s.id} disabled={s.id > unlocked}>
                {stageLabel(s.id)}
                {s.id > unlocked ? " (locked)" : ""}
              </option>
            ))}
          </select>
        </label>

        {mode !== "assessment" && (
          <label className="flex flex-col gap-1">
            <span className="text-muted">Questions</span>
            <select
              value={sessionLength}
              onChange={(e) => setLength(Number(e.target.value))}
              className="h-10 rounded-md border border-line-strong bg-surface px-3"
            >
              {[...new Set([20, 40, 80, 150, sessionLength])].sort((a, b) => a - b).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}

        {mode === "speed" && (
          <label className="flex flex-col gap-1">
            <span className="text-muted">Time limit</span>
            <select
              value={timeLimit ?? "off"}
              onChange={(e) => setLimit(e.target.value === "off" ? null : Number(e.target.value))}
              className="h-10 rounded-md border border-line-strong bg-surface px-3"
            >
              {[...new Set([...LIMITS, timeLimit])].map((l) => (
                <option key={l ?? "off"} value={l ?? "off"}>
                  {l === null ? "Off" : `${l / 1000}s per question`}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {mode === "focused" && (
        <fieldset className="mt-6 rounded-lg border border-line p-4">
          <legend className="px-1 text-sm text-muted">Focus</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            {(["table", "range", "band", "all"] as FocusKind[]).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input type="radio" name="focus" checked={focusKind === k} onChange={() => setFocusKind(k)} />
                {{ table: "One table", range: "Factor range", band: "Difficulty", all: "Whole stage" }[k]}
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap items-end gap-4 text-sm">
            {focusKind === "table" && (
              <label className="flex flex-col gap-1">
                <span className="text-muted">Times table (1–{max})</span>
                <input
                  value={table}
                  onChange={(e) => setTable(e.target.value.replace(/\D/g, "").slice(0, 2))}
                  inputMode="numeric"
                  className="h-10 w-24 rounded-md border border-line-strong bg-surface px-3 font-mono"
                />
              </label>
            )}
            {focusKind === "range" && (
              <>
                <label className="flex flex-col gap-1">
                  <span className="text-muted">From</span>
                  <input
                    value={rangeMin}
                    onChange={(e) => setRangeMin(e.target.value.replace(/\D/g, "").slice(0, 2))}
                    inputMode="numeric"
                    className="h-10 w-20 rounded-md border border-line-strong bg-surface px-3 font-mono"
                  />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-muted">To</span>
                  <input
                    value={rangeMax}
                    onChange={(e) => setRangeMax(e.target.value.replace(/\D/g, "").slice(0, 2))}
                    inputMode="numeric"
                    className="h-10 w-20 rounded-md border border-line-strong bg-surface px-3 font-mono"
                  />
                </label>
              </>
            )}
            {focusKind === "band" && (
              <label className="flex flex-col gap-1">
                <span className="text-muted">Band</span>
                <select
                  value={band}
                  onChange={(e) => setBand(e.target.value as Band)}
                  className="h-10 rounded-md border border-line-strong bg-surface px-3"
                >
                  <option value="easy">Easy (1, 2, 10s, ≤10×10)</option>
                  <option value="medium">Medium</option>
                  <option value="hard">Hard (both factors ≥ 13)</option>
                </select>
              </label>
            )}
            <span className="pb-2 text-xs text-faint">{poolSize} facts, both orientations</span>
          </div>
        </fieldset>
      )}

      {mode === "assessment" && (
        <div className="mt-6 rounded-lg border border-line bg-surface p-4 text-sm">
          <p>
            {Math.min(snap.state.settings.advancement.assessmentLength, stageFacts(activeStage).length)} questions,
            stratified: every weak fact, extra weight on hard facts
            {activeStage > 1 ? ", facts from earlier stages and facts new to this stage" : ""}.
          </p>
          <p className="mt-2 text-muted">
            {readiness.prerequisitesMet
              ? "All other requirements are met — a pass here counts toward advancing."
              : "Practice run: the stage checklist is not complete yet, so a pass will not unlock the next stage."}
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-sm text-bad">
          {error}
        </p>
      )}

      <div className="mt-8">
        <Button type="submit" variant="primary" className="h-12 px-6 text-base">
          Start {MODE_LABEL[mode].toLowerCase()} <Kbd>Enter</Kbd>
        </Button>
      </div>
    </form>
  );
}
