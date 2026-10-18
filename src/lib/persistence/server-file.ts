import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { mergeStates } from "./merge";
import { parseState, type AppState } from "./schema";

/**
 * The canonical copy of progress, kept by the tables service so every browser
 * and every address (127.0.0.1:5170, localhost:3000, …) sees the same record,
 * and so the gate can read which facts have been introduced. Server-only.
 */
export const STATE_DIR = join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "tables");
const FILE = join(STATE_DIR, "progress.json");

export function readProgress(): AppState | null {
  let raw: string;
  try {
    raw = readFileSync(FILE, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = parseState(JSON.parse(raw));
    if (parsed.ok) return parsed.state;
  } catch {
    // fall through
  }
  // Keep the unreadable file rather than overwrite it on the next save.
  try {
    renameSync(FILE, `${FILE}.corrupt-${Date.now()}`);
  } catch {
    // nothing more to do
  }
  return null;
}

function write(state: AppState) {
  mkdirSync(STATE_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, FILE); // atomic: readers never see half a file
}

/** Monotonic revision, so a client can tell whether someone else wrote since it last looked. */
let rev = 0;
export function revision(): number {
  return rev;
}

/** Merge an incoming (possibly partial) state into the stored one and persist it. */
export function saveMerged(incoming: AppState): { state: AppState; rev: number } {
  const current = readProgress();
  const merged = current ? mergeStates(incoming, current) : incoming;
  write(merged);
  rev += 1;
  return { state: merged, rev };
}

export function clearProgress() {
  try {
    renameSync(FILE, `${FILE}.reset-${Date.now()}`);
  } catch {
    // already absent
  }
  rev += 1;
}
