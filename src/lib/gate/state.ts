import { isStageId } from "../engine/config";
import type { Rng } from "../engine/rng";
import type { StageId } from "../engine/types";
import {
  createChallenge,
  gatePool,
  gradeChallenge,
  normaliseAnswers,
  type Challenge,
  type GateQuestion,
  type GateResult,
} from "./challenge";
import { GATE } from "./policy";

export interface Clock {
  /** Wall clock, epoch ms. Advances during suspend; can be changed by an admin. */
  wall(): number;
  /** Monotonic ms. Stops during suspend; never jumps. All durations use this. */
  mono(): number;
}

/** What the gate remembers between restarts: never a grant, only what makes questions harder. */
export interface GateMemory {
  stage: StageId;
  /** Every fact ever seen practised. Only grows, so resetting progress cannot shrink the pool. */
  introduced: string[];
}

export interface GateMemoryStore {
  load(): GateMemory;
  save(m: GateMemory): void;
}

/** The trainer's progress as the server reads it. */
export interface ProgressSource {
  stage: StageId;
  introduced: readonly string[];
}

export type RevokeReason = "suspend" | "clock-change" | "manual" | "login";

export interface GateEvent {
  at: number;
  kind: "start" | "pass" | "fail" | "revoke" | "expire";
  detail: string;
}

export type StartOutcome = StartedChallenge | { error: string; introduced: number };

export interface StartedChallenge {
  id: string;
  stage: StageId;
  questions: GateQuestion[];
  limitMs: number;
  passCorrect: number;
}

export type SubmitOutcome =
  | { ok: true; result: GateResult; grantedUntil: number | null }
  | { ok: false; error: string };

export interface GateStatus {
  granted: boolean;
  /** Wall-clock estimate of expiry, for display only. */
  grantedUntil: number | null;
  remainingMs: number;
  stage: StageId;
}

/**
 * The single authority on whether protected apps may be used.
 *
 * Lives only in server memory: a restart or a fresh login starts locked, and a
 * pass can never be written to disk and replayed. Expiry runs on the monotonic
 * clock, so changing the system time cannot extend a grant; a jump between the
 * two clocks (suspend, or a clock change) revokes the grant immediately.
 */
export class GateState {
  private current: (Challenge & { mono: number }) | null = null;
  private grantUntilMono = 0;
  private lastWall: number;
  private lastMono: number;
  private memory: GateMemory;
  private readonly events: GateEvent[] = [];
  private listeners = new Set<() => void>();

  constructor(
    private readonly clock: Clock,
    private readonly rng: Rng,
    private readonly memoryStore: GateMemoryStore,
    private readonly newId: () => string,
  ) {
    this.lastWall = clock.wall();
    this.lastMono = clock.mono();
    this.memory = memoryStore.load();
  }

  /** Called on every check. Detects suspend/resume and clock changes. */
  private observeClocks() {
    const w = this.clock.wall();
    const m = this.clock.mono();
    const drift = w - this.lastWall - (m - this.lastMono);
    this.lastWall = w;
    this.lastMono = m;
    if (Math.abs(drift) > GATE.suspendJumpMs) {
      this.revoke(drift > 0 ? "suspend" : "clock-change");
    }
  }

  isGranted(): boolean {
    this.observeClocks();
    if (this.grantUntilMono !== 0 && this.clock.mono() >= this.grantUntilMono) {
      this.grantUntilMono = 0;
      this.record("expire", "grant expired");
      this.emit();
    }
    return this.grantUntilMono !== 0;
  }

  status(): GateStatus {
    const granted = this.isGranted();
    const remainingMs = granted ? this.grantUntilMono - this.clock.mono() : 0;
    return {
      granted,
      grantedUntil: granted ? this.clock.wall() + remainingMs : null,
      remainingMs,
      stage: this.memory.stage,
    };
  }

  /**
   * Issue a fresh challenge from facts already introduced in the trainer.
   * Any challenge in progress is voided, so a refresh or a second tab always
   * means starting again from zero. The remembered stage and introduced set
   * only ever grow.
   */
  start(source: ProgressSource | null): StartOutcome {
    this.observeClocks();
    this.current = null;
    if (source) this.remember(source);
    const pool = gatePool(this.memory.stage, new Set(this.memory.introduced));
    if (pool.length < GATE.questions) {
      return {
        error: `Only ${pool.length} fact${pool.length === 1 ? " has" : "s have"} been introduced so far. Practise in the trainer until at least ${GATE.questions} have, then try again.`,
        introduced: pool.length,
      };
    }
    const ch = createChallenge(this.newId(), this.memory.stage, pool, this.clock.wall(), this.rng);
    this.current = { ...ch, mono: this.clock.mono() };
    this.record("start", `stage ${this.memory.stage}, ${pool.length} introduced facts`);
    return {
      id: ch.id,
      stage: ch.stage,
      questions: ch.questions,
      limitMs: GATE.timeLimitMs,
      passCorrect: GATE.passCorrect,
    };
  }

  private remember(source: ProgressSource) {
    const known = new Set(this.memory.introduced);
    const before = known.size;
    for (const k of source.introduced) known.add(k);
    const stage = isStageId(source.stage) && source.stage > this.memory.stage ? source.stage : this.memory.stage;
    if (known.size !== before || stage !== this.memory.stage) {
      this.memory = { stage, introduced: [...known].sort() };
      this.memoryStore.save(this.memory);
    }
  }

  /** Grade a submission once. Elapsed time is measured here, not reported by the page. */
  submit(id: unknown, answers: unknown): SubmitOutcome {
    this.observeClocks();
    const ch = this.current;
    if (!ch || typeof id !== "string" || id !== ch.id) {
      return { ok: false, error: "This challenge is no longer valid. Start a new one." };
    }
    this.current = null; // one submission per challenge
    const given = normaliseAnswers(answers, ch.questions.length);
    // Grade on the monotonic clock so a clock change mid-challenge cannot help.
    const result = gradeChallenge({ ...ch, startedAt: 0 }, given, this.clock.mono() - ch.mono);
    if (result.passed) {
      this.grantUntilMono = this.clock.mono() + GATE.grantMs;
      this.record("pass", `${result.correct}/${result.total} in ${(result.elapsedMs / 1000).toFixed(1)}s`);
    } else {
      this.record("fail", result.reasons.join("; "));
    }
    this.emit();
    return { ok: true, result, grantedUntil: result.passed ? this.clock.wall() + GATE.grantMs : null };
  }

  revoke(reason: RevokeReason) {
    this.current = null;
    if (this.grantUntilMono !== 0) {
      this.grantUntilMono = 0;
      this.record("revoke", reason);
      this.emit();
    }
  }

  history(): readonly GateEvent[] {
    return this.events;
  }

  /** Notified whenever access is granted or taken away (the proxy closes tunnels on this). */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  private record(kind: GateEvent["kind"], detail: string) {
    this.events.push({ at: this.clock.wall(), kind, detail });
    if (this.events.length > 50) this.events.shift();
  }
}
