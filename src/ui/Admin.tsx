import { useState } from 'react';
import {
  decideVerification,
  dismissReport,
  getMember,
  getPost,
  listCases,
  listReports,
  RuleViolation,
  upholdReport,
  whatsappDigest,
} from '../data/store.ts';
import type { Report, VerificationCase } from '../data/schema.ts';
import { Button, Card, Chip, EmptyState, Field, Tabs, Textarea } from './primitives.tsx';
import type { Tone } from './primitives.tsx';

export interface AdminProps {
  now: number;
}

const HOUR_MS = 60 * 60 * 1000;
const SLA_HOURS = 48;

function hoursBetween(from: number, to: number): number {
  return (to - from) / HOUR_MS;
}

function formatHours(hours: number): string {
  return `${Math.round(Math.abs(hours))}h`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Copies to the clipboard without ever assuming the modern API is available
 * (or permitted) — a headless or otherwise locked-down browser falls back to
 * the old select-and-`execCommand` trick rather than silently doing nothing.
 * Nothing here reads the clipboard, and nothing here sends anything anywhere;
 * it is the one-way "get this text onto the device" operation the digest and
 * the evidence fields both need.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={() => {
        void copyText(text).then((ok) => {
          if (ok) {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }
        });
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}

function nameFor(memberId: string, fallback: string): string {
  return getMember(memberId)?.name ?? fallback;
}

/**
 * One case awaiting a decision. Evidence is rendered as TEXT with a copy
 * button only — never a link, an iframe, or anything fetched (§7.4 is
 * absolute: nothing in this product reads or injects a LinkedIn page).
 */
function CaseRow({ c, allCases, now }: { c: VerificationCase; allCases: VerificationCase[]; now: number }) {
  const [action, setAction] = useState<'reject' | 'more_info' | null>(null);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const name = nameFor(c.memberId, c.evidence.nameAtGraduation);
  const deadline = c.submittedAt + SLA_HOURS * HOUR_MS;
  const remaining = hoursBetween(now, deadline);
  const overdue = remaining < 0;

  // §6: an appeal is a second look, by construction of a second admin — this
  // finds the decision it is appealing so that second admin can be shown who
  // made the first one, rather than trusting them to remember or ask around.
  const original = c.isAppeal
    ? allCases
        .filter((o) => o.memberId === c.memberId && o.id !== c.id && o.decision === 'rejected' && o.submittedAt < c.submittedAt)
        .sort((a, b) => b.submittedAt - a.submittedAt)[0]
    : undefined;

  function reset() {
    setAction(null);
    setNotes('');
    setError(null);
  }

  function runDecide(decision: 'approved' | 'rejected' | 'more_info') {
    try {
      decideVerification(c.id, decision, notes);
      reset();
    } catch (e) {
      if (e instanceof RuleViolation) {
        setError(e.message);
      } else {
        throw e;
      }
    }
  }

  return (
    <li className="flex flex-col gap-3 px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-stone-900">{name}</p>
          <Chip tone="neutral">Tier {c.tier}</Chip>
          {c.isAppeal ? <Chip tone="stale">Appeal</Chip> : null}
        </div>
        <Chip tone={overdue ? 'stale' : 'ok'}>{overdue ? `${formatHours(remaining)} overdue` : `${formatHours(remaining)} left`}</Chip>
      </div>

      {c.isAppeal ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-500/30">
          {original
            ? `§6 requires a second admin: this decision was originally rejected by ${nameFor(original.reviewerId ?? '', 'an admin')} on ${new Date(original.decidedAt ?? 0).toLocaleDateString()} — "${original.notes}"`
            : 'This is an appeal of a prior rejection — §6 requires a second admin to decide it.'}
        </p>
      ) : null}

      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 rounded-lg bg-stone-50 p-3 text-xs">
        <dt className="font-medium text-stone-500">LinkedIn</dt>
        <dd className="flex min-w-0 items-center gap-2">
          <span className="truncate text-stone-800">{c.evidence.linkedinUrl}</span>
          <CopyButton text={c.evidence.linkedinUrl} />
        </dd>
        <dt className="font-medium text-stone-500">Batch / programme</dt>
        <dd className="text-stone-800">
          {c.evidence.batch} · {c.evidence.programme}
        </dd>
        <dt className="font-medium text-stone-500">Name at graduation</dt>
        <dd className="text-stone-800">{c.evidence.nameAtGraduation}</dd>
      </dl>

      {error ? <p className="text-xs font-medium text-[var(--color-owed)]">{error}</p> : null}

      {action === null ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={() => runDecide('approved')}>
            Approve
          </Button>
          <Button variant="danger" size="sm" onClick={() => setAction('reject')}>
            Reject
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setAction('more_info')}>
            Request more info
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg bg-brand-50 p-3 ring-1 ring-brand-500/20">
          <Field label={action === 'reject' ? 'Reason for rejecting' : 'What else is needed?'}>
            <Textarea value={notes} onChange={(e) => setNotes(e.currentTarget.value)} />
          </Field>
          <p className="text-xs text-stone-500">
            §6: every decision records the reviewer, a timestamp and this reason — a rejection with no note is not
            appealable.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={reset}>
              Cancel
            </Button>
            <Button
              variant={action === 'reject' ? 'danger' : 'primary'}
              size="sm"
              onClick={() => runDecide(action === 'reject' ? 'rejected' : 'more_info')}
            >
              Confirm
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function DecidedRow({ c }: { c: VerificationCase }) {
  const tone: Tone = c.decision === 'approved' ? 'ok' : c.decision === 'rejected' ? 'neutral' : 'waiting';
  return (
    <li className="flex flex-col gap-1 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-stone-900">{nameFor(c.memberId, c.evidence.nameAtGraduation)}</p>
        <Chip tone={tone}>{c.decision}</Chip>
        {c.isAppeal ? <Chip tone="stale">Appeal</Chip> : null}
      </div>
      <p className="text-xs text-stone-500">
        {nameFor(c.reviewerId ?? '', 'An admin')} · {c.decidedAt ? new Date(c.decidedAt).toLocaleString() : '—'}
      </p>
      {c.notes ? <p className="text-xs text-stone-700">{c.notes}</p> : null}
    </li>
  );
}

function VerificationQueue({ now }: { now: number }) {
  const cases = listCases();
  const needsReview = cases.filter((c) => c.decision === 'pending' || c.decision === 'more_info');
  const decided = cases
    .filter((c) => c.decision === 'approved' || c.decision === 'rejected')
    .sort((a, b) => (b.decidedAt ?? 0) - (a.decidedAt ?? 0));

  const decisionHours = decided
    .filter((c) => c.decidedAt !== null)
    .map((c) => hoursBetween(c.submittedAt, c.decidedAt as number));
  const med = median(decisionHours);
  const underSla = decisionHours.length > 0 ? Math.round((decisionHours.filter((h) => h <= SLA_HOURS).length / decisionHours.length) * 100) : null;

  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-stone-900">Needs review</h2>
          <p className="text-xs text-stone-500">
            {/* §11: >95% of decisions land under 48h — the queue has to show this number to hold itself to it. */}
            Median decision time: {med !== null ? formatHours(med) : '—'}
            {underSla !== null ? ` · ${underSla}% under 48h (${decisionHours.length} decided)` : ''}
          </p>
        </div>
        {needsReview.length === 0 ? (
          <EmptyState title="Nothing is waiting on a decision." />
        ) : (
          <Card>
            <ul className="divide-y divide-stone-200">
              {needsReview.map((c) => (
                <CaseRow key={c.id} c={c} allCases={cases} now={now} />
              ))}
            </ul>
          </Card>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold text-stone-900">Decided — the audit trail</h2>
        {decided.length === 0 ? (
          <EmptyState title="No decisions recorded yet." />
        ) : (
          <Card>
            <ul className="divide-y divide-stone-200">
              {decided.map((c) => (
                <DecidedRow key={c.id} c={c} />
              ))}
            </ul>
          </Card>
        )}
      </section>
    </div>
  );
}

function ReportRow({ report }: { report: Report }) {
  const [error, setError] = useState<string | null>(null);
  const reporterName = nameFor(report.reporterId, 'A member');
  const targetName =
    report.targetType === 'post'
      ? (getPost(report.targetId)?.title ?? 'A post no longer on the board')
      : nameFor(report.targetId, 'A member');

  function run(action: () => void) {
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

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="neutral">{report.targetType === 'post' ? 'Post' : 'Member'}</Chip>
        <p className="text-sm font-semibold text-stone-900">{targetName}</p>
      </div>
      <p className="text-sm text-stone-700">{report.reason}</p>
      <p className="text-xs text-stone-500">
        Reported by {reporterName} · {new Date(report.at).toLocaleString()}
      </p>
      {report.targetType === 'post' ? (
        <p className="text-xs text-stone-500">This post is hidden from the board while the report is open.</p>
      ) : null}
      {error ? <p className="text-xs font-medium text-[var(--color-owed)]">{error}</p> : null}
      <div className="flex gap-2">
        <Button variant="danger" size="sm" onClick={() => run(() => upholdReport(report.id))}>
          {report.targetType === 'post' ? 'Uphold — archive the post' : 'Uphold — suspend the member'}
        </Button>
        <Button variant="secondary" size="sm" onClick={() => run(() => dismissReport(report.id))}>
          Dismiss
        </Button>
      </div>
    </li>
  );
}

function Reports() {
  const reports = listReports();
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold text-stone-900">Open reports</h2>
      {reports.length === 0 ? (
        <EmptyState title="No open reports." />
      ) : (
        <Card>
          <ul className="divide-y divide-stone-200">
            {reports.map((r) => (
              <ReportRow key={r.id} report={r} />
            ))}
          </ul>
        </Card>
      )}
    </section>
  );
}

function Digest({ now }: { now: number }) {
  const text = whatsappDigest(now);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-stone-900">The WhatsApp digest</h2>
      {/* D17: nothing here sends anything — automated posting into a WhatsApp
          group would breach its terms, the same reasoning as §7.4's
          no-scraping stance. The button copies; a human pastes it in. */}
      <p className="text-xs text-stone-500">Paste this into the batch group.</p>
      <Card className="p-3">
        <pre className="whitespace-pre-wrap break-words text-sm text-stone-800">{text}</pre>
      </Card>
      <div>
        <CopyButton text={text} label="Copy digest" />
      </div>
    </section>
  );
}

const TABS = [
  { id: 'verification', label: 'Verification queue' },
  { id: 'reports', label: 'Reports' },
  { id: 'digest', label: 'WhatsApp digest' },
];

/**
 * The admin console: the §6 verification queue, §8 reports/takedown, and the
 * D17 WhatsApp digest. Every read here is admin-gated at the store (`listCases`,
 * `listReports`) or is the viewer's own — nothing is filtered again in this
 * file, and it goes through the store's public read/write functions only,
 * never the browser's persistence layer, the privacy module, or the store's
 * test-only whole-state escape hatch.
 */
export function Admin({ now }: AdminProps) {
  const [tab, setTab] = useState('verification');
  return (
    <div className="flex flex-col gap-4 p-6">
      <Tabs items={TABS} active={tab} onChange={setTab} />
      {tab === 'verification' ? <VerificationQueue now={now} /> : null}
      {tab === 'reports' ? <Reports /> : null}
      {tab === 'digest' ? <Digest now={now} /> : null}
    </div>
  );
}
