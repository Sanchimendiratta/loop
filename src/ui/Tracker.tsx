import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  getCurrentMember,
  listCompanies,
  listPosts,
  posterStatsFor,
  recordOutcome,
  RuleViolation,
  trackerFor,
} from '../data/store.ts';
import type { TrackerRow } from '../data/store.ts';
import type { ApplicationOutcome } from '../data/schema.ts';
import { freshnessFor } from '../core/freshness.ts';
import { Button, Card, Chip, EmptyState, TONE } from './primitives.tsx';
import type { Tone } from './primitives.tsx';

export interface TrackerProps {
  now: number;
  onOpenRequest: (requestId: string) => void;
  onOpenPost: (postId: string) => void;
}

/** A small, neutral label naming what a row IS — never a second colour axis.
 * Spec §10: an overdue referral request, an unanswered apply prompt and an
 * unconfirmed post must read identically at the same urgency, so this is text
 * only, rendered with the same neutral chip every time. */
const KIND_LABEL: Record<TrackerRow['kind'], string> = {
  request: 'Referral request',
  application: 'Application',
  post: 'Your post',
};

const OUTCOME_OPTIONS: { id: ApplicationOutcome; label: string }[] = [
  { id: 'responded', label: 'They responded' },
  { id: 'interviewing', label: 'Interviewing' },
  { id: 'offer', label: 'Got an offer' },
  { id: 'rejected', label: 'Not selected' },
  { id: 'no_response', label: 'Nothing yet' },
];

function overdueLabel(days: number): string | null {
  if (days <= 0) return null;
  return days === 1 ? '1 day overdue' : `${days} days overdue`;
}

/**
 * One row's visual shell, shared by all three kinds (§10 / DL2). Tone comes
 * only from `TONE.owed` / `TONE.waiting`, keyed on `owed` — never on `kind` —
 * so a row cannot be told apart by colour, weight or icon, only by the
 * neutral `KIND_LABEL` text and its own title/subtitle.
 */
function RowShell({
  row,
  tone,
  action,
}: {
  row: TrackerRow;
  tone: Tone;
  action: ReactNode;
}) {
  const overdue = overdueLabel(row.overdueDays);
  return (
    <div className={`flex flex-wrap items-center gap-3 border-l-4 px-4 py-3 ${TONE[tone].edge}`}>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Chip tone="neutral">{KIND_LABEL[row.kind]}</Chip>
          {overdue ? <Chip tone={tone}>{overdue}</Chip> : null}
        </div>
        <p className="mt-1 truncate text-sm font-semibold text-stone-900">{row.title}</p>
        <p className="truncate text-xs text-stone-500">{row.subtitle}</p>
      </div>
      {action}
    </div>
  );
}

/**
 * The tracker (Task 22, DL2's replacement surface).
 *
 * Three sections, all read from `trackerFor` except "Your posts", which folds
 * in §5.1's poster dashboard (`posterStatsFor`) alongside the same confirm
 * prompt "Needs you" already carries for a post — one obligation, shown once
 * as something to act on and once as context on the post it belongs to.
 *
 * CTAs are deliberately thin here: a request's or a post's CTA opens the
 * modal that already owns its one primary action (`RequestDetail`,
 * `PostDetail` — Task 21's work), rather than re-deriving that logic. Only the
 * application outcome prompt has no existing home, so it is answered inline.
 */
