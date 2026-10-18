import { describe, expect, it } from "vitest";
import { applyAttempt } from "@/lib/engine/attempt";
import { mergeStates, changedFacts, introducedKeys } from "@/lib/persistence/merge";
import { MemoryRepository, ServerRepository } from "@/lib/persistence/repository";
import { initialState, parseState, type AppState } from "@/lib/persistence/schema";
import { emptyRecord } from "@/lib/engine/stats";
import { AppStore } from "@/lib/store/app-store";
import { f, masteredRecord, replay, settings, T0 } from "./helpers";

function withFacts(...recs: ReturnType<typeof masteredRecord>[]): AppState {
  const s = initialState();
  for (const r of recs) s.facts[r.key] = r;
  return s;
}

/** An in-memory stand-in for /api/progress, using the real merge. */
function fakeServer(initial: AppState | null = null) {
  let stored = initial;
  let rev = 0;
  let up = true;
  const puts: AppState[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    if (!up) throw new TypeError("offline");
    const method = init?.method ?? "GET";
    if (method === "GET") return Response.json({ state: stored, rev });
    if (method === "DELETE") {
      stored = null;
      rev++;
      return Response.json({ ok: true, rev });
    }
    const parsed = parseState(JSON.parse(String(init?.body)));
    if (!parsed.ok) return Response.json({ error: parsed.error }, { status: 400 });
    puts.push(parsed.state);
    stored = stored ? mergeStates(parsed.state, stored) : parsed.state;
    rev++;
    return Response.json({ ok: true, rev });
  }) as typeof fetch;
  return {
    fetchImpl,
    puts,
    stored: () => stored,
    setDown: (d: boolean) => (up = !d),
    externalWrite: (s: AppState) => {
      stored = stored ? mergeStates(s, stored) : s;
      rev++;
    },
  };
}

describe("mergeStates", () => {
  it("keeps the record with more attempts for each fact", () => {
    const x = f(7, 8);
    const one = replay(x, [{ ok: true }]).record;
    const three = replay(x, [{ ok: true }, { ok: false }, { ok: true }]).record;
    expect(mergeStates(withFacts(one), withFacts(three)).facts["7x8"]).toBe(three);
    expect(mergeStates(withFacts(three), withFacts(one)).facts["7x8"]).toBe(three);
  });

  it("unions facts, sessions and assessments; keeps the higher stage; settings from primary", () => {
    const a = withFacts(masteredRecord(f(2, 3)));
    const b = withFacts(masteredRecord(f(4, 5)));
    a.sessions = [{ id: "s1", mode: "mixed", stage: 1, startedAt: 1, endedAt: 2, questions: 1, correct: 1, medianMs: 1, meanMs: 1 }];
    b.sessions = [{ id: "s2", mode: "gate", stage: 1, startedAt: 3, endedAt: 4, questions: 10, correct: 9, medianMs: 1, meanMs: 1 }];
    b.progress.unlockedStage = 2;
    a.settings.practice.sessionLength = 25;
    const m = mergeStates(a, b);
    expect(Object.keys(m.facts).sort()).toEqual(["2x3", "4x5"]);
    expect(m.sessions.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(m.progress.unlockedStage).toBe(2);
    expect(m.settings.practice.sessionLength).toBe(25);
  });

  it("is order-independent for progress", () => {
    const a = withFacts(masteredRecord(f(2, 3)), replay(f(6, 7), [{ ok: true }]).record);
    const b = withFacts(replay(f(6, 7), [{ ok: true }, { ok: true }]).record);
    expect(mergeStates(a, b).facts).toEqual(mergeStates(b, a).facts);
  });

  it("lists introduced facts and changed records", () => {
    const s = withFacts(masteredRecord(f(2, 3)), emptyRecord("4x5"));
    expect(introducedKeys(s)).toEqual(["2x3"]);
    const next = { ...s, facts: { ...s.facts, "2x3": replay(f(2, 3), [{ ok: true }]).record } };
    expect(Object.keys(changedFacts(next, s))).toEqual(["2x3"]);
  });
});

describe("ServerRepository", () => {
  it("imports this browser's existing progress into an empty server on first load", async () => {
    const server = fakeServer();
    const local = new MemoryRepository();
    await local.save(withFacts(masteredRecord(f(9, 9))));
    const repo = new ServerRepository(local, server.fetchImpl);
    const { state } = await repo.load();
    expect(state?.facts["9x9"]?.attempts).toBe(6);
    expect(server.stored()?.facts["9x9"]?.attempts).toBe(6);
  });

  it("merges a browser copy with newer server data (another browser practised)", async () => {
    const server = fakeServer(withFacts(masteredRecord(f(3, 4))));
    const local = new MemoryRepository();
    await local.save(withFacts(masteredRecord(f(5, 6))));
    const { state } = await new ServerRepository(local, server.fetchImpl).load();
    expect(Object.keys(state!.facts).sort()).toEqual(["3x4", "5x6"]);
  });

  it("sends only changed facts on save", async () => {
    const base = withFacts(masteredRecord(f(2, 3)), masteredRecord(f(4, 5)), masteredRecord(f(6, 7)));
    const server = fakeServer(base);
    const repo = new ServerRepository(new MemoryRepository(), server.fetchImpl);
    const { state } = await repo.load();
    const updated = applyAttempt(state!.facts["4x5"]!, f(4, 5), { given: 20, ms: 900, smallerFirst: true, sessionId: "z", now: T0 + 9e9 }, settings()).record;
    await repo.save({ ...state!, facts: { ...state!.facts, "4x5": updated } });
    expect(Object.keys(server.puts.at(-1)!.facts)).toEqual(["4x5"]);
    expect(server.stored()!.facts["4x5"]!.attempts).toBe(7);
    expect(Object.keys(server.stored()!.facts)).toHaveLength(3);
  });

  it("falls back to the browser copy when the service is down, and syncs it later", async () => {
    const server = fakeServer();
    server.setDown(true);
    const local = new MemoryRepository();
    const repo = new ServerRepository(local, server.fetchImpl);
    const loaded = await repo.load();
    expect(loaded.warnings.join(" ")).toMatch(/offline/i);
    await repo.save(withFacts(masteredRecord(f(8, 8))));
    expect(server.stored()).toBeNull();
    server.setDown(false);
    const again = await new ServerRepository(local, server.fetchImpl).load();
    expect(again.state?.facts["8x8"]).toBeDefined();
    expect(server.stored()?.facts["8x8"]).toBeDefined();
  });

  it("notices a write from elsewhere, and the store merges it in", async () => {
    const server = fakeServer(withFacts(masteredRecord(f(2, 3))));
    const store = new AppStore(new ServerRepository(new MemoryRepository(), server.fetchImpl), 0);
    await store.init();
    // The gate page (another tab) records an answer for 6×7.
    server.externalWrite(withFacts(replay(f(6, 7), [{ ok: true }]).record));
    store.commitRecord(masteredRecord(f(3, 3)));
    await store.flush();
    await new Promise((r) => setTimeout(r, 0));
    expect(Object.keys(store.state.facts).sort()).toEqual(["2x3", "3x3", "6x7"]);
    expect(Object.keys(server.stored()!.facts).sort()).toEqual(["2x3", "3x3", "6x7"]);
  });
});
