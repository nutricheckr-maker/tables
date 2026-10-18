import { readFileSync, renameSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID, randomInt } from "node:crypto";
import { isStageId } from "../engine/config";
import { introducedKeys } from "../persistence/merge";
import { readProgress, STATE_DIR } from "../persistence/server-file";
import { GateState, type GateMemory, type GateMemoryStore, type ProgressSource } from "./state";

/**
 * One GateState per server process, shared with the custom server's proxies
 * through a global symbol (route handlers are bundled separately from
 * server.mjs, but run in the same process).
 */
const KEY = Symbol.for("tables.gate");
const MEMORY_FILE = join(STATE_DIR, "gate.json");

/** Persists only what makes challenges harder (stage, introduced facts), never a grant. */
const fileMemory: GateMemoryStore = {
  load(): GateMemory {
    try {
      const m = JSON.parse(readFileSync(MEMORY_FILE, "utf8"));
      return {
        stage: isStageId(m.stage) ? m.stage : 1,
        introduced: Array.isArray(m.introduced) ? m.introduced.filter((k: unknown) => typeof k === "string") : [],
      };
    } catch {
      return { stage: 1, introduced: [] };
    }
  },
  save(m: GateMemory) {
    try {
      mkdirSync(STATE_DIR, { recursive: true });
      writeFileSync(`${MEMORY_FILE}.tmp`, JSON.stringify(m));
      renameSync(`${MEMORY_FILE}.tmp`, MEMORY_FILE);
    } catch {
      // The gate still works from the progress file alone.
    }
  },
};

/** The trainer's progress, read from the service's own copy (not from the page). */
export function progressSource(): ProgressSource | null {
  const state = readProgress();
  return state ? { stage: state.progress.unlockedStage, introduced: introducedKeys(state) } : null;
}

const clock = {
  wall: () => Date.now(),
  // performance.now() is CLOCK_MONOTONIC in Node: it does not advance during suspend.
  mono: () => performance.now(),
};

/** Cryptographic randomness: question order must not be predictable. */
const rng = () => randomInt(0, 2 ** 32) / 2 ** 32;

export function getGate(): GateState {
  const g = globalThis as unknown as Record<symbol, GateState | undefined>;
  let gate = g[KEY];
  if (!gate) {
    gate = new GateState(clock, rng, fileMemory, randomUUID);
    g[KEY] = gate;
  }
  return gate;
}
