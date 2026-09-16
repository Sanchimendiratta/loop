import { useEffect, useState } from 'react';
import {
  getCurrentMember,
  getMember,
  listCompanies,
  referralAvailabilityFor,
  RuleViolation,
  sendRequest,
} from '../data/store.ts';
import type { ReferralAvailability, RequestDraft } from '../data/store.ts';
import type { ReferralRequest } from '../data/schema.ts';
import { Avatar, Button, Field, Input, Modal, Textarea } from './primitives.tsx';

/**
 * The one shape every "ask for a referral" entry point raises.
 *
 * `Directory.tsx` and `CompanyPage.tsx` fire this from a cold approach — no
 * job post in hand, so `jobPostId` is null and `roleTitle` arrives blank.
 * `PostDetail.tsx`'s bridge fires it from a specific post, so `jobPostId` is
 * always a real string there and `roleTitle` is the post's title. Both are
 * this one type; nothing downstream branches on which shape it came from.
 */
export interface ReferralAsk {
  referrerId: string;
  companyId: string;
  roleTitle: string;
  jobPostId: string | null;
  roleUrl: string | null;
}

/**
 * Reason -> a referrer's own words, per DL1: never a seeker-side quota, always
 * the REFERRER's chosen intake state. Short enough to sit on a disabled
 * button, honest enough that a seeker knows exactly why it is disabled.
 * Lives here — the composer — so every screen that shows an availability
 * reason (the directory, the company page, the composer itself) describes the
 * same `reason` the same way.
 */
const AVAILABILITY_MESSAGE: Record<NonNullable<ReferralAvailability['reason']>, string> = {
  not_open: 'Not open to referring',
  paused: 'Not taking asks right now',
  at_capacity: 'At capacity right now',
  monthly_cap: 'At capacity this month',
};

export function availabilityMessage(a: ReferralAvailability): string {
  if (a.accepting) return '';
  return a.reason ? AVAILABILITY_MESSAGE[a.reason] : 'Not taking referral requests right now';
}

export interface RequestComposerProps {
  open: boolean;
  prefill: ReferralAsk | null;
  onClose: () => void;
  onSent?: (request: ReferralRequest) => void;
}

const PITCH_MAX = 400;

interface FormState {
  roleTitle: string;
  roleUrl: string;
  pitch: string;
}

function initialForm(prefill: ReferralAsk): FormState {
  return { roleTitle: prefill.roleTitle, roleUrl: prefill.roleUrl ?? '', pitch: '' };
}

/**
 * The referral request composer (§5.2, target <=3 minutes).
 *
 * Order is fixed by the spec: target company and referrer arrive pre-filled
 * — every entry point into this component IS a bridge (a tap on someone in
 * the directory, the company page, or a post's alumni list), so there is no
 * from-scratch picker here — then the role (a post's own listing when the ask
 * came from one, a URL typed in when it did not), then the resume already on
 * file, then a 400-char pitch.
 *
 * DL1 is load-bearing here above all: nothing in this component counts, caps
 * or disables Send because of anything the SEEKER has done. The only reason
 * Send is ever unavailable is the REFERRER's own intake state, shown as
 * exactly that — never as the seeker's quota.
 */
