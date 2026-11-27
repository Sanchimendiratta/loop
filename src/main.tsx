import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.tsx';
import { load } from './data/store.ts';
import swUrl from './sw.ts?worker&url';
import './styles.css';

// Rehydrates the persisted workspace if one is there and its schema version
// still matches, or seeds a fresh one otherwise (see `load`'s docblock in
// store.ts). There is no clock to run and no requests to catch up — Lite
// dropped both; post and application ageing is computed at read time by
// `core/freshness.ts` and `core/applications.ts`, from whatever `now` a
// screen is rendered with, not from anything this call does.
load();

// Registering the worker is not the same thing as asking for permission —
// nothing here shows a prompt or touches the screen. It just makes a worker
// available so `Bell.tsx` has something to subscribe through once the
// member has done something (never on landing — see that file). See
// `src/sw.ts` for the (short) list of what the worker actually does.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(swUrl).catch(() => {
    // An unsupported browser or a blocked registration should not take the
    // rest of the app down with it — nothing else here depends on it.
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
