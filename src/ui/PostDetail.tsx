import { useState } from 'react';
import {
  alumniAt,
  applicationsFor,
  applyToPost,
  confirmPost,
  flagUnreachable,
  getCurrentMember,
  getMember,
  getPost,
  listCompanies,
  posterStatsFor,
  referralAvailabilityFor,
  requestContactRemoval,
  RuleViolation,
  sharersFor,
} from '../data/store.ts';
import type { ConfirmState } from '../data/schema.ts';
import { disclosureSentence, destinationLabel, relationshipBadge } from '../core/disclosure.ts';
import { freshnessFor } from '../core/freshness.ts';
import { sharerSummary } from '../core/dedupe.ts';
import { Avatar, Button, Chip, Modal } from './primitives.tsx';
import { expLabel } from './PostCard.tsx';
import type { ReferralAsk } from './RequestComposer.tsx';

export interface PostDetailProps {
  postId: string;
  now: number;
  onClose: () => void;
  /**
   * The bridge into Task 21's composer. `ReferralAsk` is the one shape every
   * "ask for a referral" entry point raises — here `jobPostId` is always a
   * real string, because this bridge only ever fires from a specific post.
   */
  onRequestReferral: (req: ReferralAsk) => void;
}

const CONFIRM_OPTIONS: { id: ConfirmState; label: string }[] = [
  { id: 'open', label: 'Still open' },
  { id: 'filled', label: 'Filled' },
  { id: 'unknown', label: "I don't know" },
];

/**
 * The post detail view: everything the card shows, plus the verbatim source
 * message, the apply flow (D13's contact-reveal boundary), the poster's
 * confirm prompt (D14), and the bridge into a referral request (§7.2).
 */