export function RequestComposer({ open, prefill, onClose, onSent }: RequestComposerProps) {
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<ReferralRequest | null>(null);

  // Freshly (re)seeded every time this opens — including a second ask right
  // after the first, aimed at a different referrer at the same company, which
  // is exactly the case DL1 exists to keep frictionless.
  useEffect(() => {
    if (open && prefill) {
      setForm(initialForm(prefill));
      setError(null);
      setSent(null);
    }
  }, [open, prefill]);

  if (!open || !prefill || !form) return null;

  const member = getCurrentMember();
  const referrer = getMember(prefill.referrerId);
  const company = listCompanies().find((c) => c.id === prefill.companyId) ?? null;
  const availability = referralAvailabilityFor(prefill.referrerId, Date.now());
  const fromPost = prefill.jobPostId !== null;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  function handleClose() {
    setForm(null);
    setError(null);
    setSent(null);
    onClose();
  }

  function handleDone() {
    if (sent && onSent) onSent(sent);
    handleClose();
  }

  function validate(f: FormState): string | null {
    if (!f.roleTitle.trim()) return 'Name the role you want referring for.';
    if (!f.pitch.trim()) return 'Add a short note so they know what you are asking for.';
    return null;
  }

  function handleSend() {
    if (!form || !prefill) return;
    const clientError = validate(form);
    if (clientError) {
      setError(clientError);
      return;
    }
    const draft: RequestDraft = {
      referrerId: prefill.referrerId,
      companyId: prefill.companyId,
      roleTitle: form.roleTitle.trim(),
      pitch: form.pitch.trim(),
      roleUrl: form.roleUrl.trim() || null,
      jobPostId: prefill.jobPostId,
    };
    try {
      const request = sendRequest(draft);
      setSent(request);
      setError(null);
    } catch (e) {
      if (e instanceof RuleViolation) {
        setError(e.message);
      } else {
        throw e;
      }
    }
  }

  if (!member) {
    return (
      <Modal open onClose={handleClose} title="Ask for a referral">
        <p className="text-sm text-stone-600">You need to be a verified member to send a referral request.</p>
      </Modal>
    );
  }

  if (sent) {
    return (
      <Modal open onClose={handleDone} title="Request sent">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-stone-700">
            Your request is on its way to {referrer?.name ?? 'them'}. You can track it from Requests, or ask
            someone else right away — nothing here is limited on your side.
          </p>
          <div>
            <Button variant="primary" onClick={handleDone}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={handleClose} title="Ask for a referral" subtitle={company?.name ?? undefined} width="max-w-lg">
      <div className="flex flex-col gap-4">
        {/* 1. Target company + referrer — always pre-filled here, since every
            entry point into this composer is itself a bridge from a specific
            person's row. */}
        {referrer ? (
          <div className="flex items-center gap-3 rounded-lg bg-stone-50 px-3 py-2 ring-1 ring-stone-200">
            <Avatar name={referrer.name} size={32} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-stone-900">{referrer.name}</p>
              <p className="truncate text-xs text-stone-500">
                {referrer.title ? `${referrer.title} · ` : ''}
                {company?.name ?? 'Undisclosed company'}
              </p>
            </div>
          </div>
        ) : null}

        {/* Referrer capacity, shown as THEIR state (DL1) — never a seeker
            quota. Disables Send but nothing else on this screen. */}
        {!availability.accepting ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-500/30">
            {referrer?.name ?? 'This person'} is {availabilityMessage(availability).toLowerCase()} — this is their
            own intake state, not a limit on you. Check back later, or ask someone else at {company?.name ?? 'this company'} instead.
          </p>
        ) : null}

        {/* 2. The role — already fixed when the ask came from a post's own
            listing; typed in when it did not. */}
        {fromPost ? (
          <Field label="Role">
            <div className="rounded-lg bg-stone-50 px-3 py-2 ring-1 ring-stone-200">
              <p className="text-sm font-medium text-stone-800">{form.roleTitle}</p>
              {form.roleUrl ? (
                <a href={form.roleUrl} target="_blank" rel="noreferrer" className="text-xs text-brand-600 underline">
                  View the role
                </a>
              ) : (
                <p className="text-xs text-stone-500">From this alum's post.</p>
              )}
            </div>
          </Field>
        ) : (
          <>
            <Field label="Role title" required>
              <Input
                value={form.roleTitle}
                onChange={(e) => set('roleTitle', e.currentTarget.value)}
                placeholder="e.g. Senior Product Manager"
              />
            </Field>
            <Field label="Role URL" hint="Optional — a JD link, if you have one.">
              <Input
                value={form.roleUrl}
                onChange={(e) => set('roleUrl', e.currentTarget.value)}
                placeholder="https://…"
              />
            </Field>
          </>
        )}

        {/* 3. Resume — reused from whatever is already on file. No upload
            here: that happens once, from a profile screen, not on every ask. */}
        <p className="text-xs text-stone-500">
          {member.resumeVersionId
            ? `Your resume on file will be shared with ${referrer?.name ?? 'the referrer'}.`
            : `You have no resume on file — ${referrer?.name ?? 'the referrer'} will not see one attached.`}
        </p>

        {/* 4. The pitch — the one thing a referrer actually reads. */}
        <Field label="Your pitch" required>
          <Textarea
            value={form.pitch}
            onChange={(e) => set('pitch', e.currentTarget.value.slice(0, PITCH_MAX))}
            maxLength={PITCH_MAX}
            placeholder="Who you are, why this role, and why them."
            className="min-h-28"
          />
          <p className="mt-1 text-right text-xs text-stone-400">
            {form.pitch.length}/{PITCH_MAX}
          </p>
        </Field>

        {error ? (
          <p className="rounded-lg bg-[var(--color-owed-soft)] px-3 py-2 text-sm font-medium text-[var(--color-owed)]">
            {error}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSend} disabled={!availability.accepting}>
            Send request
          </Button>
        </div>
      </div>
    </Modal>
  );
}
