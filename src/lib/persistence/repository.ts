import { changedFacts, mergeStates } from "./merge";
import { parseState, type AppState } from "./schema";

export interface SaveResult {
  /** Someone else (another tab, the gate page) wrote since this copy last synced. */
  stale?: boolean;
}

/**
 * Storage boundary. The learning engine never touches storage; the store calls
 * this interface. A PostgreSQL/HTTP implementation only has to satisfy it.
 */
export interface ProgressRepository {
  load(): Promise<{ state: AppState | null; warnings: string[] }>;
  save(state: AppState): Promise<SaveResult | void>;
  clear(): Promise<void>;
  /** Fetch the newest shared copy, if this repository has one. */
  refresh?(): Promise<AppState | null>;
}

export const STORAGE_KEY = "tables.progress.v1";

/** localStorage-backed repository: synchronous, offline, survives browser restarts. */
export class LocalStorageRepository implements ProgressRepository {
  constructor(
    private readonly storage: Storage,
    private readonly key = STORAGE_KEY,
  ) {}

  async load() {
    const raw = this.storage.getItem(this.key);
    if (raw === null) return { state: null, warnings: [] };
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      this.backupCorrupt(raw);
      return { state: null, warnings: ["Saved progress was unreadable; a copy was kept and a fresh start was made."] };
    }
    const parsed = parseState(json);
    if (!parsed.ok) {
      this.backupCorrupt(raw);
      return { state: null, warnings: [`Saved progress could not be loaded: ${parsed.error}. A copy was kept.`] };
    }
    return { state: parsed.state, warnings: parsed.warnings };
  }

  async save(state: AppState) {
    this.storage.setItem(this.key, JSON.stringify(state));
  }

  async clear() {
    this.storage.removeItem(this.key);
  }

  private backupCorrupt(raw: string) {
    try {
      this.storage.setItem(`${this.key}.corrupt-${Date.now()}`, raw);
    } catch {
      // Storage full: nothing more we can do without losing data.
    }
  }
}

/** In-memory repository for tests and for environments without storage. */
export class MemoryRepository implements ProgressRepository {
  private data: string | null = null;
  async load() {
    if (this.data === null) return { state: null, warnings: [] };
    const parsed = parseState(JSON.parse(this.data));
    return parsed.ok ? { state: parsed.state, warnings: parsed.warnings } : { state: null, warnings: [parsed.error] };
  }
  async save(state: AppState) {
    this.data = JSON.stringify(state);
  }
  async clear() {
    this.data = null;
  }
}

type Fetch = typeof fetch;
const SAME_ORIGIN = { "Content-Type": "application/json" };

/**
 * Progress kept by the tables service (one record for every browser and
 * address), with this browser's localStorage as a mirror and offline fallback.
 *
 * Saves send only the fact records that changed since the last sync; the server
 * merges them (see mergeStates), so concurrent tabs cannot overwrite each other.
 * Anything saved while the server was unreachable lives in the mirror and is
 * merged back in on the next load.
 */
export class ServerRepository implements ProgressRepository {
  /** What the server is known to hold; the baseline for computing deltas. */
  private synced: AppState | null = null;
  private rev = -1;

  constructor(
    private readonly local: ProgressRepository,
    private readonly fetchImpl: Fetch = (...a) => fetch(...a),
    private readonly url = "/api/progress",
  ) {}

  private async pull(): Promise<{ reachable: boolean; state: AppState | null }> {
    try {
      const r = await this.fetchImpl(this.url, { cache: "no-store" });
      if (!r.ok) return { reachable: false, state: null };
      const body = (await r.json()) as { state: unknown; rev: number };
      this.rev = body.rev;
      if (body.state === null) return { reachable: true, state: null };
      const parsed = parseState(body.state);
      return { reachable: true, state: parsed.ok ? parsed.state : null };
    } catch {
      return { reachable: false, state: null };
    }
  }

  private async push(state: AppState, base: AppState | null): Promise<{ ok: boolean; stale: boolean }> {
    const body = JSON.stringify({ ...state, facts: changedFacts(state, base) });
    try {
      const r = await this.fetchImpl(this.url, {
        method: "PUT",
        headers: SAME_ORIGIN,
        body,
        // Lets the last save of a closing tab finish, within the browser's 64 KB keepalive limit.
        keepalive: body.length < 60_000,
      });
      if (!r.ok) return { ok: false, stale: false };
      const { rev } = (await r.json()) as { rev: number };
      const stale = this.rev >= 0 && rev !== this.rev + 1;
      this.rev = rev;
      return { ok: true, stale };
    } catch {
      return { ok: false, stale: false };
    }
  }

  async load() {
    const local = await this.local.load();
    const server = await this.pull();
    if (!server.reachable) {
      return {
        state: local.state,
        warnings: [...local.warnings, "Working offline: progress is kept in this browser and synced when the tables service is back."],
      };
    }
    let state = server.state;
    if (local.state) {
      // Anything this browser holds that the server lacks (first run, offline work) is sent up.
      state = server.state ? mergeStates(server.state, local.state) : local.state;
      const pushed = await this.push(state, server.state);
      if (!pushed.ok) return { state, warnings: local.warnings };
    }
    this.synced = state;
    if (state) await this.local.save(state).catch(() => {});
    return { state, warnings: local.warnings };
  }

  async save(state: AppState): Promise<SaveResult> {
    await this.local.save(state).catch(() => {});
    const res = await this.push(state, this.synced);
    if (res.ok) this.synced = state;
    return { stale: res.stale };
  }

  async refresh(): Promise<AppState | null> {
    const server = await this.pull();
    if (server.state) this.synced = server.state;
    return server.state;
  }

  async clear() {
    await this.local.clear();
    await this.fetchImpl(this.url, { method: "DELETE", headers: SAME_ORIGIN }).catch(() => {});
    this.synced = null;
  }
}