export function Tracker({ now, onOpenRequest, onOpenPost }: TrackerProps) {
  const viewer = getCurrentMember();
  const [openOutcomeFor, setOpenOutcomeFor] = useState<string | null>(null);
  const [outcomeError, setOutcomeError] = useState<string | null>(null);

  if (!viewer) return <EmptyState title="Sign in to see your tracker." />;

  const rows = trackerFor(viewer.id, now);
  const needsYou = rows.filter((r) => r.owed === 'you');
  const waitingOnOthers = rows.filter((r) => r.owed === 'them');

  const companies = listCompanies();
  const myPosts = listPosts(now).filter((p) => p.posterId === viewer.id);
  const confirmDuePostIds = new Set(needsYou.filter((r) => r.kind === 'post').map((r) => r.id));

  function handleOutcome(applicationId: string, outcome: ApplicationOutcome) {
    try {
      recordOutcome(applicationId, outcome);
      setOpenOutcomeFor(null);
      setOutcomeError(null);
    } catch (e) {
      if (e instanceof RuleViolation) {
        setOutcomeError(e.message);
      } else {
        throw e;
      }
    }
  }

  function actionFor(row: TrackerRow): ReactNode {
    if (row.cta === null) return null;
    if (row.kind === 'request') {
      return (
        <Button variant="primary" size="sm" onClick={() => onOpenRequest(row.id)}>
          {row.cta.label}
        </Button>
      );
    }
    if (row.kind === 'post') {
      return (
        <Button variant="primary" size="sm" onClick={() => onOpenPost(row.id)}>
          {row.cta.label}
        </Button>
      );
    }
    // 'application' — no existing detail surface owns this prompt, so the
    // one CTA reveals its answer options inline rather than opening a modal.
    return (
      <Button variant="primary" size="sm" onClick={() => setOpenOutcomeFor(row.id)}>
        {row.cta.label}
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-stone-900">Needs you</h2>
        {needsYou.length === 0 ? (
          <EmptyState title="Nothing is waiting on you." />
        ) : (
          <Card>
            <ul className="divide-y divide-stone-200">
              {needsYou.map((row) => (
                <li key={row.id}>
                  <RowShell row={row} tone="owed" action={actionFor(row)} />
                  {row.kind === 'application' && openOutcomeFor === row.id ? (
                    <div className="flex flex-col gap-2 border-l-4 border-l-[var(--color-owed)] bg-stone-50 px-4 py-3">
                      <p className="text-sm font-medium text-stone-800">Did you hear back?</p>
                      <div className="flex flex-wrap gap-2">
                        {OUTCOME_OPTIONS.map((opt) => (
                          <Button key={opt.id} variant="secondary" size="sm" onClick={() => handleOutcome(row.id, opt.id)}>
                            {opt.label}
                          </Button>
                        ))}
                      </div>
                      {outcomeError ? (
                        <p className="text-xs font-medium text-[var(--color-owed)]">{outcomeError}</p>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="self-start"
                        onClick={() => {
                          setOpenOutcomeFor(null);
                          setOutcomeError(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-stone-900">Waiting on others</h2>
        {waitingOnOthers.length === 0 ? (
          <EmptyState title="Nobody owes you anything right now." />
        ) : (
          <Card>
            <ul className="divide-y divide-stone-200">
              {waitingOnOthers.map((row) => {
                const since =
                  row.overdueDays > 0
                    ? `nudged ${row.overdueDays} day${row.overdueDays === 1 ? '' : 's'} ago`
                    : 'waiting for a reply';
                return (
                  <li key={row.id}>
                    <RowShell
                      row={row}
                      tone="waiting"
                      action={
                        <p className="whitespace-nowrap text-xs text-stone-500">
                          Waiting on {row.counterpartyName ?? 'them'} — {since}.
                        </p>
                      }
                    />
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-stone-900">Your posts</h2>
        {myPosts.length === 0 ? (
          <EmptyState title="You have not posted anything yet." />
        ) : (
          <Card>
            <ul className="divide-y divide-stone-200">
              {myPosts.map((post) => {
                const stats = posterStatsFor(post.id);
                const fresh = freshnessFor(post, now);
                const company = post.companyId ? companies.find((c) => c.id === post.companyId) : null;
                const companyLabel = company?.name ?? post.confidentialDescriptor ?? 'Company withheld';
                const statsText = stats.outcomesUnknown
                  ? `${stats.views} views · ${stats.applied} applied · outcomes unknown`
                  : `${stats.views} views · ${stats.applied} applied · ${stats.heardBack} heard back`;
                const needsConfirm = confirmDuePostIds.has(post.id);
                return (
                  <li key={post.id}>
                    <button
                      type="button"
                      onClick={() => onOpenPost(post.id)}
                      className="flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-stone-50"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Chip tone="neutral">Your post</Chip>
                          {needsConfirm ? <Chip tone="owed">Confirmation due</Chip> : null}
                        </div>
                        <p className="mt-1 truncate text-sm font-semibold text-stone-900">{post.title}</p>
                        <p className="truncate text-xs text-stone-500">
                          {companyLabel} · {fresh.label}
                        </p>
                        <p className="truncate text-xs text-stone-500">{statsText}</p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}
