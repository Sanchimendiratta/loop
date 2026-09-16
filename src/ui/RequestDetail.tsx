import { useState } from 'react';
import {
  advanceRequest,
  getCurrentMember,
  getMember,
  getRequest,
  listCompanies,
  requestEventsFor,
  RuleViolation,
} from '../data/store.ts';
import { actorMayTransition, isTerminal, TRANSITIONS } from '../core/requests.ts';
import { daysBetween } from '../core/time.ts';
import type { DeclineReason, RequestEvent, RequestState } from '../data/schema.ts';
import { Avatar, Button, Chip, Modal } from './primitives.tsx';
import type { Tone } from './primitives.tsx';

export interface RequestDetailProps {
  requestId: string;
  now: number;
  onClose: () => void;
}

/** Shared with `Requests.tsx` so the two surfaces cannot describe a state two
 * different ways. */
export const REQUEST_STATE_LABEL: Record<RequestState, string> = {
  sent: 'Awaiting a reply',
  accepted: 'Accepted — not yet submitted',
  submitted: 'Submitted',
  recruiter_contact: 'Recruiter in touch',
  interviewing: 'Interviewing',
  declined: 'Declined',
  offer: 'Offer',
  rejected: 'Not selected',
  no_response: 'No response',
  expired: 'Expired — no reply',
  expired_unsubmitted: 'Expired — never submitted',
  role_closed: 'Role closed',
};

/** The single source of chip colour for a request, keyed on who owes (§10) —
 * the same idea `TONE` itself is built on, so the tracker (Task 22) can reuse
 * it without inventing a second mapping. */
export function toneForRequest(state: RequestState, owed: 'you' | 'them' | 'nobody'): Tone {
  if (state === 'offer') return 'ok';
  if (isTerminal(state)) return 'neutral';
  return owed === 'you' ? 'owed' : 'waiting';
}

const DECLINE_REASONS: { id: DeclineReason; label: string }[] = [
  { id: 'not_a_fit', label: 'Not a fit' },
  { id: 'no_capacity', label: 'No capacity' },
  { id: 'dont_know_you', label: "Don't know you well enough" },
  { id: 'role_closed', label: 'Role closed' },
];

const DECLINE_REASON_LABEL: Record<DeclineReason, string> = Object.fromEntries(
  DECLINE_REASONS.map((r) => [r.id, r.label]),
) as Record<DeclineReason, string>;

/** The single primary action's label, per state — the tracker's CTA table
 * mirrors this exactly, on purpose. */
const PRIMARY_LABEL: Partial<Record<RequestState, string>> = {
  sent: 'Accept or decline',
  accepted: 'Mark as submitted',
  submitted: 'Any news yet?',
  recruiter_contact: 'Any news yet?',
  interviewing: 'Log the outcome',
};

/** The label for each legal target state, used inside the one action panel a
 * primary button reveals — never as a row of buttons on the page itself. */
const TARGET_LABEL: Record<RequestState, string> = {
  sent: 'Awaiting a reply',
  accepted: 'Accept',
  submitted: 'Submitted',
  recruiter_contact: 'Recruiter got in touch',
  interviewing: 'Interviewing',
  offer: 'Got an offer',
  rejected: 'Not selected',
  declined: 'Decline',
  no_response: 'No response',
  expired: 'Expired',
  expired_unsubmitted: 'Expired, unsubmitted',
  role_closed: 'Close this role',
};

const PAST_TENSE: Record<RequestState, string> = {
  sent: 'sent the request',
  accepted: 'accepted the request',
  declined: 'declined the request',
  submitted: 'marked it as submitted',
  recruiter_contact: 'logged first recruiter contact',
  interviewing: 'moved it to interviewing',
  offer: 'logged an offer',
  rejected: 'logged that it did not work out',
  no_response: 'went quiet — no response',
  expired: 'let the request expire',
  expired_unsubmitted: 'let it expire, unsubmitted',
  role_closed: 'closed the role',
};

function relativeDay(at: number, now: number): string {
  const d = daysBetween(at, now);
  if (d === 0) return 'today';
  if (d === 1) return '1 day ago';
  return `${d} days ago`;
}

/**
 * The referral request detail: one object, two authors (§5.2).
 *
 * The timeline below renders `requestEventsFor(id)` verbatim — the
 * append-only log — rather than fields reconstructed from the request. Above
 * it: the current state, who owes the next update (from `stateOwner`, never
 * re-derived), and exactly one primary action, computed from
 * `TRANSITIONS[state]` filtered by the viewer's role. Declining is the one
 * path that branches inside that action, because the store refuses a decline
 * with no reason (§5.2's graceful no).
 */
