"use client";

import { useEffect, useSyncExternalStore } from "react";
import { LocalStorageRepository, MemoryRepository, ServerRepository } from "../persistence/repository";
import { AppStore, type StoreSnapshot } from "./app-store";

let store: AppStore | null = null;

export function getStore(): AppStore {
  if (!store) {
    let mirror;
    try {
      mirror = new LocalStorageRepository(window.localStorage);
    } catch {
      mirror = new MemoryRepository();
    }
    // Progress lives in the tables service; this browser keeps a mirror for offline use.
    store = new AppStore(new ServerRepository(mirror));
    const flush = () => void store?.flush();
    window.addEventListener("pagehide", flush);
    // Coming back to the tab: pick up anything another tab or the gate recorded.
    const refresh = () => void store?.refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", () => (document.visibilityState === "hidden" ? flush() : refresh()));
  }
  return store;
}

const LOADING: StoreSnapshot | null = null;

/** Returns null during server render and before the first client load. */
export function useApp(): { snap: StoreSnapshot | null; store: AppStore | null } {
  const snap = useSyncExternalStore(
    (fn) => getStore().subscribe(fn),
    () => getStore().getSnapshot(),
    () => LOADING,
  );
  useEffect(() => {
    void getStore().init();
  }, []);
  const ready = snap && snap.status === "ready" ? snap : null;
  return { snap: ready, store: ready ? getStore() : null };
}
