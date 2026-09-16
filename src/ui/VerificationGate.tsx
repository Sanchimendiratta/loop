import type { FormEvent, ReactNode } from 'react';
import { useState, useSyncExternalStore } from 'react';
import { getCurrentMember, setCurrentMember, submitVerification } from '../data/store.ts';
import type { Member } from '../data/schema.ts';
import { PROGRAMMES } from '../data/schema.ts';
import type { Programme } from '../data/schema.ts';
import { Button, Card, Field, Input, Select, cx } from './primitives.tsx';
import { Login } from './Login.tsx';
import type { GoogleIdentity } from './Login.tsx';

/**
 * A UI-only "someone just signed in with a Google account we've never seen"
 * signal — deliberately not store state (it names no member yet; there is
 * nothing to persist until the form below is submitted) and deliberately not
 * component state either, because it has two independent triggers:
 * `Login`'s own buttons (the true first-visit path) and `App`'s top-bar
 * "continue with a different Google account" control, reachable even while
 * an existing session is verified, pending or rejected — the same way the
 * persona switcher next to it stays reachable regardless of gate state.
 * Small pub-sub, same shape as `useStore.ts`'s version counter.
 */
let newSignIn: GoogleIdentity | null = null;
const newSignInListeners = new Set<() => void>();
function notifyNewSignIn(): void {
  for (const fn of newSignInListeners) fn();
}

/** Called by `Login` and by `App`'s top bar; both hand it a fabricated identity. */
export function requestNewGoogleSignIn(identity: GoogleIdentity): void {
  newSignIn = identity;
  notifyNewSignIn();
}

function clearNewGoogleSignIn(): void {
  newSignIn = null;
  notifyNewSignIn();
}

