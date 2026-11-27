import { useEffect, useState, useSyncExternalStore } from 'react';
import { subscribe } from '../data/store.ts';

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
 * A "now" that advances.
 *
 * Lite has no clock to run: ageing and staleness are computed at read time by
 * `core/freshness.ts` and `core/applications.ts`, and no row changes merely
 * because time passed. But every one of those readings is a function of the
 * current instant, so a board left open would otherwise show posts frozen at
 * page load.
 */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
