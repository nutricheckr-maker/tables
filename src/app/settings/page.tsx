"use client";

import { useRef, useState, type FormEvent } from "react";
import { STAGES, type Settings } from "@/lib/engine/config";
import { useApp } from "@/lib/store/use-app";
import { Button, Loading } from "@/components/ui";

/** How a stored value is shown and typed: percentages as 0–100, durations in seconds. */
type Kind = "int" | "pct" | "sec" | "num";

interface Field {
  group: keyof Settings;
  key: string;
  label: string;
  help?: string;
  kind: Kind;
}

const GROUPS: { title: string; blurb: string; fields: Field[] }[] = [
  {
    title: "Fact mastery",
    blurb: "A fact is mastered only when every one of these holds.",
    fields: [
      { group: "mastery", key: "minAttempts", label: "Minimum attempts", kind: "int" },
      { group: "mastery", key: "accuracy", label: "Recent accuracy (%)", kind: "pct" },
      { group: "mastery", key: "recentWindow", label: "Recent window (answers)", kind: "int" },
      { group: "mastery", key: "minCorrectSessions", label: "Correct in at least N sessions", kind: "int" },
      { group: "mastery", key: "minSpacedSuccesses", label: "Recalls after a gap", kind: "int", help: "Correct answers after the retention gap below" },
      { group: "mastery", key: "retentionGapHours", label: "Retention gap (hours)", kind: "num" },
      { group: "mastery", key: "minTimedSamples", label: "Timed answers needed for speed check", kind: "int" },
    ],
  },
  {
    title: "Weak facts",
    blurb: "Weak facts are prioritised and block stage advancement.",
    fields: [
      { group: "weak", key: "misses", label: "Misses that make a fact weak", kind: "int" },
      { group: "weak", key: "window", label: "…within the last N answers", kind: "int" },
      { group: "weak", key: "slowFactor", label: "Slow if median exceeds target ×", kind: "num" },
    ],
  },
  {
    title: "Practice",
    blurb: "",
    fields: [
      { group: "practice", key: "sessionLength", label: "Default session length", kind: "int" },
      { group: "practice", key: "newPerSession", label: "New facts per mixed session", kind: "int" },
      { group: "practice", key: "minRepeatGap", label: "Questions before a fact repeats", kind: "int" },
      { group: "practice", key: "autoAdvanceMs", label: "Pause after a correct answer (s)", kind: "sec", help: "0 = advance immediately" },
      { group: "practice", key: "idleCapMs", label: "Idle cutoff (s)", kind: "sec", help: "Slower answers are not used as timing data" },
      { group: "scheduler", key: "relearnAfter", label: "Re-ask a miss after N questions", kind: "int" },
      { group: "scheduler", key: "slowLevelCap", label: "Max review level for slow answers", kind: "int" },
    ],
  },
  {
    title: "Stage advancement",
    blurb: "All must hold, plus a passed assessment taken while they held.",
    fields: [
      { group: "advancement", key: "minMasteredShare", label: "Stage facts mastered (%)", kind: "pct" },
      { group: "advancement", key: "minBandShare", label: "Mastered in every difficulty band (%)", kind: "pct" },
      { group: "advancement", key: "maxWeak", label: "Max weak facts", kind: "int" },
      { group: "advancement", key: "maxOverdue", label: "Max overdue reviews", kind: "int" },
      { group: "advancement", key: "assessmentLength", label: "Assessment questions", kind: "int" },
      { group: "advancement", key: "assessmentAccuracy", label: "Assessment accuracy (%)", kind: "pct" },
      { group: "advancement", key: "assessmentBandAccuracy", label: "Accuracy in every band (%)", kind: "pct" },
    ],
  },
];

const toDisplay = (v: number, kind: Kind) =>
  kind === "pct" ? String(Math.round(v * 1000) / 10) : kind === "sec" ? String(v / 1000) : String(v);
const fromDisplay = (s: string, kind: Kind) => {
  const n = Number(s.trim());
  if (s.trim() === "" || !Number.isFinite(n)) return NaN;
  return kind === "pct" ? n / 100 : kind === "sec" ? Math.round(n * 1000) : n;
};

const FIELDS = new Map<string, Field>(GROUPS.flatMap((g) => g.fields.map((f) => [`${f.group}.${f.key}`, f] as const)));

/** Rewrite engine validation messages in the units and labels the form uses. */
function humanError(e: string): string {
  const m = /^([\w.]+): must be (.*?) between ([\d.]+) and ([\d.]+)$/.exec(e);
  const f = m && FIELDS.get(m[1]!);
  if (!m || !f) return e;
  const lo = toDisplay(Number(m[3]), f.kind);
  const hi = toDisplay(Number(m[4]), f.kind);
  return `${f.label}: must be ${m[2]!.replace("an integer", "a whole number")} between ${lo} and ${hi}`;
}

function draftFrom(s: Settings): Record<string, string> {
  const d: Record<string, string> = {};
  for (const g of GROUPS) {
    for (const f of g.fields) d[`${f.group}.${f.key}`] = toDisplay((s[f.group] as unknown as Record<string, number>)[f.key]!, f.kind);
  }
  for (const st of STAGES) d[`target.${st.id}`] = String(s.mastery.speedTargetMs[st.id] / 1000);
  d.intervals = s.scheduler.intervalsHours.map((h) => Math.round(h * 1000) / 1000).join(", ");
  d.speedLimit = s.practice.speedTimeLimitMs === null ? "" : String(s.practice.speedTimeLimitMs / 1000);
  d.requireCorrection = s.practice.requireCorrection ? "1" : "";
  return d;
}

