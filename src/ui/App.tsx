import { useState } from 'react';
import { getCurrentMember, listCases, listPersonas, setCurrentMember, trackerFor } from '../data/store.ts';
import { Avatar, EmptyState, Select } from './primitives.tsx';
import { Board } from './Board.tsx';
import { PostDetail } from './PostDetail.tsx';
import type { ReferralBridgeRequest } from './PostDetail.tsx';
import { Shell } from './Shell.tsx';
import type { NavItem } from './Shell.tsx';
import { VerificationGate } from './VerificationGate.tsx';
import { useNow, useStoreVersion } from './useStore.ts';

type View = 'board' | 'tracker' | 'directory' | 'requests' | 'admin';

/** A screen a later task owns. Renders nothing but its own name. */
function Placeholder({ label }: { label: string }) {
  return (
    <div className="p-8">
      <EmptyState title={`${label} is on its way`} body="This screen is built in a later task." />
    </div>
  );
}

export function App() {
  useStoreVersion();
  const now = useNow();
  const [view, setView] = useState<View>('board');
  const [openPostId, setOpenPostId] = useState<string | null>(null);

  // Task 21 owns the referral request composer and its lifecycle. Until it
  // exists, the bridge's callback has nowhere real to hand off to — logging
  // is the smallest honest stand-in, and deliberately not a second, half-built
  // composer living in this task's scope.
  function handleRequestReferral(req: ReferralBridgeRequest): void {
    console.info('[Task 21 TODO] open referral request composer, pre-filled with:', req);
  }

  const member = getCurrentMember();
  const isVerified = member?.status === 'verified';

  // Every demo identity, curated down to the six named personas (§4) plus the
  // three filler accounts seeded in non-verified states (Task 14) — dumping
  // all ~230 filler alumni into one <select> would bury the very three the
  // gate exists to demonstrate. `m_fill_200` is verified (Tier C), so it drops
  // out along with the rest.
  const personas = listPersonas().filter((p) => !p.id.startsWith('m_fill_') || p.status !== 'verified');

  // Badge counts are store reads, gated the same way the gate itself is: an
  // unverified viewer's own `trackerFor`/`listCases` calls already answer
  // empty, but computing them at all here would be a habit worth not forming.
  const owedCount = isVerified && member ? trackerFor(member.id, now).filter((r) => r.owed === 'you').length : 0;
  const pendingCases = isVerified && member?.isAdmin ? listCases().filter((c) => c.decision === 'pending').length : 0;

  const nav: NavItem[] = isVerified
    ? [
        { id: 'board', label: 'Board' },
        { id: 'tracker', label: 'Tracker', badge: owedCount },
        { id: 'directory', label: 'Directory' },
        { id: 'requests', label: 'Requests' },
        ...(member?.isAdmin ? [{ id: 'admin', label: 'Admin', badge: pendingCases }] : []),
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
          <Shell nav={nav} active={view} onNavigate={(id) => setView(id as View)}>
            {view === 'board' ? <Board now={now} onOpenPost={setOpenPostId} /> : null}
            {view === 'tracker' ? <Placeholder label="Tracker" /> : null}
            {view === 'directory' ? <Placeholder label="Directory" /> : null}
            {view === 'requests' ? <Placeholder label="Requests" /> : null}
            {view === 'admin' ? <Placeholder label="Admin" /> : null}
          </Shell>
        </VerificationGate>
      </div>

      {openPostId ? (
        <PostDetail
          postId={openPostId}
          now={now}
          onClose={() => setOpenPostId(null)}
          onRequestReferral={handleRequestReferral}
        />
      ) : null}
    </div>
  );
}
