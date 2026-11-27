/**
 * My posts — Lite §6 sheet 3.
 *
 * This is §6's payoff for the poster: nine people applied and two got calls,
 * and up to now the only way to know that was to notice a WhatsApp reply.
 * `myPosts()` never filters by staleness or status — a filled or long-stale
 * post still shows here, greyed and sunk (`postAge(...).stale`), because a
 * poster who never came back should see their post fade rather than vanish.
 * Sinking needs no code of its own: `myPosts()` already orders newest first,
 * so an old post sinks because it is older, the same reasoning `core/rank.ts`
 * uses for the board.
 *
 * Expanding a row is the disclosure this whole sheet exists for — name,
 * batch, programme, LinkedIn and self-reported status, straight from
 * `applicantsFor()`'s projection and nothing beyond it (no email, no
 * `googleSub`: the store never hands those to a poster). The LinkedIn value
 * is rendered as a plain anchor the poster clicks themselves — never fetched,
 * embedded or previewed (§7.4).
 *
 * Marking a post Filled is the one write here that fans out to other people
 * (`setPostStatus` notifies every applicant), so it is the one status change
 * that does not commit on the spot: picking "Filled" opens an inline warning
 * naming how many people it will notify, and only the explicit confirm calls
 * the store. Open and Not sure commit immediately, same one-tap ladder as
 * `MyApplications.tsx`.
 */
import { Fragment, useState } from 'react';
import { RuleViolation, applicantsFor, myPosts, setPostStatus } from '../data/store.ts';
import type { Applicant } from '../data/store.ts';
import { POST_STATUSES } from '../data/schema.ts';
import type { JobPost, PostStatus } from '../data/schema.ts';
import { postAge } from '../core/freshness.ts';
import { STATUS_LABEL } from '../core/applications.ts';
import { dayLabel } from '../core/time.ts';
import { Button, Chip, EmptyState, Select, cx } from './primitives.tsx';

export interface MyPostsProps {
  now: number;
  /**
   * Only wired so the empty state's "post a role" action can move the member
   * onto the board, where the composer lives — this component has no route
   * of its own to push. Same optional-callback shape `MyApplications.tsx`
   * uses for its "browse the board" action, reused rather than invented:
   * silently inert without it, so `MyPosts({ now })` still works anywhere a
   * caller has no navigation to offer.
   */
  onPostRole?: () => void;
}

const POST_STATUS_LABEL: Record<PostStatus, string> = {
  open: 'Open',
  filled: 'Filled',
  unsure: 'Not sure',
};

/**
 * The company column, poster's-own-post version of `Board.tsx`'s
 * `companyCell` — same three shapes, worded for the person who chose to
 * withhold it rather than for a reader encountering it cold.
 */
function companyCell(post: JobPost): { text: string; withheld: boolean } {
  if (post.companyName) return { text: post.companyName, withheld: false };
  if (post.confidentialDescriptor) {
    return { text: `${post.confidentialDescriptor} — kept confidential`, withheld: true };
  }
  return { text: 'Company not named', withheld: true };
}

