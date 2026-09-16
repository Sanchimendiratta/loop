import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.tsx';
import { load } from './data/store.ts';
import swUrl from './sw.ts?worker&url';
import './styles.css';

// Seeds or rehydrates AND runs the clock (unlike `reset`), so a session
// returning after time has passed sees requests and posts caught up rather
// than frozen at whenever the demo was authored.
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
