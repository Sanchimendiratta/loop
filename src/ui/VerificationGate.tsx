import type { ReactNode } from 'react';
import { useState } from 'react';
import { getCurrentMember, myVerificationCase, RuleViolation, submitAppeal } from '../data/store.ts';
import type { VerificationCase } from '../data/schema.ts';
import { canAppeal } from '../core/verification.ts';
import { Button, Card, cx, Field, Input } from './primitives.tsx';

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
    const c = myVerificationCase();
    return (
      <GateScreen title="We're checking your details" tone="wait">
        <p>
          Verification decisions are made within 48 hours of submission (§6). We'll let you know as soon as a
          reviewer has looked at your case — there is nothing else to do in the meantime.
        </p>
        {c ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-lg bg-stone-50 p-3 text-xs">
            <dt className="font-medium text-stone-500">Submitted</dt>
            <dd className="text-stone-800">{new Date(c.submittedAt).toLocaleString()}</dd>
            <dt className="font-medium text-stone-500">Tier requested</dt>
            <dd className="text-stone-800">Tier {c.tier}</dd>
            <dt className="font-medium text-stone-500">Name at graduation</dt>
            <dd className="text-stone-800">{c.evidence.nameAtGraduation}</dd>
            <dt className="font-medium text-stone-500">Batch / programme</dt>
            <dd className="text-stone-800">
              {c.evidence.batch} · {c.evidence.programme}
            </dd>
            <dt className="font-medium text-stone-500">LinkedIn</dt>
            <dd className="truncate text-stone-800">{c.evidence.linkedinUrl}</dd>
          </dl>
        ) : null}
      </GateScreen>
    );
  }

  if (member.status === 'rejected') {
    const c = myVerificationCase();
    const mayAppeal = c !== null && canAppeal(c);
    return (
      <GateScreen title="We couldn't verify your account" tone="stop">
        <p>{c?.notes || 'No reason was recorded for this decision.'}</p>
        {mayAppeal ? (
          <AppealForm evidence={c.evidence} />
        ) : (
          <p className="text-xs text-stone-500">
            This decision is final — the one appeal §6 allows has already been used.
          </p>
        )}
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

/**
 * §6: the one appeal a rejected member may bring, with new evidence.
 *
 * Prefilled from the rejected case's own submission, so a member correcting
 * one wrong detail does not have to retype the rest. `submitAppeal` moves the
 * member back to `pending` on success, so this component simply stops being
 * rendered — `VerificationGate` re-reads `member.status` and switches
 * branches on the very next commit, which is the confirmation.
 */
function AppealForm({ evidence }: { evidence: VerificationCase['evidence'] }) {
  const [open, setOpen] = useState(false);
  const [linkedinUrl, setLinkedinUrl] = useState(evidence.linkedinUrl);
  const [nameAtGraduation, setNameAtGraduation] = useState(evidence.nameAtGraduation);
  const [batch, setBatch] = useState(evidence.batch);
  const [programme, setProgramme] = useState(evidence.programme);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return (
      <div className="flex flex-col items-center gap-2">
        <Button variant="primary" size="sm" onClick={() => setOpen(true)}>
          Appeal this decision
        </Button>
        <p className="text-xs text-stone-500">
          §6 allows one appeal, with new evidence, reviewed by a second admin.
        </p>
      </div>
    );
  }

  function handleSubmit() {
    try {
      submitAppeal({ linkedinUrl, batch, programme, nameAtGraduation });
      setError(null);
    } catch (e) {
      if (e instanceof RuleViolation) {
        setError(e.message);
      } else {
        throw e;
      }
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-stone-50 p-3 text-left ring-1 ring-stone-200">
      <Field label="LinkedIn URL">
        <Input value={linkedinUrl} onChange={(e) => setLinkedinUrl(e.currentTarget.value)} />
      </Field>
      <Field label="Name at graduation">
        <Input value={nameAtGraduation} onChange={(e) => setNameAtGraduation(e.currentTarget.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Batch">
          <Input type="number" value={batch} onChange={(e) => setBatch(Number(e.currentTarget.value))} />
        </Field>
        <Field label="Programme">
          <Input value={programme} onChange={(e) => setProgramme(e.currentTarget.value)} />
        </Field>
      </div>
      {error ? <p className="text-xs font-medium text-[var(--color-owed)]">{error}</p> : null}
      <div className="flex gap-2">
        <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button variant="primary" size="sm" onClick={handleSubmit}>
          Submit appeal
        </Button>
      </div>
    </div>
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