function ApplicantRow({ applicant, now }: { applicant: Applicant; now: number }) {
  return (
    <tr className="border-b border-stone-100 align-top last:border-b-0">
      <td data-label="Name" className="px-3 py-2 font-medium text-stone-800">
        {applicant.name}
      </td>
      <td data-label="Batch" className="px-3 py-2 tabular-nums text-stone-600">
        {applicant.batch}
      </td>
      <td data-label="Programme" className="px-3 py-2 text-stone-600">
        {applicant.programme}
      </td>
      <td data-label="Applied" className="px-3 py-2 tabular-nums text-stone-600">
        {dayLabel(applicant.appliedAt, now)}
      </td>
      <td data-label="LinkedIn" className="px-3 py-2">
        {/*
         * Text with a plain anchor the poster clicks themselves — nothing in
         * this app fetches, embeds or previews it (§7.4). No favicon, no
         * metadata lookup, just the URL as a link.
         */}
        <a
          href={applicant.linkedinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium break-all text-brand-700 underline"
        >
          {applicant.linkedinUrl}
        </a>
      </td>
      <td data-label="Status" className="px-3 py-2">
        <Chip tone="neutral">{STATUS_LABEL[applicant.status]}</Chip>
      </td>
    </tr>
  );
}

function PostRow({ post, now }: { post: JobPost; now: number }) {
  const [expanded, setExpanded] = useState(false);
  const [pendingFilled, setPendingFilled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const age = postAge(post, now);
  const applicants = applicantsFor(post.id);
  const company = companyCell(post);
  const dim = age.stale ? 'text-stone-400' : 'text-stone-700';
  const panelId = `my-posts-applicants-${post.id}`;

  function commit(status: PostStatus): void {
    try {
      setPostStatus(post.id, status, now);
      setPendingFilled(false);
      setError(null);
    } catch (err) {
      setError(err instanceof RuleViolation ? err.message : 'Something went wrong. Try again.');
    }
  }

  function handleStatusChange(status: PostStatus): void {
    // The one status that fans out to other people gets a confirm step
    // instead of an immediate commit — the warning has to land before the
    // store notifies anyone, not after.
    if (status === 'filled' && post.postStatus !== 'filled') {
      setPendingFilled(true);
      setError(null);
      return;
    }
    commit(status);
  }

  function cancelFilled(): void {
    setPendingFilled(false);
    setError(null);
  }

  const displayedStatus: PostStatus = pendingFilled ? 'filled' : post.postStatus;

  return (
    <Fragment>
      <tr className={cx('border-b border-stone-100 align-top', age.stale && 'bg-stone-50')}>
        <td data-label="Role" className="px-3 py-3">
          <p className={cx('font-semibold', age.stale ? 'text-stone-400' : 'text-stone-900')}>{post.title}</p>
        </td>
        <td data-label="Company" className={cx('px-3 py-3', dim)}>
          <span className={company.withheld ? 'italic' : undefined}>{company.text}</span>
        </td>
        <td data-label="Posted" className="px-3 py-3 tabular-nums">
          {age.stale ? <Chip tone="stale">{age.label}</Chip> : <span className={dim}>{age.label}</span>}
        </td>
        <td data-label="Applicants" className="px-3 py-3">
          <button
            type="button"
            aria-expanded={expanded}
            // Only while the panel exists: the row is mounted on expand rather than
            // hidden, so a permanent `aria-controls` would point at nothing.
            aria-controls={expanded ? panelId : undefined}
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-medium text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
          >
            <span className="tabular-nums">{applicants.length}</span>
            <span>{applicants.length === 1 ? 'applicant' : 'applicants'}</span>
            <span aria-hidden="true">{expanded ? '▲' : '▼'}</span>
          </button>
        </td>
        <td data-label="Status" className="px-3 py-3">
          <label className="flex flex-col gap-1">
            <span className="sr-only">Status for {post.title}</span>
            <Select
              value={displayedStatus}
              onChange={(e) => handleStatusChange(e.currentTarget.value as PostStatus)}
              className="w-40"
            >
              {POST_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {POST_STATUS_LABEL[s]}
                </option>
              ))}
            </Select>
            {error ? <span className="text-xs font-medium text-[var(--color-owed)]">{error}</span> : null}
          </label>
        </td>
      </tr>

      {pendingFilled ? (
        <tr className="border-b border-stone-100 bg-amber-50">
          <td colSpan={5} className="plain px-3 py-4">
            <div className="max-w-xl">
              <p className="text-sm font-semibold text-stone-900">Before you mark this Filled</p>
              <p className="mt-1 text-sm text-stone-700">
                {applicants.length === 0
                  ? 'No one has applied to this role yet, so marking it Filled will not notify anyone.'
                  : `This tells ${applicants.length === 1 ? 'the person who applied' : `all ${applicants.length} people who applied`} that the role is no longer open.`}
              </p>
              {error ? <p className="mt-2 text-sm font-medium text-[var(--color-owed)]">{error}</p> : null}
              <div className="mt-3 flex gap-2">
                <Button type="button" size="sm" variant="primary" onClick={() => commit('filled')}>
                  Mark Filled
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={cancelFilled}>
                  Cancel
                </Button>
              </div>
            </div>
          </td>
        </tr>
      ) : null}

      {/*
       * Mounted on expand, not hidden by attribute. Two reasons, and the second
       * is the one that matters:
       *
       * 1. `hidden` does not survive this table's own mobile CSS. At <=767px
       *    `.stack-table tr { display: block }` is an AUTHOR rule and the
       *    `[hidden] { display: none }` it has to beat is a USER-AGENT rule, so
       *    the author rule wins on origin no matter its specificity — the panel
       *    stayed visible on every phone and the toggle did nothing.
       * 2. This is the one screen where a member reads another member's
       *    details. Applicant names, batches, programmes and LinkedIn URLs
       *    should not sit in the markup of a panel nobody opened. The branch
       *    already holds this standard for the apply route on the board: absent
       *    from the DOM, not merely hidden — because a hidden thing is still a
       *    present thing.
       */}
      {expanded ? (
      <tr id={panelId} className="border-b border-stone-100 bg-stone-50">
        <td colSpan={5} className="plain px-3 py-4">
          {applicants.length === 0 ? (
            <p className="text-sm text-stone-500">No one has applied yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg bg-white ring-1 ring-stone-200">
              <table className="stack-table w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 text-xs font-semibold text-stone-500">
                    <th scope="col" className="px-3 py-2">
                      Name
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Batch
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Programme
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Applied
                    </th>
                    <th scope="col" className="px-3 py-2">
                      LinkedIn
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {applicants.map((a) => (
                    <ApplicantRow key={a.memberId} applicant={a} now={now} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </td>
      </tr>
      ) : null}
    </Fragment>
  );
}

/**
 * The sheet: every role the signed-in member has posted, newest first
 * (ordering is `myPosts()`'s, not this component's). No detail screen — the
 * row itself expands, the same interaction `Board.tsx` uses for apply and
 * report.
 */
export function MyPosts({ now, onPostRole }: MyPostsProps) {
  const posts = myPosts();

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-stone-900">My posts</h1>
      </div>

      {posts.length === 0 ? (
        <EmptyState
          title="You haven't posted a role yet."
          action={
            onPostRole ? (
              <button
                type="button"
                onClick={onPostRole}
                className="text-sm font-medium text-brand-700 underline hover:text-brand-800"
              >
                Post a role
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-stone-900/5">
          <table className="stack-table w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs font-semibold text-stone-500">
                <th scope="col" className="px-3 py-2">
                  Role
                </th>
                <th scope="col" className="px-3 py-2">
                  Company
                </th>
                <th scope="col" className="px-3 py-2">
                  Posted
                </th>
                <th scope="col" className="px-3 py-2">
                  Applicants
                </th>
                <th scope="col" className="px-3 py-2">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {posts.map((post) => (
                <PostRow key={post.id} post={post} now={now} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
