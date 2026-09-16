/**
 * Admin — screen 8, and per §3 "the entire admin tool".
 *
 * Three lists, nothing else:
 *   1. The verification queue — a real `<table>` of name, batch, programme,
 *      LinkedIn and requested-on, two buttons per row. `knownBy` rides along
 *      as its own column because it is the second thread to pull on a thin
 *      profile, and evidence the applicant submitted themselves rather than
 *      something read off their row (the same distinction
 *      `VerificationGate.tsx`'s `PendingScreen` draws for the exact same
 *      field).
 *   2. The decided list — an audit trail of who was ruled on, by whom, when,
 *      and with what note. `store.decidedCases()` filters on `decidedById`
 *      rather than `status`, because an institute address in
 *      `submitVerification` also lands `status: 'verified'` with nobody
 *      having decided anything.
 *   3. Reports — §4's whole moderation story: the reported post, the reason,
 *      and a delete.
 *
 * Approve commits in one tap — a low-stakes, reversible-by-re-review action.
 * Reject and delete do not get that treatment: neither has an undo anywhere
 * in the store (Lite has no appeals, §3, and `deletePost` is unconditional),
 * so both get the same second, deliberate step — an inline row that opens in
 * place of a plain click and requires an explicit, separate Confirm before
 * anything commits. Reject additionally requires typing the note the
 * rejected member will read on their gate; delete does not, because the
 * report it acts on already carries the reason — the extra step here is the
 * point, not more typing. Nothing here fetches, embeds or previews the
 * LinkedIn URL — it is a plain anchor the admin clicks themselves, opening in
 * a new tab, exactly like every other LinkedIn value in this app (§7.4).
 */
import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  RuleViolation,
  decideVerification,
  decidedCases,
  deletePost,
  getPost,
  listReports,
  pendingCases,
} from '../data/store.ts';
import type { PendingCase } from '../data/store.ts';
import type { Report } from '../data/schema.ts';
import { dayLabel } from '../core/time.ts';
import { Button, Chip, EmptyState, Field, Textarea } from './primitives.tsx';

/**
 * The plain default note an approval carries. §3 requires every decision to
 * record a note, but only a rejection needs the admin to author one by hand —
 * it is the only decision the affected member ever reads back (`decisionNote`
 * on `RejectedScreen`). Approval's note exists for the audit trail below, not
 * for the approved member, so a fixed, honest sentence serves it.
 */
const APPROVE_NOTE = 'Approved after review of the submitted LinkedIn profile and batch details.';

function LinkedInLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium break-all text-brand-700 underline"
    >
      {url}
    </a>
  );
}

