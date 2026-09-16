import { useState } from 'react';
import { getCurrentMember, listPersonas, pendingCases, setCurrentMember } from '../data/store.ts';
import { Avatar, Select } from './primitives.tsx';
import { Admin } from './Admin.tsx';
import { Board } from './Board.tsx';
import { Shell } from './Shell.tsx';
import type { NavItem } from './Shell.tsx';
import { VerificationGate } from './VerificationGate.tsx';
import { useNow, useStoreVersion } from './useStore.ts';

// Lite's nav is reshaped in Task 7 (Board · My applications · My posts ·
// Admin); until then this is deliberately down to the two screens that
// survived Task 1's prune.
type View = 'board' | 'admin';

export function App() {
  useStoreVersion();
  const now = useNow();
  const [view, setView] = useState<View>('board');

  function handleNavigate(id: string): void {
    setView(id as View);
  }

  const member = getCurrentMember();
  const isVerified = member?.status === 'verified';

  // Every demo identity. Lite's seed is 8 named personas covering all three
  // gate states, so there is no filler roster left to curate down.
  const personas = listPersonas();

  // Viewer-scoped by the store: `pendingCases()` already returns [] for
  // anyone who is not a verified admin, so this badge cannot leak a count.
  const queueSize = pendingCases().length;

  const nav: NavItem[] = isVerified
    ? [
        { id: 'board', label: 'Board' },
        ...(member?.isAdmin ? [{ id: 'admin', label: 'Admin', badge: queueSize }] : []),
      ]
    : [];

  return (
    <div className="flex h-full flex-col">
      {/*
       * Stands in for Google's account chooser (design doc rationale): reads
       * `getCurrentMember()` (always yours) and `listPersonas()` (a
       * name+status projection built for exactly this, never network data),
       * so it works no matter the current persona's verification status —
       * unlike `Shell` below, which the gate hides entirely. It has to stay
       * reachable, or switching off an unverified persona would be impossible
       * from inside the very state that persona is stuck in.
       */}
      <div className="flex items-center gap-3 border-b border-stone-200 bg-white px-6 py-2">
        <span className="grid size-7 place-items-center rounded-lg bg-brand-600 text-xs font-bold text-white">
          L
        </span>
        <p className="text-sm font-semibold text-stone-900">Loop</p>
        <div className="ml-auto flex items-center gap-2">
          {member ? <Avatar name={member.name} size={26} /> : null}
          <Select
            value={member?.id ?? ''}
            onChange={(e) => setCurrentMember(e.currentTarget.value)}
            className="w-56 !py-1 text-xs"
            aria-label="Switch persona"
          >
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.status}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <VerificationGate>
          <Shell nav={nav} active={view} onNavigate={handleNavigate}>
            {/* No detail screen — Task 8 rewrites the board to expand a row
                in place instead, so there is nothing yet for a post id to
                open into. */}
            {view === 'board' ? <Board now={now} onOpenPost={() => {}} /> : null}
            {view === 'admin' ? <Admin now={now} /> : null}
          </Shell>
        </VerificationGate>
      </div>
    </div>
  );
}