export function PostDetail({ postId, now, onClose, onRequestReferral }: PostDetailProps) {
  const [showRaw, setShowRaw] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const post = getPost(postId);
  const viewer = getCurrentMember();

  if (!post) {
    return (
      <Modal open onClose={onClose} title="Post unavailable">
        <p className="text-sm text-stone-600">This post is no longer available.</p>
      </Modal>
    );
  }

  const company = post.companyId ? (listCompanies().find((c) => c.id === post.companyId) ?? null) : null;
  const poster = getMember(post.posterId);
  const posterName = poster?.name ?? 'A member';
  const badge = relationshipBadge(post.posterRelationship);
  const sentence = disclosureSentence({
    posterName,
    companyName: company?.name ?? null,
    contactName: post.hiringContactName,
    relationship: post.posterRelationship,
    destination: post.destinationType,
  });

  const fresh = freshnessFor(post, now);
  const sharers = sharerSummary(sharersFor(post.id));
  const stats = posterStatsFor(post.id);
  const statsText = stats.outcomesUnknown
    ? `${stats.applied} applied · outcomes unknown`
    : `${stats.applied} alumni applied · ${stats.heardBack} heard back · ${stats.interviewing} interviewing`;
  const exp = expLabel(post.expMin, post.expMax);
  const locations = post.locations.join(', ');

  const isPoster = viewer !== null && viewer.id === post.posterId;
  const myApplication = viewer ? applicationsFor(post.id).find((a) => a.memberId === viewer.id) : undefined;
  // Revealed once the viewer has actually applied — this run or a past one.
  // Nothing derived here from `post` itself is gated on anything other than
  // that one fact (D13).
  const revealed = Boolean(myApplication);
  const alreadyFlagged = viewer ? post.unreachableFlags.includes(viewer.id) : false;
  const hasNamedContact = post.hiringContactValue !== null;

  function runAction(action: () => void) {
    try {
      action();
      setError(null);
    } catch (e) {
      if (e instanceof RuleViolation) {
        setError(e.message);
      } else {
        throw e;
      }
    }
  }

  // §7.2 / DL2: hidden entirely when the company is withheld — there is no
  // company to find alumni at, and guessing would defeat the poster's
  // deliberate choice. No cap of any kind on the seeker side here (DL1).
  const companyAlumni = post.companyId ? alumniAt(post.companyId) : [];
  const openAlumni = companyAlumni.filter((m) => m.openToReferring && m.id !== viewer?.id);

  return (
    <Modal open onClose={onClose} title={post.title} subtitle={company?.name ?? post.confidentialDescriptor ?? 'Company withheld'} width="max-w-2xl">
      <div className="flex flex-col gap-4">
        {!company ? (
          <p className="text-sm text-stone-600">
            {post.confidentialDescriptor ?? 'Details withheld'}
            <span className="text-stone-500"> — Company withheld by the poster</span>
          </p>
        ) : null}

        {locations || exp || post.compText ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
            {locations ? <span>{locations}</span> : null}
            {exp ? <span>{exp}</span> : null}
            {post.compText ? <span>{post.compText}</span> : null}
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <Avatar name={posterName} size={24} />
          <span className="text-sm text-stone-700">{posterName}</span>
          <Chip tone="neutral">{badge.label}</Chip>
        </div>

        <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm font-semibold leading-snug text-stone-900 ring-1 ring-stone-200">
          {sentence}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <Chip tone={fresh.state !== 'fresh' ? 'stale' : 'neutral'}>{fresh.label}</Chip>
          {post.confirmState === 'unknown' ? <Chip tone="stale">Poster couldn't confirm</Chip> : null}
        </div>

        {sharers ? <p className="text-xs text-stone-500">{sharers}</p> : null}
        <p className="text-xs text-stone-500">{statsText}</p>

        {/* §5.1: the verbatim source, collapsed by default — nothing is lost
            in translation, and a poster can always check their words were
            not mangled by the parser. */}
        <div className="rounded-lg ring-1 ring-stone-200">
          <button
            type="button"
            onClick={() => setShowRaw((v) => !v)}
            className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-medium text-stone-700 hover:bg-stone-50"
            aria-expanded={showRaw}
          >
            View original message
            <span className="text-stone-400">{showRaw ? '▲' : '▼'}</span>
          </button>
          {showRaw ? (
            <p className="whitespace-pre-wrap border-t border-stone-200 px-3 py-2 text-sm text-stone-600">
              {post.rawText}
            </p>
          ) : null}
        </div>

        {/* D14: the poster's confirm prompt. All three answers are the same
            size, the same weight, and the same row — "I don't know" is not a
            lesser option, a text link, or hidden behind "more". */}
        {isPoster && fresh.promptDue ? (
          <div className="rounded-lg bg-amber-50 p-3 ring-1 ring-amber-500/30">
            <p className="mb-2 text-sm font-medium text-stone-800">Is this role still open?</p>
            <div className="grid grid-cols-3 gap-2">
              {CONFIRM_OPTIONS.map((opt) => (
                <Button
                  key={opt.id}
                  variant="secondary"
                  className="w-full"
                  onClick={() => runAction(() => confirmPost(post.id, opt.id))}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {/* D13: the apply boundary. Nothing about the hiring contact renders
            anywhere below — not the name, not the value, not in a title or
            alt attribute, not visually hidden — until `applyToPost` has
            actually been called for this viewer. */}
        {!isPoster ? (
          <div className="flex flex-col gap-2 rounded-lg p-3 ring-1 ring-stone-200">
            {!revealed ? (
              <>
                <p className="text-sm text-stone-600">
                  {hasNamedContact
                    ? 'Applying logs your application and reveals how to reach the hiring contact.'
                    : 'Applying logs your application and reveals how to apply.'}
                </p>
                <div>
                  <Button variant="primary" onClick={() => runAction(() => applyToPost(post.id))}>
                    Apply
                  </Button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-stone-900">
                  {destinationLabel(post.destinationType, { posterName, companyName: company?.name ?? null, contactName: post.hiringContactName })}
                </p>
                {post.hiringContactName ? (
                  <p className="text-sm text-stone-700">Contact: {post.hiringContactName}</p>
                ) : null}
                {post.hiringContactValue ? (
                  <p className="text-sm text-stone-700">{post.hiringContactValue}</p>
                ) : post.applyValue ? (
                  <p className="text-sm text-stone-700">{post.applyValue}</p>
                ) : null}
                <div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={alreadyFlagged}
                    onClick={() => runAction(() => flagUnreachable(post.id))}
                  >
                    {alreadyFlagged ? "You've flagged this route" : "Couldn't reach this contact"}
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}

        {error ? (
          <p className="rounded-lg bg-[var(--color-owed-soft)] px-3 py-2 text-sm font-medium text-[var(--color-owed)]">
            {error}
          </p>
        ) : null}

        {/* §7.2 / DL2 — the bridge into a referral request. Hidden entirely
            when the company is withheld; uncapped on the seeker side (DL1). */}
        {company && companyAlumni.length > 0 ? (
          <div className="flex flex-col gap-2 rounded-lg bg-brand-50 p-3 ring-1 ring-brand-500/20">
            <p className="text-sm font-semibold text-stone-900">
              {companyAlumni.length} XLRI alumni work here — ask one to refer you
            </p>
            {openAlumni.length === 0 ? (
              <p className="text-xs text-stone-500">None of them are currently open to referring.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {openAlumni.map((m) => {
                  const availability = referralAvailabilityFor(m.id, now);
                  return (
                    <li key={m.id} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 ring-1 ring-stone-200">
                      <Avatar name={m.name} size={24} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-stone-800">{m.name}</p>
                        {m.title ? <p className="truncate text-xs text-stone-500">{m.title}</p> : null}
                      </div>
                      {availability.accepting ? (
                        <Button
                          size="sm"
                          variant="primary"
                          onClick={() =>
                            onRequestReferral({
                              referrerId: m.id,
                              companyId: post.companyId as string,
                              roleTitle: post.title,
                              jobPostId: post.id,
                              roleUrl: post.jdUrl,
                            })
                          }
                        >
                          Ask for a referral
                        </Button>
                      ) : (
                        <Chip tone="neutral">Not taking asks right now</Chip>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        {/* D13: a named contact who never asked to be on a job board can have
            their details taken down — reachable from every post carrying one,
            not just the poster's own view. */}
        {hasNamedContact ? (
          <div className="border-t border-stone-200 pt-2">
            <button
              type="button"
              className="text-xs text-stone-500 underline hover:text-stone-700"
              onClick={() => runAction(() => requestContactRemoval(post.id))}
            >
              Request this contact's details be removed
            </button>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}