export default function SettingsPage() {
  const { snap, store } = useApp();
  const [draft, setDraft] = useState<Record<string, string> | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!snap || !store) return <Loading />;
  const d = draft ?? draftFrom(snap.state.settings);
  const set = (k: string, v: string) => {
    setDraft({ ...d, [k]: v });
    setMessage(null);
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const out: Record<string, Record<string, unknown>> = { mastery: {}, weak: {}, practice: {}, scheduler: {}, advancement: {} };
    for (const g of GROUPS) for (const f of g.fields) out[f.group]![f.key] = fromDisplay(d[`${f.group}.${f.key}`] ?? "", f.kind);
    out.mastery!.speedTargetMs = Object.fromEntries(STAGES.map((s) => [s.id, fromDisplay(d[`target.${s.id}`] ?? "", "sec")]));
    out.scheduler!.intervalsHours = (d.intervals ?? "").split(",").map((x) => fromDisplay(x, "num"));
    out.practice!.speedTimeLimitMs = d.speedLimit?.trim() ? fromDisplay(d.speedLimit, "sec") : null;
    out.practice!.requireCorrection = d.requireCorrection === "1";
    const errs = store.updateSettings(out).map(humanError);
    setErrors(errs);
    if (errs.length === 0) {
      setDraft(null);
      setMessage("Saved.");
    }
  };

  const exportData = () => {
    const blob = new Blob([store.exportJSON()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tables-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importData = async (file: File) => {
    const res = store.importJSON(await file.text());
    setErrors(res.ok ? [] : res.messages);
    setMessage(res.ok ? `Imported.${res.messages.length ? ` ${res.messages.join(" ")}` : ""}` : null);
    setDraft(null);
  };

  const input = (k: string, cls = "w-24") => (
    <input
      id={k}
      value={d[k] ?? ""}
      onChange={(e) => set(k, e.target.value)}
      inputMode="decimal"
      className={`h-9 rounded-md border border-line-strong bg-surface px-2 text-right font-mono text-sm ${cls}`}
    />
  );

  return (
    <div className="mt-10 max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted">Changes apply to all statuses immediately; your answer history is never rewritten.</p>

      <form onSubmit={save}>
        {GROUPS.map((g) => (
          <fieldset key={g.title} className="mt-8">
            <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">{g.title}</legend>
            {g.blurb && <p className="mt-1 text-sm text-faint">{g.blurb}</p>}
            <div className="mt-3 divide-y divide-line rounded-lg border border-line bg-surface">
              {g.fields.map((f) => {
                const k = `${f.group}.${f.key}`;
                return (
                  <div key={k} className="flex items-center justify-between gap-4 px-4 py-2">
                    <label htmlFor={k} className="text-sm">
                      {f.label}
                      {f.help && <span className="block text-xs text-faint">{f.help}</span>}
                    </label>
                    {input(k)}
                  </div>
                );
              })}
              {g.title === "Fact mastery" && (
                <div className="px-4 py-2">
                  <p className="text-sm">Median response target (s), by the stage a fact belongs to</p>
                  <div className="mt-2 flex flex-wrap gap-3">
                    {STAGES.map((s) => (
                      <label key={s.id} htmlFor={`target.${s.id}`} className="flex items-center gap-2 text-xs text-muted">
                        ≤{s.max} {input(`target.${s.id}`, "w-16")}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {g.title === "Practice" && (
                <>
                  <div className="flex items-center justify-between gap-4 px-4 py-2">
                    <label htmlFor="speedLimit" className="text-sm">
                      Default speed-training limit (s)
                      <span className="block text-xs text-faint">Blank = off. Only Speed Training is ever timed.</span>
                    </label>
                    {input("speedLimit")}
                  </div>
                  <div className="flex items-center justify-between gap-4 px-4 py-2">
                    <label htmlFor="requireCorrection" className="text-sm">
                      Retype the correct answer after a miss
                    </label>
                    <input
                      id="requireCorrection"
                      type="checkbox"
                      checked={d.requireCorrection === "1"}
                      onChange={(e) => set("requireCorrection", e.target.checked ? "1" : "")}
                      className="h-4 w-4"
                    />
                  </div>
                  <div className="px-4 py-2">
                    <label htmlFor="intervals" className="text-sm">
                      Review intervals by level (hours)
                      <span className="block text-xs text-faint">Level 0 is immediate relearning. Must not decrease.</span>
                    </label>
                    {input("intervals", "mt-2 w-full text-left")}
                  </div>
                </>
              )}
            </div>
          </fieldset>
        ))}

        {errors.length > 0 && (
          <ul role="alert" className="mt-6 list-inside list-disc text-sm text-bad">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
        <div className="mt-6 flex items-center gap-3">
          <Button type="submit" variant="primary">
            Save settings
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              store.resetSettings();
              setDraft(null);
              setErrors([]);
              setMessage("Defaults restored.");
            }}
          >
            Restore defaults
          </Button>
          {message && (
            <span role="status" className="text-sm text-good">
              {message}
            </span>
          )}
        </div>
      </form>

      <section className="mt-12">
        <h2 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Your data</h2>
        <p className="mt-1 text-sm text-faint">
          Progress is stored only in this browser. Export a backup before clearing site data or switching devices.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button onClick={exportData}>Export JSON</Button>
          <Button onClick={() => fileRef.current?.click()}>Import JSON</Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importData(f);
              e.target.value = "";
            }}
          />
          <Button
            variant="ghost"
            className={confirmReset ? "text-bad" : ""}
            onBlur={() => setConfirmReset(false)}
            onClick={() => {
              if (!confirmReset) return setConfirmReset(true);
              void store.resetProgress();
              setConfirmReset(false);
              setDraft(null);
              setMessage("All progress erased.");
            }}
          >
            {confirmReset ? "Click again to erase everything" : "Reset all progress"}
          </Button>
        </div>
      </section>
    </div>
  );
}