function useNewGoogleSignIn(): GoogleIdentity | null {
  const subscribe = (fn: () => void) => {
    newSignInListeners.add(fn);
    return () => newSignInListeners.delete(fn);
  };
  const snapshot = () => newSignIn;
  // Both the client and server snapshot args are the same reader — this is
  // module state, not a browser API, so it reads identically under Vite's
  // SSR loader (see scripts/smoke.mjs) as it does in the browser.
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * D2: "an unverified account can see nothing." This is the whole product's
 * front door — every one of Lite's member states, read once from
 * `getCurrentMember()`, and every branch but `verified` renders in place of
 * `children`. Nothing behind this component — no nav, no badge count, no
 * board, no sheet row — is ever mounted for an account that fails this
 * check, because React never evaluates `children` unless this function
 * returns it.
 *
 * This is a second line, not the line: the rule itself lives in
 * `store.viewerOrNull()`, which every read begins with. A screen that forgot
 * to mount inside this gate would still be handed nothing.
 *
 * A fresh Google identity with no matching row takes priority over whatever
 * `getCurrentMember()` says, including a currently-verified session: signing
 * in with a second Google account is something a person can do without first
 * signing out of the first one, exactly like the persona switcher above this
 * gate stays reachable regardless of gate state. Once the form below is
 * submitted, `setCurrentMember` moves the session onto the new row and this
 * branch stops matching.
 *
 * Short of that, `getCurrentMember()` returning `null` means nobody has
 * signed in at all → `Login`.
 */
export function VerificationGate({ children }: { children: ReactNode }) {
  const newSignInIdentity = useNewGoogleSignIn();
  const member = getCurrentMember();

  if (newSignInIdentity) {
    return (
      <GetVerifiedForm
        identity={newSignInIdentity}
        onCancel={clearNewGoogleSignIn}
        onSubmitted={(created) => {
          setCurrentMember(created.id);
          clearNewGoogleSignIn();
        }}
      />
    );
  }

  if (!member) {
    return <Login onGoogleSignIn={requestNewGoogleSignIn} />;
  }

  if (member.status === 'verified') {
    return <>{children}</>;
  }

  if (member.status === 'pending') {
    return <PendingScreen member={member} />;
  }

  // status === 'rejected'. Lite has no appeals — §3 drops the second-reviewer
  // path with the case table — so this branch names who to contact instead of
  // offering one. `MemberStatus` is three values now, so there is nothing
  // after this to branch on.
  return <RejectedScreen member={member} />;
}

function GateScreen({ title, tone, children }: { title: string; tone: 'wait' | 'stop'; children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6">
      <Card className="w-full max-w-md p-6">
        <div
          className={cx(
            'mx-auto mb-3 grid size-10 place-items-center rounded-full text-lg font-semibold',
            tone === 'wait'
              ? 'bg-stone-100 text-stone-500'
              : 'bg-[var(--color-owed-soft)] text-[var(--color-owed)]',
          )}
          aria-hidden="true"
        >
          {tone === 'wait' ? '…' : '!'}
        </div>
        <h1 className="text-center text-base font-semibold text-stone-900">{title}</h1>
        <div className="mt-3 space-y-3 text-sm text-stone-600">{children}</div>
      </Card>
    </div>
  );
}

/**
 * Screen 3. Everything a pending member is allowed to know: what they
 * submitted, and the 48-hour expectation §6 sets for a reviewer to act on it.
 * Nothing else renders — no nav, no board, no counts — because this is the
 * entire return value of the branch; `Shell` is never mounted underneath it.
 */
function PendingScreen({ member }: { member: Member }) {
  return (
    <GateScreen title="We're checking your details" tone="wait">
      <p>
        Verification decisions are made within 48 hours of submission (§6). We'll let you know as soon as a
        reviewer has looked at your case — there is nothing else to do in the meantime.
      </p>
      <dl className="space-y-1.5 rounded-lg bg-stone-50 p-3 text-xs">
        <Row label="Name" value={member.name} />
        <Row label="Batch" value={String(member.batch)} />
        <Row label="Programme" value={member.programme} />
        <Row label="LinkedIn" value={member.linkedinUrl} />
      </dl>
      {/* "Known by" is deliberately not echoed here: it names a real, possibly
          verified, member, and D2 says nothing renders behind this gate but
          the viewer's own data — this field is about someone else. */}
    </GateScreen>
  );
}

/**
 * Lite has no appeals (§3 drops the second-reviewer path along with the case
 * table), so there is no button here — only the decision note a reviewer
 * recorded, plainly, and who to contact if it looks wrong.
 */
function RejectedScreen({ member }: { member: Member }) {
  return (
    <GateScreen title="We couldn't verify your account" tone="stop">
      <p className="rounded-lg bg-stone-50 p-3 text-stone-700">
        {member.decisionNote || 'No reason was recorded.'}
      </p>
      <p>Contact the alumni office at alumni.office@astra.xlri.ac.in if you believe this is a mistake.</p>
    </GateScreen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-stone-500">{label}</dt>
      <dd className="truncate text-right font-medium text-stone-700">{value}</dd>
    </div>
  );
}

const currentYear = new Date().getFullYear();
/** A century of batches back from this one — far more than the seed ever needs, so the picker never clips a real answer. */
const BATCH_YEARS = Array.from({ length: 100 }, (_, i) => currentYear - i);

/**
 * Screen 2. Four fields plus the optional fifth (§3) — and deliberately no
 * college name. The platform is XLRI-only, so that answer is always the same
 * and would verify nothing; batch and programme are what a reviewer actually
 * checks a LinkedIn page against.
 */
function GetVerifiedForm({
  identity,
  onCancel,
  onSubmitted,
}: {
  identity: GoogleIdentity;
  onCancel: () => void;
  onSubmitted: (member: Member) => void;
}) {
  const [name, setName] = useState('');
  const [linkedinUrl, setLinkedinUrl] = useState('');
  const [batch, setBatch] = useState<number>(currentYear);
  const [programme, setProgramme] = useState<Programme>(PROGRAMMES[0]);
  const [knownBy, setKnownBy] = useState('');

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const created = submitVerification({
      googleSub: identity.googleSub,
      email: identity.email,
      name: name.trim(),
      batch,
      programme,
      linkedinUrl: linkedinUrl.trim(),
      knownBy: knownBy.trim() || null,
    });
    onSubmitted(created);
  }

  return (
    <div className="flex h-full items-center justify-center overflow-y-auto p-6">
      <Card className="w-full max-w-md p-6">
        <h1 className="text-base font-semibold text-stone-900">Get verified</h1>
        <p className="mt-1 text-sm text-stone-600">
          Signed in as <span className="font-medium text-stone-800">{identity.email}</span>. A few details so a
          reviewer can match you to your LinkedIn profile.
        </p>

        <form className="mt-4 flex flex-col gap-4" onSubmit={handleSubmit}>
          <Field label="Full name (as on LinkedIn)" required>
            <Input value={name} onChange={(e) => setName(e.currentTarget.value)} required autoComplete="name" />
          </Field>

          <Field label="LinkedIn profile URL" hint="Stored as text. Loop never visits or reads it." required>
            <Input
              type="url"
              value={linkedinUrl}
              onChange={(e) => setLinkedinUrl(e.currentTarget.value)}
              placeholder="https://linkedin.com/in/…"
              required
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Batch / graduation year" required>
              <Select value={batch} onChange={(e) => setBatch(Number(e.currentTarget.value))} required>
                {BATCH_YEARS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Programme" required>
              <Select value={programme} onChange={(e) => setProgramme(e.currentTarget.value as Programme)} required>
                {PROGRAMMES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <Field label="Name one XLRI person who knows you (optional)">
            <Input value={knownBy} onChange={(e) => setKnownBy(e.currentTarget.value)} />
          </Field>

          <div className="mt-1 flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onCancel}>
              Back
            </Button>
            <Button type="submit" variant="primary">
              Submit for review
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
