"use client";

import { useSyncExternalStore } from "react";

let now = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function tick() {
  now = Date.now();
  for (const l of listeners) l();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!timer) {
    now = Date.now();
    timer = setInterval(tick, 30_000);
  }
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Current time, refreshed every 30 s; keeps Date.now() out of render. */
export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => now || (now = Date.now()),
    () => 0,
  );
}
