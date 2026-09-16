import { useEffect, useState, useSyncExternalStore } from 'react';
import { runClock, subscribe } from '../data/store.ts';

/*
 * The store mutates in place and notifies, so object identity is not a usable
 * snapshot — a commit counter is. Registered at module load, before any
 * component mounts, and the store notifies in insertion order, so the counter
 * is always bumped before React reads it.
 */
let version = 0;
subscribe(() => {
  version += 1;
});
const snapshot = () => version;

export function useStoreVersion(): number {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * A "now" that advances, and advances the clock with it.
 *
 * Every freshness and nudge reading is a function of the current instant, so a
 * board left open would otherwise show posts frozen at page load — and a post
 * that should have decayed would keep its ranking.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      runClock(t);
      setNow(t);
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
