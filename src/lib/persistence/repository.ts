import { parseState, type AppState } from "./schema";

/**
 * Storage boundary. The learning engine never touches storage; the store calls
 * this interface. A PostgreSQL/HTTP implementation only has to satisfy it.
 */
export interface ProgressRepository {
  load(): Promise<{ state: AppState | null; warnings: string[] }>;
  save(state: AppState): Promise<void>;
  clear(): Promise<void>;
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
