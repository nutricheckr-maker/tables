import { stageReadiness, type AssessmentRecord } from "../engine/advancement";
import { MAX_STAGE, validateSettings } from "../engine/config";
import type { SessionSummary } from "../engine/session";
import type { FactRecord, StageId } from "../engine/types";
import type { ProgressRepository } from "../persistence/repository";
import { initialState, MAX_ASSESSMENTS, MAX_SESSIONS, parseState, type AppState } from "../persistence/schema";

export interface StoreSnapshot {
  status: "loading" | "ready";
  state: AppState;
  /** Messages from loading/import that the user should see once. */
  notices: string[];
  saveError: string | null;
}

/**
 * Holds AppState, applies changes immutably, and persists through a repository.
 * Framework-agnostic: React binds to it with useSyncExternalStore.
 */
export class AppStore {
  private snapshot: StoreSnapshot = { status: "loading", state: initialState(), notices: [], saveError: null };
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private initPromise: Promise<void> | null = null;
  /** Only unsaved changes are written, so an idle tab never overwrites newer data. */
  private dirty = false;

  constructor(
    private readonly repo: ProgressRepository,
    private readonly saveDelayMs = 250,
  ) {}

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snapshot;

  init(): Promise<void> {
    this.initPromise ??= this.repo
      .load()
      .then(({ state, warnings }) => this.set({ status: "ready", state: state ?? initialState(), notices: warnings }))
      .catch((e: unknown) =>
        this.set({ status: "ready", state: initialState(), notices: [`Could not load progress: ${String(e)}`] }),
      );
    return this.initPromise;
  }

  get state(): AppState {
    return this.snapshot.state;
  }

  private set(patch: Partial<StoreSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const l of this.listeners) l();
  }

  private update(fn: (s: AppState) => AppState) {
    this.set({ state: fn(this.snapshot.state) });
    this.scheduleSave();
  }

  private scheduleSave() {
    this.dirty = true;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), this.saveDelayMs);
  }

  async flush() {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    if (this.snapshot.status !== "ready" || !this.dirty) return;
    this.dirty = false;
    try {
      await this.repo.save(this.snapshot.state);
      if (this.snapshot.saveError) this.set({ saveError: null });
    } catch (e) {
      this.dirty = true;
      this.set({ saveError: `Progress could not be saved: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  dismissNotices() {
    this.set({ notices: [] });
  }

  commitRecord(record: FactRecord) {
    this.update((s) => ({ ...s, facts: { ...s.facts, [record.key]: record } }));
  }

  recordSession(summary: SessionSummary) {
    if (summary.questions === 0) return;
    this.update((s) => ({ ...s, sessions: [...s.sessions, summary].slice(-MAX_SESSIONS) }));
  }

  recordAssessment(rec: AssessmentRecord) {
    this.update((s) => ({ ...s, assessments: [...s.assessments, rec].slice(-MAX_ASSESSMENTS) }));
  }

  /** Unlock the next stage if, and only if, every readiness check passes. */
  advanceStage(now: number): { ok: boolean; stage: StageId } {
    const s = this.snapshot.state;
    const current = s.progress.unlockedStage;
    const r = stageReadiness(current, s.facts, s.settings, now, s.assessments);
    if (!r.canAdvance || current >= MAX_STAGE) return { ok: false, stage: current };
    const next = (current + 1) as StageId;
    this.update((st) => ({ ...st, progress: { ...st.progress, unlockedStage: next } }));
    return { ok: true, stage: next };
  }

  updateSettings(input: unknown): string[] {
    const { settings, errors } = validateSettings(input, this.snapshot.state.settings);
    if (errors.length === 0) this.update((s) => ({ ...s, settings }));
    return errors;
  }

  resetSettings() {
    this.update((s) => ({ ...s, settings: initialState().settings }));
  }

  exportJSON(): string {
    return JSON.stringify(this.snapshot.state, null, 2);
  }

  importJSON(text: string): { ok: boolean; messages: string[] } {
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return { ok: false, messages: ["File is not valid JSON"] };
    }
    const parsed = parseState(json);
    if (!parsed.ok) return { ok: false, messages: [parsed.error] };
    this.update(() => parsed.state);
    return { ok: true, messages: parsed.warnings };
  }

  async resetProgress() {
    await this.repo.clear();
    this.set({ state: initialState() });
    this.scheduleSave();
  }
}
