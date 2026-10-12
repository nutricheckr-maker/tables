"use client";

import { useEffect, useSyncExternalStore } from "react";
import { LocalStorageRepository, MemoryRepository } from "../persistence/repository";
import { AppStore, type StoreSnapshot } from "./app-store";

let store: AppStore | null = null;

export function getStore(): AppStore {
  if (!store) {
    let repo;
    try {
      repo = new LocalStorageRepository(window.localStorage);
    } catch {
      repo = new MemoryRepository();
    }
    store = new AppStore(repo);
    const flush = () => void store?.flush();
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
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