function QueueRow({ member, now }: { member: PendingCase; now: number }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const panelId = `admin-reject-${member.id}`;

  function approve(): void {
    try {
      decideVerification(member.id, 'verified', APPROVE_NOTE, now);
      setError(null);
    } catch (err) {
      setError(err instanceof RuleViolation ? err.message : 'Something went wrong. Try again.');
    }
  }

  function openReject(): void {
    setRejecting(true);
    setError(null);
  }

  function cancelReject(): void {
    setRejecting(false);
    setNote('');
    setError(null);
  }

  function confirmReject(e: FormEvent): void {
    e.preventDefault();
    const trimmed = note.trim();
    if (!trimmed) {
      setError('Say why — the member sees this note on their gate.');
      return;
    }
    try {
      decideVerification(member.id, 'rejected', trimmed, now);
    } catch (err) {
      setError(err instanceof RuleViolation ? err.message : 'Something went wrong. Try again.');
    }
  }

  return (
    <>
      <tr className="border-b border-stone-100 align-top">
        <td data-label="Name" className="px-3 py-3 font-medium text-stone-900">
          {member.name}
        </td>
        <td data-label="Batch" className="px-3 py-3 tabular-nums text-stone-600">
          {member.batch}
        </td>
        <td data-label="Programme" className="px-3 py-3 text-stone-600">
          {member.programme}
        </td>
        <td data-label="Known by" className="px-3 py-3 text-stone-600">
          {member.knownBy ? member.knownBy : <span className="italic text-stone-400">Not given</span>}
        </td>
        <td data-label="LinkedIn" className="px-3 py-3">
          <LinkedInLink url={member.linkedinUrl} />
        </td>
        <td data-label="Requested" className="px-3 py-3 tabular-nums text-stone-600">
          {dayLabel(member.requestedAt, now)}
        </td>
        <td data-label="Decide" className="px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="primary" onClick={approve}>
              Approve
            </Button>
            <Button
              type="button"
              size="sm"
              variant="danger"
              aria-expanded={rejecting}
              aria-controls={panelId}
              onClick={rejecting ? cancelReject : openReject}
            >
              Reject
            </Button>
          </div>
          {error && !rejecting ? (
            <p className="mt-1 text-xs font-medium text-[var(--color-owed)]">{error}</p>
          ) : null}
        </td>
      </tr>

      {rejecting ? (
        <tr id={panelId} className="border-b border-stone-100 bg-[var(--color-owed-soft)]">
          <td colSpan={7} className="plain px-3 py-4">
            <form className="max-w-xl" onSubmit={confirmReject}>
              <Field
                label={`Reason for rejecting ${member.name}`}
                hint="This note is shown to them in place of the board — write it as if they will read it, because they will."
                required
              >
                <Textarea value={note} onChange={(e) => setNote(e.currentTarget.value)} rows={3} required />
              </Field>
              {error ? <p className="mt-2 text-sm font-medium text-[var(--color-owed)]">{error}</p> : null}
              <div className="mt-3 flex gap-2">
                <Button type="submit" size="sm" variant="danger">
                  Confirm reject
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={cancelReject}>
                  Cancel
                </Button>
              </div>
            </form>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function VerificationQueue({ now }: { now: number }) {
  const cases = pendingCases();

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-stone-900">Verification queue</h2>
        <p className="text-xs text-stone-500">
          {cases.length === 0 ? 'Nothing waiting.' : `${cases.length} waiting for a decision.`}
        </p>
      </div>

      {cases.length === 0 ? (
        <EmptyState title="Nothing waiting" body="Every submitted case has been reviewed." />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-stone-900/5">
          <table className="stack-table w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs font-semibold text-stone-500">
                <th scope="col" className="px-3 py-2">Name</th>
                <th scope="col" className="px-3 py-2">Batch</th>
                <th scope="col" className="px-3 py-2">Programme</th>
                <th scope="col" className="px-3 py-2">Known by</th>
                <th scope="col" className="px-3 py-2">LinkedIn</th>
                <th scope="col" className="px-3 py-2">Requested</th>
                <th scope="col" className="px-3 py-2">Decide</th>
              </tr>
            </thead>
            <tbody>
              {cases.map((member) => (
                <QueueRow key={member.id} member={member} now={now} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DecidedList({ now }: { now: number }) {
  const decided = decidedCases();

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-stone-900">Decided</h2>
        <p className="text-xs text-stone-500">The audit trail — every case a reviewer has ruled on.</p>
      </div>

      {decided.length === 0 ? (
        <EmptyState title="Nothing decided yet" body="Approvals and rejections will show up here." />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-stone-900/5">
          <table className="stack-table w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs font-semibold text-stone-500">
                <th scope="col" className="px-3 py-2">Name</th>
                <th scope="col" className="px-3 py-2">Decision</th>
                <th scope="col" className="px-3 py-2">Decided by</th>
                <th scope="col" className="px-3 py-2">Decided</th>
                <th scope="col" className="px-3 py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {decided.map((member) => (
                <tr key={member.id} className="border-b border-stone-100 align-top last:border-b-0">
                  <td data-label="Name" className="px-3 py-3 font-medium text-stone-900">
                    {member.name}
                  </td>
                  <td data-label="Decision" className="px-3 py-3">
                    <Chip tone={member.status === 'verified' ? 'ok' : 'owed'}>
                      {member.status === 'verified' ? 'Approved' : 'Rejected'}
                    </Chip>
                  </td>
                  <td data-label="Decided by" className="px-3 py-3 text-stone-600">
                    {member.decidedByName}
                  </td>
                  <td data-label="Decided" className="px-3 py-3 tabular-nums text-stone-600">
                    {member.decidedAt ? dayLabel(member.decidedAt, now) : '—'}
                  </td>
                  <td data-label="Note" className="px-3 py-3 text-stone-600">
                    {member.decisionNote || <span className="italic text-stone-400">No note recorded</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ReportRow({ report, now }: { report: Report; now: number }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const post = getPost(report.jobPostId);
  const panelId = `admin-delete-${report.id}`;

  function openConfirm(): void {
    setConfirming(true);
    setError(null);
  }

  function cancelConfirm(): void {
    setConfirming(false);
    setError(null);
  }

  function confirmDelete(): void {
    try {
      deletePost(report.jobPostId, now);
      // No `setConfirming(false)` needed on success: a successful delete
      // resolves the report, so `listReports()` drops this row on the next
      // read and this component unmounts along with it.
    } catch (err) {
      setError(err instanceof RuleViolation ? err.message : 'Something went wrong. Try again.');
    }
  }

  return (
    <>
      <tr className="border-b border-stone-100 align-top last:border-b-0">
        <td data-label="Post" className="px-3 py-3">
          {post ? (
            <>
              <p className="font-medium text-stone-900">{post.title}</p>
              {post.companyName ? <p className="text-xs text-stone-500">{post.companyName}</p> : null}
            </>
          ) : (
            <span className="italic text-stone-400">This post no longer exists.</span>
          )}
        </td>
        <td data-label="Reason" className="px-3 py-3 text-stone-700">
          {report.reason}
        </td>
        <td data-label="Reported" className="px-3 py-3 tabular-nums text-stone-600">
          {dayLabel(report.at, now)}
        </td>
        <td data-label="Action" className="px-3 py-3">
          {post ? (
            <Button
              type="button"
              size="sm"
              variant="danger"
              aria-expanded={confirming}
              aria-controls={panelId}
              onClick={confirming ? cancelConfirm : openConfirm}
            >
              Delete post
            </Button>
          ) : null}
          {error && !confirming ? (
            <p className="mt-1 text-xs font-medium text-[var(--color-owed)]">{error}</p>
          ) : null}
        </td>
      </tr>

      {confirming ? (
        <tr id={panelId} className="border-b border-stone-100 bg-[var(--color-owed-soft)]">
          <td colSpan={4} className="plain px-3 py-4">
            <div className="max-w-xl">
              <p className="text-sm font-semibold text-stone-900">Delete this post?</p>
              <p className="mt-1 text-sm text-stone-700">
                This removes it for every member, including anyone who applied. It cannot be undone — there
                is no recovering it afterwards.
              </p>
              {error ? <p className="mt-2 text-sm font-medium text-[var(--color-owed)]">{error}</p> : null}
              <div className="mt-3 flex gap-2">
                <Button type="button" size="sm" variant="danger" onClick={confirmDelete}>
                  Confirm delete
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={cancelConfirm}>
                  Cancel
                </Button>
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function Reports({ now }: { now: number }) {
  const reports = listReports();

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-stone-900">Reports</h2>
        <p className="text-xs text-stone-500">
          {reports.length === 0 ? 'Nothing reported.' : `${reports.length} open.`}
        </p>
      </div>

      {reports.length === 0 ? (
        <EmptyState title="Nothing reported" body="Reported posts will show up here, with the reason and a delete." />
      ) : (
        <div className="overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-stone-900/5">
          <table className="stack-table w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs font-semibold text-stone-500">
                <th scope="col" className="px-3 py-2">Post</th>
                <th scope="col" className="px-3 py-2">Reason</th>
                <th scope="col" className="px-3 py-2">Reported</th>
                <th scope="col" className="px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <ReportRow key={report.id} report={report} now={now} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function Admin({ now }: { now: number }) {
  return (
    <div className="flex flex-col gap-8 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold text-stone-900">Admin</h1>
      </div>
      <VerificationQueue now={now} />
      <DecidedList now={now} />
      <Reports now={now} />
    </div>
  );
}
