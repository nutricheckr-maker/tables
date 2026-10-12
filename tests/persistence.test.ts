import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, validateSettings } from "@/lib/engine/config";
import { LocalStorageRepository, MemoryRepository, STORAGE_KEY } from "@/lib/persistence/repository";
import { initialState, parseState } from "@/lib/persistence/schema";
import { AppStore } from "@/lib/store/app-store";
import { f, masteredRecord } from "./helpers";

class FakeStorage implements Storage {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe("persistence", () => {
  it("round-trips state through localStorage", async () => {
    const storage = new FakeStorage();
    const repo = new LocalStorageRepository(storage);
    const state = initialState();
    const x = f(13, 17);
    state.facts[x.key] = masteredRecord(x);
    await repo.save(state);
    const loaded = await repo.load();
    expect(loaded.state).toEqual(state);
    expect(loaded.warnings).toEqual([]);
  });

  it("keeps a backup and starts fresh when stored data is unreadable", async () => {
    const storage = new FakeStorage();
    storage.setItem(STORAGE_KEY, "{not json");
    const out = await new LocalStorageRepository(storage).load();
    expect(out.state).toBeNull();
    expect(out.warnings[0]).toMatch(/unreadable/);
    expect(storage.length).toBe(2);
  });

  it("drops individually corrupt records but keeps the rest", () => {
    const state = initialState();
    const x = f(3, 4);
    state.facts[x.key] = masteredRecord(x);
    const raw = JSON.parse(JSON.stringify(state));
    raw.facts["5x6"] = { key: "5x6", attempts: "lots" };
    raw.facts["9x2"] = { key: "9x2" };
    const out = parseState(raw);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(Object.keys(out.state.facts)).toEqual(["3x4"]);
    expect(out.warnings).toHaveLength(2);
  });

  it("rejects data from a newer schema", () => {
    expect(parseState({ ...initialState(), version: 99 })).toMatchObject({ ok: false });
  });

  it("validates settings and reports bad values without applying them", () => {
    const { settings, errors } = validateSettings({ mastery: { accuracy: 2, minAttempts: 8 }, practice: { speedTimeLimitMs: 3000 } });
    expect(errors).toHaveLength(1);
    expect(settings.mastery.accuracy).toBe(DEFAULT_SETTINGS.mastery.accuracy);
    expect(settings.mastery.minAttempts).toBe(8);
    expect(settings.practice.speedTimeLimitMs).toBe(3000);
    expect(validateSettings({ scheduler: { intervalsHours: [5, 1, 2] } }).errors).toHaveLength(1);
  });

  it("store persists updates and supports export/import", async () => {
    const repo = new MemoryRepository();
    const store = new AppStore(repo, 0);
    await store.init();
    const x = f(12, 12);
    store.commitRecord(masteredRecord(x));
    expect(store.updateSettings({ practice: { sessionLength: 25 } })).toEqual([]);
    await store.flush();
    const reloaded = await repo.load();
    expect(reloaded.state?.facts[x.key]?.attempts).toBe(6);
    expect(reloaded.state?.settings.practice.sessionLength).toBe(25);

    const exported = store.exportJSON();
    const other = new AppStore(new MemoryRepository(), 0);
    await other.init();
    expect(other.importJSON(exported).ok).toBe(true);
    expect(other.state).toEqual(store.state);
    expect(other.importJSON("nope").ok).toBe(false);
  });
});

describe("store saving", () => {
  it("does not write when nothing changed", async () => {
    const repo = new MemoryRepository();
    let saves = 0;
    const orig = repo.save.bind(repo);
    repo.save = async (s) => {
      saves++;
      return orig(s);
    };
    const store = new AppStore(repo, 0);
    await store.init();
    await store.flush();
    expect(saves).toBe(0);
    store.commitRecord(masteredRecord(f(2, 3)));
    await store.flush();
    await store.flush();
    expect(saves).toBe(1);
  });
});
