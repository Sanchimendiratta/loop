import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App.tsx';
import { load } from './data/store.ts';
import './styles.css';

// Seeds or rehydrates AND runs the clock (unlike `reset`), so a session
// returning after time has passed sees requests and posts caught up rather
// than frozen at whenever the demo was authored.
load();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
