/**
 * The service worker (§5, §9). Deliberately the smallest thing that can be
 * called "a service worker" in this build.
 *
 * What it does: takes control of the page as soon as it activates, so a
 * subscription created moments after registration (`Bell.tsx`, wired to the
 * member's first successful apply or publish, never to page load) has a
 * worker in charge to subscribe through.
 *
 * What it deliberately does NOT do:
 *   - No `fetch` handler. It does not intercept, cache, or serve anything —
 *     Lite has no offline mode, and a caching worker is exactly the thing
 *     that makes a dev server confusing to iterate against.
 *   - No `push` handler. Web Push delivery needs a server to send to the
 *     push service, and this build has no backend (`src/data/store.ts` is
 *     `localStorage` only) — so no push message can ever arrive here to
 *     handle. Adding a handler that will never run would be exactly the
 *     "looks closed" fake this task's report is required to name.
 *
 * `Bell.tsx` shows in-session notifications straight from the page, through
 * the plain `Notification` API — it does not route them through this
 * worker, because there is nothing this worker could add to that path.
 *
 * Typed against a minimal local shape rather than `lib.webworker.d.ts`: this
 * file shares `tsconfig.json` with the rest of the app (`lib: DOM`), and
 * pulling in the webworker lib there would fight the DOM types every other
 * file in `src/` relies on. The three members below are all this file uses.
 */

interface MinimalExtendableEvent {
  waitUntil(promise: Promise<unknown>): void;
}

interface MinimalClients {
  claim(): Promise<void>;
}

interface MinimalServiceWorkerGlobalScope {
  addEventListener(type: 'install' | 'activate', listener: (event: MinimalExtendableEvent) => void): void;
  skipWaiting(): Promise<void>;
  clients: MinimalClients;
}

declare const self: MinimalServiceWorkerGlobalScope;

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

export {};
