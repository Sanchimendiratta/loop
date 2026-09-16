import type { ReactNode } from 'react';
import { Fragment, useMemo, useState } from 'react';
import {
  RuleViolation,
  applicationFor,
  applyDisclosureFields,
  applyToPost,
  getCurrentMember,
  listPosts,
  posterName,
  reportPost,
} from '../data/store.ts';
import { FUNCTIONS } from '../data/schema.ts';
import type { Application, Connection, FunctionArea, JobPost } from '../data/schema.ts';
import { connectionBadge, connectionLine } from '../core/disclosure.ts';
import { postAge } from '../core/freshness.ts';
import { STATUS_LABEL } from '../core/applications.ts';
import { Button, Chip, EmptyState, cx } from './primitives.tsx';
import { PostComposer } from './PostComposer.tsx';

export interface BoardProps {
  now: number;
}

const ALL = 'all';

type FunctionFilter = FunctionArea | typeof ALL;
type ConnectionFilter = Connection | typeof ALL;
type SortMode = 'connection' | 'recent';

const CONNECTION_FILTERS: Connection[] = ['hiring', 'works_here', 'knows_contact', 'forwarded'];

interface ExpBand {
  id: string;
  label: string;
  min: number;
  max: number;
}

/** Coarse bands over `expMin`/`expMax`, since Lite has no experience enum to filter on. */
const EXP_BANDS: ExpBand[] = [
  { id: '0-3', label: '0–3 yrs', min: 0, max: 3 },
  { id: '3-6', label: '3–6 yrs', min: 3, max: 6 },
  { id: '6-10', label: '6–10 yrs', min: 6, max: 10 },
  { id: '10+', label: '10+ yrs', min: 10, max: Infinity },
];

const SORT_OPTIONS: { id: SortMode; label: string }[] = [
  { id: 'connection', label: 'Connection first (default)' },
  { id: 'recent', label: 'Most recent' },
];

/** "a, b, and c" — the exact join `applyDisclosureFields()`'s consent line needs. */
function formatFieldList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * The company column, per §10: the name, or the descriptor plus explicit
 * wording that the poster withheld it. Never a blank or a bare dash.
 */
function companyCell(post: JobPost): { text: string; withheld: boolean } {
  if (post.companyName) return { text: post.companyName, withheld: false };
  if (post.confidentialDescriptor) {
    return { text: `${post.confidentialDescriptor} — the poster withheld the company name.`, withheld: true };
  }
  return { text: 'Company not named', withheld: true };
}

function locationCell(post: JobPost): string {
  const parts = [post.location.trim(), post.isRemote ? 'Remote' : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Not specified';
}

/**
 * The route, only ever computed for display AFTER an application already
 * exists — never rendered ahead of that confirm. See `RouteDisplay` below.
 */
function routeFor(post: JobPost): { label: string; href: string | null } {
  switch (post.applyMethod) {
    case 'link':
      return { label: post.applyValue, href: post.applyValue };
    case 'email':
      return { label: post.applyValue, href: `mailto:${post.applyValue}` };
    case 'phone':
      return { label: post.applyValue, href: `tel:${post.applyValue.replace(/\s+/g, '')}` };
    case 'through_me':
      return { label: post.applyValue, href: null };
  }
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'rounded-full px-3 py-1 text-xs font-medium ring-1 transition-colors',
        active ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-stone-600 ring-stone-300 hover:bg-stone-50',
      )}
    >
      {children}
    </button>
  );
}

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="text-xs font-semibold tracking-wide text-stone-500 uppercase">{label}</legend>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </fieldset>
  );
}

/** Already applied: the route and the current status, never the Apply button. */
function RouteDisplay({ post, application }: { post: JobPost; application: Application }) {
  const route = routeFor(post);
  return (
    <div className="flex flex-col items-start gap-1">
      {route.href ? (
        <a
          href={route.href}
          target={post.applyMethod === 'link' ? '_blank' : undefined}
          rel="noopener noreferrer"
          className="font-medium text-brand-700 underline"
        >
          {route.label}
        </a>
      ) : (
        <span className="font-medium text-stone-800">{route.label}</span>
      )}
      <Chip tone="neutral">{STATUS_LABEL[application.status]}</Chip>
    </div>
  );
}

