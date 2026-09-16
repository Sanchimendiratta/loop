/**
 * My applications — Lite §6 sheet 2.
 *
 * The whole point of this screen is the one-tap status ladder: no save
 * button, no modal, no reload (§6). A `<select>` commits on change, straight
 * through `setApplicationStatus`, and the row it belongs to updates the
 * instant the store commits — this component never holds its own copy of the
 * list, it just re-reads `myApplications(now)` on every render, the same way
 * `Board.tsx` re-reads `listPosts`.
 *
 * Staleness is the sheet's only nudge, and it is a look, not a message: a row
 * untouched for 14 days gets a soft amber dot next to when it last changed,
 * and the header names how many. Nothing blocks, nothing emails, nothing
 * penalises (`core/applications.ts`).
 *
 * The standing privacy line is built from `applyDisclosureFields()` rather
 * than typed out here, for the same reason `Board.tsx`'s consent line is: a
 * hand-written list would silently drift the moment the store's `Applicant`
 * projection changes shape, and the drift would look identical to the truth.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  RuleViolation,
  applyDisclosureFields,
  getPost,
  myApplications,
  posterName,
  setApplicationStatus,
} from '../data/store.ts';
import { APPLICATION_STATUSES } from '../data/schema.ts';
import type { Application, ApplicationStatus, ApplyMethod, JobPost } from '../data/schema.ts';
import { isStale, staleCount, staleNotice, STATUS_LABEL } from '../core/applications.ts';
import { daysBetween } from '../core/time.ts';
import { EmptyState, Select, TONE, cx } from './primitives.tsx';

export interface MyApplicationsProps {
  now: number;
  /**
   * Only wired so the empty state's "browse the board" action can actually
   * move the member off this sheet — Lite's nav lives in `App.tsx`, and this
   * component has no route of its own to push. Optional, and silently
   * inert without it, so the documented `MyApplications({ now })` call
   * still works anywhere a caller has no navigation to offer.
   */
  onBrowseBoard?: () => void;
}

/** "a, b, and c" — same join `Board.tsx`'s consent line uses for the same list. */
function formatFieldList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/** Relative day count, never a bare timestamp — matches `postAge`'s label on the board. */
function dayLabel(at: number, now: number): string {
  const d = daysBetween(at, now);
  return d === 0 ? 'today' : `${d}d ago`;
}

const APPLY_METHOD_LABEL: Record<Exclude<ApplyMethod, 'through_me'>, string> = {
  link: 'Application link',
  email: 'Email',
  phone: 'Phone',
};

/** How they applied: the route type, or the poster's name when it went through them. */
function viaFor(post: JobPost): string {
  if (post.applyMethod === 'through_me') return posterName(post.posterId);
  return APPLY_METHOD_LABEL[post.applyMethod];
}

/** A soft amber dot, with the text a screen reader needs since the dot itself is decorative. */
function StaleDot() {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={cx('inline-block h-2 w-2 rounded-full', TONE.stale.dot)} />
      <span className="sr-only">Hasn't been updated in a while.</span>
    </span>
  );
}

function Cell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <td data-label={label} className={cx('px-3 py-3', className)}>
      {children}
    </td>
  );
}

function ApplicationRow({ application, now }: { application: Application; now: number }) {
  const [error, setError] = useState<string | null>(null);
  const post = getPost(application.jobPostId);
  const stale = isStale(application, now);

  function handleStatusChange(status: ApplicationStatus): void {
    try {
      setApplicationStatus(application.id, status, now);
      setError(null);
    } catch (err) {
      setError(err instanceof RuleViolation ? err.message : 'Something went wrong. Try again.');
    }
  }

  const roleTitle = post?.title ?? 'Role no longer listed';
  const companyText = post?.companyName ?? (post ? 'Company not named' : '—');

  return (
    <tr className="border-b border-stone-100 align-top">
      <Cell label="Company" className="font-medium text-stone-800">
        {companyText}
      </Cell>
      <Cell label="Role" className="font-semibold text-stone-900">
        {roleTitle}
      </Cell>
      <Cell label="Applied" className="tabular-nums text-stone-600">
        {dayLabel(application.appliedAt, now)}
      </Cell>
      <Cell label="Via" className="text-stone-600">
        {post ? viaFor(post) : '—'}
      </Cell>
      <Cell label="Status">
        <label className="flex flex-col gap-1">
          <span className="sr-only">Status for {roleTitle}</span>
          <Select
            value={application.status}
            onChange={(e) => handleStatusChange(e.currentTarget.value as ApplicationStatus)}
            className="w-48"
          >
            {APPLICATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          {error ? <span className="text-xs font-medium text-[var(--color-owed)]">{error}</span> : null}
        </label>
      </Cell>
      <Cell label="Last updated" className="tabular-nums text-stone-600">
        <span className="flex items-center gap-1.5">
          {dayLabel(application.statusUpdatedAt, now)}
          {stale ? <StaleDot /> : null}
        </span>
      </Cell>
    </tr>
  );
}

/**
 * The sheet: every application the signed-in member has made, newest first
 * (ordering is `myApplications`'s, not this component's). No detail screen,
 * no confirm step on a status change — the whole interaction is the select
 * itself.
 */
export function MyApplications({ now, onBrowseBoard }: MyApplicationsProps) {
  const applications = myApplications(now);
  const disclosureFields = applyDisclosureFields();
  const notice = staleNotice(staleCount(applications, now));

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-stone-900">My applications</h1>
        {notice ? <p className="text-sm font-medium text-amber-700">{notice}</p> : null}
      </div>

      {disclosureFields.length > 0 ? (
        <p className="rounded-xl bg-stone-50 px-4 py-3 text-sm text-stone-600 ring-1 ring-stone-200">
          The poster of each role you apply to can see {formatFieldList(disclosureFields)}. Nothing else about you is
          shared, and Loop never contacts anyone on your behalf.
        </p>
      ) : null}

      {applications.length === 0 ? (
        <EmptyState
          title="You haven't applied to anything yet."
          action={
            onBrowseBoard ? (
              <button
                type="button"
                onClick={onBrowseBoard}
                className="text-sm font-medium text-brand-700 underline hover:text-brand-800"
              >
                Browse the board
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
                  Company
                </th>
                <th scope="col" className="px-3 py-2">
                  Role
                </th>
                <th scope="col" className="px-3 py-2">
                  Applied
                </th>
                <th scope="col" className="px-3 py-2">
                  Via
                </th>
                <th scope="col" className="px-3 py-2">
                  Status
                </th>
                <th scope="col" className="px-3 py-2">
                  Last updated
                </th>
              </tr>
            </thead>
            <tbody>
              {applications.map((application) => (
                <ApplicationRow key={application.id} application={application} now={now} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
