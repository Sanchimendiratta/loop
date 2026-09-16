import { useState } from 'react';
import { getCurrentMember, listPersonas, myApplications, myPosts, pendingCases, setCurrentMember } from '../data/store.ts';
import { Avatar, EmptyState, Select } from './primitives.tsx';
import { Admin } from './Admin.tsx';
import { Board } from './Board.tsx';
import { makeGoogleIdentity } from './Login.tsx';
import { Shell } from './Shell.tsx';
import type { NavItem } from './Shell.tsx';
import { requestNewGoogleSignIn, VerificationGate } from './VerificationGate.tsx';
import { useNow, useStoreVersion } from './useStore.ts';

/** Sentinel `<option>` values for the two "sign in fresh" entries below. Never a real member id, so `setCurrentMember` must never see one. */
const NEW_XLRI_ACCOUNT = '__new_xlri__';
const NEW_PERSONAL_ACCOUNT = '__new_personal__';

// Lite's nav (Task 7): Board, the two personal sheets, and Admin for the one
// member allowed to see it. `PostDetail`/`Directory`/`Tracker`/`Profile` do
// not survive from v1.3 — Lite has no directory and no referral-request
// object, so there is nothing left for those routes to show.
type View = 'board' | 'applications' | 'posts' | 'admin';

export function App() {
  useStoreVersion();
  const now = useNow();
  const [view, setView] = useState<View>('board');

  function handleNavigate(id: string): void {
    setView(id as View);
  }

  /**
   * The two sentinel options don't name a member, so they can't go through
   * `setCurrentMember` — they hand a fabricated identity to
   * `VerificationGate`'s "new sign-in" slot instead, which takes priority
   * over whatever session is already active. This is the one way to reach
   * the Get-verified form (screen 2) other than a truly first-ever visit:
   * signing in with a second Google account without first signing out of the
   * one already open, exactly as this switcher itself stays reachable no
   * matter what the active session's gate state is.
   */
  function handleSwitcherChange(value: string): void {
    if (value === NEW_XLRI_ACCOUNT) {
      requestNewGoogleSignIn(makeGoogleIdentity('astra.xlri.ac.in'));
      return;
    }
    if (value === NEW_PERSONAL_ACCOUNT) {
      requestNewGoogleSignIn(makeGoogleIdentity('gmail.com'));
      return;
    }
    setCurrentMember(value);
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
        { id: 'applications', label: 'My applications' },
        { id: 'posts', label: 'My posts' },
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
            onChange={(e) => handleSwitcherChange(e.currentTarget.value)}
            className="w-56 !py-1 text-xs"
            aria-label="Switch persona"
          >
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.status}
              </option>
            ))}
            <option value={NEW_XLRI_ACCOUNT}>+ New Google sign-in — institute address</option>
            <option value={NEW_PERSONAL_ACCOUNT}>+ New Google sign-in — personal address</option>
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
            {view === 'applications' ? <MyApplicationsPlaceholder now={now} /> : null}
            {view === 'posts' ? <MyPostsPlaceholder /> : null}
            {view === 'admin' ? <Admin now={now} /> : null}
          </Shell>
        </VerificationGate>
      </div>
    </div>
  );
}

/**
 * Placeholder, on purpose — same reduction `Board.tsx` and `Admin.tsx` went
 * through: the nav entry and the store read (`myApplications`, already
 * viewer-scoped) exist now so a later task builds the sheet against real
 * data, but the sheet's layout is that task's job, not Task 7's.
 */
function MyApplicationsPlaceholder({ now }: { now: number }) {
  const count = myApplications(now).length;
  return (
    <div className="p-6">
      <EmptyState
        title="My applications"
        body={`You have ${count} application${count === 1 ? '' : 's'} on file. The tracker sheet is built in a later task, against this same myApplications() read.`}
      />
    </div>
  );
}

function MyPostsPlaceholder() {
  const count = myPosts().length;
  return (
    <div className="p-6">
      <EmptyState
        title="My posts"
        body={`You have ${count} post${count === 1 ? '' : 's'} on the board. This sheet is built in a later task, against this same myPosts() read.`}
      />
    </div>
  );
}
