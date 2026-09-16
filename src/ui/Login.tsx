import { listPersonas, setCurrentMember } from '../data/store.ts';
import { Button, Card } from './primitives.tsx';

export interface GoogleIdentity {
  googleSub: string;
  email: string;
}

/**
 * Fabricates a plausible, never-before-seen Google identity on the domain a
 * tester picked. Shared with `App`'s top-bar "continue with a different
 * Google account" control, which is the other place this same fake sign-in
 * has to originate from (see that file for why: a real session already in
 * progress needs a way to start a second one without an explicit sign-out).
 */
export function makeGoogleIdentity(domain: 'astra.xlri.ac.in' | 'gmail.com'): GoogleIdentity {
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
  return { googleSub: `g_new_${stamp}`, email: `new.member.${stamp}@${domain}` };
}

export interface LoginProps {
  /**
   * Fired once, when the visitor picks a Google account to continue with. A
   * real integration hands this the account Google returned; there is no
   * such integration here (§3: Google sign-in only, no passwords, no OTP), so
   * the two buttons below fabricate a plausible identity for each of the two
   * domains D2 actually branches on — an institute address and a personal
   * one. `VerificationGate` decides what happens next; this component's only
   * job is choosing who just signed in.
   */
  onGoogleSignIn: (identity: GoogleIdentity) => void;
}

/**
 * Screen 1. Nothing behind `VerificationGate` is reachable until this
 * resolves to a member id, so it has to offer two independent ways in:
 *
 *   1. "Continue with Google" — the real product's only sign-in method,
 *      simulated here as two buttons standing in for the two email domains
 *      that produce different outcomes downstream (an instant Tier-A pass vs.
 *      a form that waits on a reviewer). Either one hands a fresh, unseeded
 *      identity to `VerificationGate`, which is what makes the Get-verified
 *      form (screen 2) reachable at all.
 *   2. A persona switcher, exactly like the one that sits above this
 *      component in `App` (design doc rationale) — it stands in for
 *      Google's own account chooser. It has to be able to land on a verified,
 *      a pending AND a rejected member, or screens 2 and 3 have no way to be
 *      exercised: the seed's members are all already-decided accounts, so
 *      picking one here is the only way to see the Pending or the rejected
 *      gate without first submitting the form above.
 */
export function Login({ onGoogleSignIn }: LoginProps) {
  const personas = listPersonas();

  function signInWith(domain: 'astra.xlri.ac.in' | 'gmail.com'): void {
    onGoogleSignIn(makeGoogleIdentity(domain));
  }

  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card className="w-full max-w-sm p-6">
        <span className="grid size-10 place-items-center rounded-lg bg-brand-600 text-base font-bold text-white">
          L
        </span>
        <h1 className="mt-3 text-base font-semibold text-stone-900">Sign in to Loop</h1>
        <p className="mt-1 text-sm text-stone-600">The XLRI Jamshedpur alumni referral board.</p>

        <div className="mt-5 flex flex-col gap-2">
          <Button
            type="button"
            variant="primary"
            onClick={() => signInWith('astra.xlri.ac.in')}
            className="w-full"
          >
            Continue with Google — institute address
          </Button>
          <Button type="button" variant="secondary" onClick={() => signInWith('gmail.com')} className="w-full">
            Continue with Google — personal address
          </Button>
        </div>

        <p className="mt-4 text-xs text-stone-500">
          No passwords, no OTP. Loop only ever asks Google who you are.
        </p>

        {personas.length > 0 ? (
          <div className="mt-6 border-t border-stone-200 pt-4">
            <p className="mb-2 text-xs font-medium text-stone-500">Or continue as a demo account</p>
            <div className="flex flex-col gap-1.5">
              {personas.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setCurrentMember(p.id)}
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm text-stone-700 ring-1 ring-stone-200 transition-colors hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                >
                  <span>{p.name}</span>
                  <span className="text-xs text-stone-400">{p.status}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