export function RequestDetail({ requestId, now, onClose }: RequestDetailProps) {
  const [panelOpen, setPanelOpen] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState<DeclineReason | null>(null);
  const [error, setError] = useState<string | null>(null);

  const request = getRequest(requestId);
  const viewer = getCurrentMember();

  if (!request) {
    return (
      <Modal open onClose={onClose} title="Request unavailable">
        <p className="text-sm text-stone-600">This request is no longer available to you.</p>
      </Modal>
    );
  }

  const events = requestEventsFor(requestId);
  const seeker = getMember(request.seekerId);
  const referrer = getMember(request.referrerId);
  const company = listCompanies().find((c) => c.id === request.companyId) ?? null;

  const role: 'seeker' | 'referrer' | null =
    viewer?.id === request.seekerId ? 'seeker' : viewer?.id === request.referrerId ? 'referrer' : null;
  const counterparty = role === 'seeker' ? referrer : role === 'referrer' ? seeker : null;

  const owner = request.stateOwner;
  const owed: 'you' | 'them' | 'nobody' = owner === null ? 'nobody' : owner === role ? 'you' : 'them';

  const legalTargets = role ? TRANSITIONS[request.state].filter((to) => actorMayTransition(role, to)) : [];
  const primaryLabel = PRIMARY_LABEL[request.state] ?? 'Update this request';

  function actorNameFor(id: string | null): string {
    if (id === null) return 'Loop';
    if (seeker && id === seeker.id) return seeker.name;
    if (referrer && id === referrer.id) return referrer.name;
    return 'Someone';
  }

  function lineFor(e: RequestEvent): string {
    if (e.note.trim()) return e.note;
    const verb = PAST_TENSE[e.toState] ?? `moved this to ${REQUEST_STATE_LABEL[e.toState]}`;
    const reasonSuffix =
      e.toState === 'declined' && request!.declineReason ? ` — ${DECLINE_REASON_LABEL[request!.declineReason]}.` : '.';
    return `${actorNameFor(e.actorId)} ${verb}${reasonSuffix}`;
  }

  function closePanel() {
    setPanelOpen(false);
    setDeclining(false);
    setDeclineReason(null);
    setError(null);
  }

  function runAdvance(to: RequestState, opts: { declineReason?: DeclineReason } = {}) {
    try {
      advanceRequest(request!.id, to, opts);
      closePanel();
    } catch (e) {
      if (e instanceof RuleViolation) {
        setError(e.message);
      } else {
        throw e;
      }
    }
  }

  function confirmDecline() {
    if (!declineReason) return;
    runAdvance('declined', { declineReason });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={request.roleTitle || 'Referral request'}
      subtitle={company?.name ?? undefined}
      width="max-w-2xl"
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Avatar name={seeker?.name ?? 'Seeker'} size={24} />
            <span className="text-sm text-stone-700">{seeker?.name ?? 'A seeker'}</span>
          </div>
          <span className="text-stone-300">→</span>
          <div className="flex items-center gap-2">
            <Avatar name={referrer?.name ?? 'Referrer'} size={24} />
            <span className="text-sm text-stone-700">{referrer?.name ?? 'A referrer'}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={toneForRequest(request.state, owed)}>{REQUEST_STATE_LABEL[request.state]}</Chip>
          {isTerminal(request.state) ? (
            <span className="text-xs text-stone-500">This request is resolved — nobody owes the next update.</span>
          ) : owed === 'you' ? (
            <span className="text-xs font-medium text-[var(--color-owed)]">You owe the next update.</span>
          ) : owed === 'them' ? (
            <span className="text-xs text-stone-500">Waiting on {counterparty?.name ?? 'the other side'}.</span>
          ) : null}
        </div>

        {request.roleUrl ? (
          <a href={request.roleUrl} target="_blank" rel="noreferrer" className="text-xs text-brand-600 underline">
            View the role
          </a>
        ) : null}

        <div className="rounded-lg bg-stone-50 px-3 py-2 ring-1 ring-stone-200">
          <p className="mb-1 text-xs font-medium text-stone-500">The original pitch</p>
          <p className="text-sm text-stone-800">{request.pitch || '(No pitch was attached.)'}</p>
        </div>

        {/* §5.2: one object, two authors. This is the append-only log itself —
            not fields reconstructed from the request. */}
        <div>
          <p className="mb-2 text-xs font-medium text-stone-500">History</p>
          <ol className="flex flex-col gap-2 border-l border-stone-200 pl-3">
            {events.map((e) => (
              <li key={e.id} className="text-sm text-stone-700">
                <p>{lineFor(e)}</p>
                <p className="text-xs text-stone-400">{relativeDay(e.at, now)}</p>
              </li>
            ))}
          </ol>
        </div>

        {error ? (
          <p className="rounded-lg bg-[var(--color-owed-soft)] px-3 py-2 text-sm font-medium text-[var(--color-owed)]">
            {error}
          </p>
        ) : null}

        {/* Exactly one primary action — nothing else. Multiple legal targets
            (e.g. accept vs. decline) are reached from inside the one panel it
            opens, not as a row of competing buttons on the page. */}
        {legalTargets.length > 0 ? (
          <div>
            {!panelOpen ? (
              <Button variant="primary" onClick={() => setPanelOpen(true)}>
                {primaryLabel}
              </Button>
            ) : (
              <div className="flex flex-col gap-3 rounded-lg bg-brand-50 p-3 ring-1 ring-brand-500/20">
                {!declining ? (
                  <>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {legalTargets.map((to) =>
                        to === 'declined' ? (
                          <Button key={to} variant="secondary" onClick={() => setDeclining(true)}>
                            {TARGET_LABEL[to]}
                          </Button>
                        ) : (
                          <Button key={to} variant="primary" onClick={() => runAdvance(to)}>
                            {TARGET_LABEL[to]}
                          </Button>
                        ),
                      )}
                    </div>
                    <Button variant="ghost" size="sm" className="self-start" onClick={closePanel}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    {/* §5.2: a graceful no. The store refuses a decline
                        without one of these, so the chip choice is not
                        optional here either. */}
                    <p className="text-sm font-medium text-stone-800">Why are you declining?</p>
                    <div className="flex flex-wrap gap-2">
                      {DECLINE_REASONS.map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setDeclineReason(r.id)}
                          className="focus-visible:outline-2 focus-visible:outline-brand-500"
                        >
                          <Chip tone={declineReason === r.id ? 'owed' : 'neutral'}>{r.label}</Chip>
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-stone-500">
                      This reason is shown to {seeker?.name ?? 'the seeker'} — an unexplained decline is what makes
                      people stop asking.
                    </p>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setDeclining(false)}>
                        Back
                      </Button>
                      <Button variant="danger" size="sm" onClick={confirmDecline} disabled={!declineReason}>
                        Confirm decline
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