/**
 * The job board, rebuilt as Lite §6's sheet: a plain, sortable, filterable
 * table — no cards, no infinite scroll. Ordering is `listPosts`'s, not this
 * component's, and nothing is ever filtered off the board by this screen: a
 * stale post greys and sinks, it never disappears.
 *
 * The one screen-specific rule this file owns is the apply route's absence
 * from the DOM until `applyToPost` actually runs — see the `applyingId`
 * branch below, which renders no route, link, email or phone at all until
 * that confirm.
 */
export function Board({ now }: BoardProps) {
  const [sort, setSort] = useState<SortMode>('connection');
  const [fn, setFn] = useState<FunctionFilter>(ALL);
  const [location, setLocation] = useState<string>(ALL);
  const [connection, setConnection] = useState<ConnectionFilter>(ALL);
  const [expBand, setExpBand] = useState<string>(ALL);

  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);

  const [reportingId, setReportingId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportedIds, setReportedIds] = useState<ReadonlySet<string>>(new Set());

  const [composerOpen, setComposerOpen] = useState(false);

  const viewer = getCurrentMember();
  const posts = listPosts(now, sort);
  const disclosureFields = applyDisclosureFields();

  const locations = useMemo(
    () => Array.from(new Set(posts.map((p) => p.location.trim()).filter(Boolean))).sort(),
    [posts],
  );

  const filtered = posts.filter((p) => {
    if (fn !== ALL && p.function !== fn) return false;
    if (location !== ALL && p.location.trim() !== location) return false;
    if (connection !== ALL && p.connection !== connection) return false;
    if (expBand !== ALL) {
      const band = EXP_BANDS.find((b) => b.id === expBand);
      if (band && !(p.expMax >= band.min && p.expMin <= band.max)) return false;
    }
    return true;
  });

  function beginApply(postId: string): void {
    setApplyingId(postId);
    setApplyError(null);
  }
  function cancelApply(): void {
    setApplyingId(null);
    setApplyError(null);
  }
  function confirmApply(postId: string): void {
    try {
      applyToPost(postId, now);
      setApplyingId(null);
      setApplyError(null);
    } catch (err) {
      setApplyError(err instanceof RuleViolation ? err.message : 'Something went wrong. Try again.');
    }
  }

  function beginReport(postId: string): void {
    setReportingId(postId);
    setReportReason('');
    setReportError(null);
  }
  function cancelReport(): void {
    setReportingId(null);
    setReportReason('');
    setReportError(null);
  }
  function submitReport(postId: string): void {
    try {
      reportPost(postId, reportReason, now);
      setReportedIds((prev) => new Set(prev).add(postId));
      setReportingId(null);
      setReportReason('');
      setReportError(null);
    } catch (err) {
      setReportError(err instanceof RuleViolation ? err.message : 'Something went wrong. Try again.');
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      {/*
       * Outside the filter card and outside the table below — never inside
       * the Posted <th> where the sort control lives (Board.tsx, Posted
       * column header) and never inside the `filtered.length === 0` branch,
       * which replaces the whole table with `EmptyState` below. A member who
       * has over-filtered the board down to nothing must still be able to
       * post a job; this row is reachable regardless of what the filters do.
       */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-stone-900">Job board</h1>
        <Button type="button" variant="primary" onClick={() => setComposerOpen(true)}>
          Post a job
        </Button>
      </div>

      <div className="flex flex-wrap gap-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-stone-900/5">
        <FilterGroup label="Function">
          <FilterChip active={fn === ALL} onClick={() => setFn(ALL)}>
            All functions
          </FilterChip>
          {FUNCTIONS.map((f) => (
            <FilterChip key={f} active={fn === f} onClick={() => setFn(f)}>
              {f}
            </FilterChip>
          ))}
        </FilterGroup>

        <FilterGroup label="Location">
          <FilterChip active={location === ALL} onClick={() => setLocation(ALL)}>
            All locations
          </FilterChip>
          {locations.map((l) => (
            <FilterChip key={l} active={location === l} onClick={() => setLocation(l)}>
              {l}
            </FilterChip>
          ))}
        </FilterGroup>

        <FilterGroup label="Experience">
          <FilterChip active={expBand === ALL} onClick={() => setExpBand(ALL)}>
            Any experience
          </FilterChip>
          {EXP_BANDS.map((b) => (
            <FilterChip key={b.id} active={expBand === b.id} onClick={() => setExpBand(b.id)}>
              {b.label}
            </FilterChip>
          ))}
        </FilterGroup>

        {/*
         * Sort lives here, not in the Posted <th> where it started.
         * `.stack-table thead` is clipped to rect(0,0,0,0) below 768px — correct
         * for a stacked table, since the column names come from `data-label` —
         * but the sort control was inside that <th>, so on a phone it rendered
         * off-screen at x=759, `elementFromPoint` returned null, and a tap
         * simply never landed. Sorting was unreachable on exactly the devices
         * an India-first product is used on.
         *
         * Same trap as the "Post a job" button: a control parked inside a <th>
         * inherits whatever the table does to its header. `aria-sort` stays on
         * the <th>, which is where it belongs — it describes the column, while
         * this chooses the ordering.
         */}
        <FilterGroup label="Sort">
          {SORT_OPTIONS.map((o) => (
            <FilterChip key={o.id} active={sort === o.id} onClick={() => setSort(o.id)}>
              {o.label}
            </FilterChip>
          ))}
        </FilterGroup>

        <FilterGroup label="Connection">
          <FilterChip active={connection === ALL} onClick={() => setConnection(ALL)}>
            Any connection
          </FilterChip>
          {CONNECTION_FILTERS.map((c) => (
            <FilterChip key={c} active={connection === c} onClick={() => setConnection(c)}>
              {connectionBadge(c)}
            </FilterChip>
          ))}
        </FilterGroup>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No roles match those filters." />
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
                  Function
                </th>
                <th scope="col" className="px-3 py-2">
                  Location
                </th>
                <th scope="col" className="px-3 py-2">
                  Exp
                </th>
                <th scope="col" className="px-3 py-2">
                  Comp
                </th>
                <th scope="col" className="px-3 py-2">
                  Posted by
                </th>
                {/*
                 * `aria-sort` names the column the table is actually ordered
                 * by. In `recent` mode that is this one, newest first. In
                 * `connection` mode (the default) the board is ordered by
                 * connection rung instead — a column this table has no `<th>`
                 * for — so Posted gets `none`, not a value implying it is
                 * still the sort key under a different algorithm.
                 */}
                <th scope="col" aria-sort={sort === 'recent' ? 'descending' : 'none'} className="px-3 py-2 align-bottom">
                  Posted
                </th>
                <th scope="col" className="px-3 py-2">
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((post) => {
                const age = postAge(post, now);
                const who = posterName(post.posterId);
                const company = companyCell(post);
                const application = applicationFor(post.id);
                const isOwnPost = viewer?.id === post.posterId;
                const isApplying = applyingId === post.id;
                const isReporting = reportingId === post.id;
                const hasReported = reportedIds.has(post.id);
                const dim = age.stale ? 'text-stone-400' : 'text-stone-700';

                return (
                  <Fragment key={post.id}>
                    <tr className={cx('border-b border-stone-100 align-top', age.stale && 'bg-stone-50')}>
                      <td data-label="Role" className="px-3 py-3">
                        <p className={cx('font-semibold', age.stale ? 'text-stone-400' : 'text-stone-900')}>
                          {post.title}
                        </p>
                        {/* The honesty field: never muted, shrunk, truncated, clamped or gated
                            behind a toggle, even on a stale row that greys everywhere else. */}
                        <p className="mt-1 text-sm font-medium text-stone-800">
                          {connectionLine(post.connection, who, post.contactName)}
                        </p>
                        {post.note ? <p className="mt-1 text-sm text-stone-600">{post.note}</p> : null}
                        {post.jdUrl ? (
                          // Plain anchor the reader clicks themselves — nothing here fetches,
                          // embeds or previews the URL (§7.4), the same standard the LinkedIn
                          // link gets in MyPosts.tsx. Labelled rather than showing the raw URL
                          // so it reads as a link to a job description, not just any link.
                          <a
                            href={post.jdUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1 inline-block text-sm font-medium text-brand-700 underline"
                          >
                            Job description
                          </a>
                        ) : null}
                      </td>
                      <td data-label="Company" className={cx('px-3 py-3', dim)}>
                        <span className={company.withheld ? 'italic' : undefined}>{company.text}</span>
                      </td>
                      <td data-label="Function" className={cx('px-3 py-3', dim)}>
                        {post.function}
                      </td>
                      <td data-label="Location" className={cx('px-3 py-3', dim)}>
                        {locationCell(post)}
                      </td>
                      <td data-label="Exp" className={cx('px-3 py-3 tabular-nums', dim)}>
                        {post.expMin}–{post.expMax} yrs
                      </td>
                      <td data-label="Comp" className={cx('px-3 py-3', dim)}>
                        {post.compText ?? 'Not shared'}
                      </td>
                      <td data-label="Posted by" className={cx('px-3 py-3', dim)}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span>{who}</span>
                          <Chip tone="neutral">{connectionBadge(post.connection)}</Chip>
                        </div>
                      </td>
                      <td data-label="Posted" className="px-3 py-3 tabular-nums">
                        {age.stale ? <Chip tone="stale">{age.label}</Chip> : <span className={dim}>{age.label}</span>}
                      </td>
                      <td data-label="Action" className="px-3 py-3 align-top">
                        <div className="flex flex-col items-start gap-2">
                          {isOwnPost ? (
                            <span className="text-xs text-stone-400">Your post</span>
                          ) : application ? (
                            <RouteDisplay post={post} application={application} />
                          ) : isApplying ? (
                            <Button type="button" size="sm" variant="secondary" onClick={cancelApply}>
                              Cancel
                            </Button>
                          ) : (
                            <Button type="button" size="sm" variant="primary" onClick={() => beginApply(post.id)}>
                              Apply
                            </Button>
                          )}

                          {isOwnPost ? (
                            <span className="text-xs text-stone-300">Report disabled — your own post</span>
                          ) : hasReported ? (
                            <span className="text-xs text-stone-500">Reported</span>
                          ) : !isReporting ? (
                            <button
                              type="button"
                              className="text-xs font-medium text-stone-500 underline hover:text-stone-700"
                              onClick={() => beginReport(post.id)}
                            >
                              Report
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>

                    {isApplying && !isOwnPost ? (
                      <tr className="border-b border-stone-100 bg-brand-50">
                        <td colSpan={9} className="plain px-3 py-4">
                          <div className="max-w-xl">
                            <p className="text-sm font-semibold text-stone-900">Before you apply</p>
                            <p className="mt-1 text-sm text-stone-700">
                              Applying shares this with the poster: {formatFieldList(disclosureFields)}. Loop does not
                              send your application anywhere — you contact them yourself.
                            </p>
                            {applyError ? (
                              <p className="mt-2 text-sm font-medium text-[var(--color-owed)]">{applyError}</p>
                            ) : null}
                            <div className="mt-3 flex gap-2">
                              <Button type="button" size="sm" variant="primary" onClick={() => confirmApply(post.id)}>
                                Confirm application
                              </Button>
                              <Button type="button" size="sm" variant="ghost" onClick={cancelApply}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}

                    {isReporting ? (
                      <tr className="border-b border-stone-100 bg-stone-50">
                        <td colSpan={9} className="plain px-3 py-4">
                          <div className="max-w-xl">
                            <label className="block text-sm font-medium text-stone-700">
                              Why are you reporting this post?
                              <textarea
                                value={reportReason}
                                onChange={(e) => setReportReason(e.currentTarget.value)}
                                rows={2}
                                className="mt-1 w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-stone-900 ring-1 ring-stone-300 focus:ring-2 focus:ring-brand-500 focus:outline-none"
                              />
                            </label>
                            {reportError ? (
                              <p className="mt-2 text-sm font-medium text-[var(--color-owed)]">{reportError}</p>
                            ) : null}
                            <div className="mt-2 flex gap-2">
                              <Button type="button" size="sm" variant="danger" onClick={() => submitReport(post.id)}>
                                Submit report
                              </Button>
                              <Button type="button" size="sm" variant="ghost" onClick={cancelReport}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <PostComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onPublished={() => setComposerOpen(false)}
      />
    </div>
  );
}
