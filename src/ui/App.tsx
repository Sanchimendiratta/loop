import { useState } from 'react';
import {
  beginNewSignIn,
  getCurrentMember,
  listPersonas,
  signOut,
  pendingCases,
  setCurrentMember,
} from '../data/store.ts';
import { Avatar, Select } from './primitives.tsx';
import { Admin } from './Admin.tsx';
import { Board } from './Board.tsx';
import { makeGoogleIdentity } from './Login.tsx';
import { MyApplications } from './MyApplications.tsx';
import { MyPosts } from './MyPosts.tsx';
import { Shell } from './Shell.tsx';
import type { NavItem } from './Shell.tsx';
import { VerificationGate } from './VerificationGate.tsx';
import { useNow, useStoreVersion } from './useStore.ts';

/** Sentinel `<option>` values for the two "sign in fresh" entries below. Never a real member id, so `setCurrentMember` must never see one. */
const NEW_XLRI_ACCOUNT = '__new_xlri__';
const NEW_PERSONAL_ACCOUNT = '__new_personal__';
const SIGN_OUT = '__sign_out__';

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
   * `store.beginNewSignIn` instead, which takes priority over whatever
   * session is already active (see that function's docblock). This is the
   * one way to reach the Get-verified form (screen 2) other than a truly
   * first-ever visit: signing in with a second Google account without first
   * signing out of the one already open, exactly as this switcher itself
   * stays reachable no matter what the active session's gate state is.
   */
  function handleSwitcherChange(value: string): void {
    if (value === NEW_XLRI_ACCOUNT) {
      beginNewSignIn(makeGoogleIdentity('astra.xlri.ac.in'));
      return;
    }
    if (value === NEW_PERSONAL_ACCOUNT) {
      beginNewSignIn(makeGoogleIdentity('gmail.com'));
      return;
    }
    // The only route to screen 1. Every other option names or fabricates an
    // identity; this one empties the session, which is the single state the
    // gate renders `Login` for.
    if (value === SIGN_OUT) {
      signOut();
      return;
    }
    // The signed-out placeholder below carries an empty value. It is a label
    // for a state, not an account to switch to — and `setCurrentMember`
    // rightly refuses an id no member has.
    if (value === '') return;
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
            {/*
              * With no session, `value` matches no option and a <select>
              * falls back to displaying its first one — so the switcher read
              * "Ananya Rao — verified" while the member was signed out and
              * every scoped read was correctly returning empty. The state was
              * right and the control was lying about it. This option exists so
              * it has something true to display, and only while that state
              * lasts.
              */}
            {member ? null : (
              <option value="">Signed out — choose an account</option>
            )}
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} — {p.status}
              </option>
            ))}
            <option value={NEW_XLRI_ACCOUNT}>+ New Google sign-in — institute address</option>
            <option value={NEW_PERSONAL_ACCOUNT}>+ New Google sign-in — personal address</option>
            <option value={SIGN_OUT}>Sign out — show the sign-in screen</option>
          </Select>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <VerificationGate>
          <Shell nav={nav} active={view} onNavigate={handleNavigate} now={now}>
            {/* No detail screen — Task 8 rewrote the board to expand a row
                in place instead, so there is nothing for a post id to open
                into. */}
            {view === 'board' ? <Board now={now} /> : null}
            {view === 'applications' ? (
              <MyApplications now={now} onBrowseBoard={() => setView('board')} />
            ) : null}
            {view === 'posts' ? <MyPosts now={now} onPostRole={() => setView('board')} /> : null}
            {view === 'admin' ? <Admin now={now} /> : null}
          </Shell>
        </VerificationGate>
      </div>
    </div>
  );
}
