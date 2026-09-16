import type { ReactNode } from 'react';
import { getCurrentMember } from '../data/store.ts';
import { Card, cx } from './primitives.tsx';

/**
 * D2: "an unverified account can see nothing." This is the whole product's
 * front door — one of five states, read once from `getCurrentMember().status`,
 * and every branch but `verified` renders in place of `children`. Nothing
 * behind this component — no nav, no badge count, no board, no tracker row —
 * is ever mounted for an account that fails this check, because React never
 * evaluates `children` unless this function returns it.
 */
export function VerificationGate({ children }: { children: ReactNode }) {
  const member = getCurrentMember();

  if (!member) {
    return (
      <GateScreen title="No active session" tone="stop">
        <p>Choose a persona above to continue.</p>
      </GateScreen>
    );
  }

  if (member.status === 'verified') {
    return <>{children}</>;
  }

  if (member.status === 'pending') {
    // Task 7 reshapes this into the full Pending screen (submitted evidence,
    // the 48-hour expectation) via a store read that does not exist yet.
    return (
      <GateScreen title="We're checking your details" tone="wait">
        <p>
          Verification decisions are made within 48 hours of submission (§6). We'll let you know as soon as a
          reviewer has looked at your case — there is nothing else to do in the meantime.
        </p>
      </GateScreen>
    );
  }

  if (member.status === 'rejected') {
    // Lite has no appeals (Task 7) — this branch says who to contact instead
    // once the store exposes the rejection note; for now it is the plain
    // gate with no appeal path, which is honest about the current surface.
    return (
      <GateScreen title="We couldn't verify your account" tone="stop">
        <p>Contact the alumni office if you believe this is a mistake.</p>
      </GateScreen>
    );
  }

  if (member.status === 'suspended') {
    return (
      <GateScreen title="Your account is suspended" tone="stop">
        <p>You do not have access to Loop while your account is suspended. Contact the alumni office if you believe this is a mistake.</p>
      </GateScreen>
    );
  }

  // status === 'unverified': joined, but no verification case has been
  // submitted yet — distinct from `pending`, which has evidence under review.
  return (
    <GateScreen title="Verify your account to continue" tone="wait">
      <p>
        Loop is alumni-only (§6). Submit your verification details and a reviewer will confirm you within 48 hours.
      </p>
    </GateScreen>
  );
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
