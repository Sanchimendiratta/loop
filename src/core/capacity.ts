/**
 * Volume control (§7.1 referrer capacity; spec DL1).
 *
 * The seeker side is deliberately uncapped — no max open requests, no
 * per-company limit, no closure block. Supply is protected from the receiving
 * end instead: a referrer sets their own intake, and a seeker is never stopped
 * on the way out. That is the whole of DL1 in one file.
 *
 * The single retained guard is the duplicate *submission*, which is not about
 * supply at all: two alumni filing the same person for the same role costs a
 * referrer their bonus and creates an ATS conflict on the company's side (§8).
 */
import { normaliseTitle } from './dedupe.ts';
import { isTerminal } from './requests.ts';
import { daysBetween } from './time.ts';
import type { Member, ReferralRequest } from '../data/schema.ts';

const MONTH_DAYS = 30;

export function openRequestsFor(referrerId: string, all: ReferralRequest[]): ReferralRequest[] {
  return all.filter((r) => r.referrerId === referrerId && !isTerminal(r.state));
}

export function referralsThisMonth(referrerId: string, all: ReferralRequest[], now: number): number {
  return all.filter(
    (r) => r.referrerId === referrerId && r.state !== 'sent' && r.state !== 'declined'
      && r.state !== 'expired' && daysBetween(r.updatedAt, now) < MONTH_DAYS,
  ).length;
}

export function intakeCheck(
  referrer: Member,
  all: ReferralRequest[],
  now: number,
): { accepting: boolean; reason: string | null; autoDeclineMessage: string | null } {
  const decline = referrer.caps.autoDeclineMessage || null;

  if (!referrer.openToReferring) return { accepting: false, reason: 'not_open', autoDeclineMessage: decline };
  if (referrer.caps.paused) return { accepting: false, reason: 'paused', autoDeclineMessage: decline };
  if (openRequestsFor(referrer.id, all).length >= referrer.caps.maxOpen) {
    return { accepting: false, reason: 'at_capacity', autoDeclineMessage: decline };
  }
  if (referralsThisMonth(referrer.id, all, now) >= referrer.caps.maxPerMonth) {
    return { accepting: false, reason: 'monthly_cap', autoDeclineMessage: decline };
  }
  return { accepting: true, reason: null, autoDeclineMessage: null };
}

/**
 * Returns the existing submitted request, if this seeker is already in for this
 * role at this company. Only a real submission counts — several alumni *offering*
 * to refer the same person is fine and common.
 */
export function duplicateSubmissionGuard(
  seekerId: string,
  companyId: string,
  roleTitle: string,
  all: ReferralRequest[],
): ReferralRequest | null {
  const target = normaliseTitle(roleTitle);
  const submitted: string[] = ['submitted', 'recruiter_contact', 'interviewing', 'offer', 'rejected'];
  return (
    all.find(
      (r) => r.seekerId === seekerId && r.companyId === companyId
        && submitted.includes(r.state) && normaliseTitle(r.roleTitle) === target,
    ) ?? null
  );
}
