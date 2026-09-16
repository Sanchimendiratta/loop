/**
 * Membership verification (§6).
 *
 * D2 makes this the whole product: "a referral network that lets anyone in is
 * LinkedIn." Tier A is a domain fact and is therefore instant. Tier B is a
 * human judgement over a self-declared LinkedIn education entry — §6 is candid
 * that this is a plausibility check, not proof — so every decision carries a
 * reviewer, a timestamp and a reason, and rejection is appealable once.
 */
import { VOUCHING_UNLOCK_THRESHOLD } from '../data/schema.ts';
import type { School, VerificationCase, VerificationTier } from '../data/schema.ts';

/**
 * Tier A iff the address's domain is exactly an allowlisted one.
 *
 * Suffix matching would admit `astra.xlri.ac.in.example.com`, which is the
 * cheapest possible forgery of the one signal we treat as proof.
 */
export function tierForEmail(email: string, school: School): VerificationTier | null {
  const domain = String(email ?? '').trim().toLowerCase().split('@')[1];
  if (!domain) return null;
  return school.verifiedDomains.some((d) => d.toLowerCase() === domain) ? 'A' : null;
}

export function decideCase(
  c: VerificationCase,
  decision: 'approved' | 'rejected' | 'more_info',
  reviewerId: string,
  at: number,
  notes: string,
): VerificationCase {
  return { ...c, decision, reviewerId, decidedAt: at, notes };
}

/** §6: one appeal, with documentary evidence, reviewed by a second admin. */
export function canAppeal(c: VerificationCase): boolean {
  return c.decision === 'rejected' && !c.isAppeal;
}

export function vouchingUnlocked(verifiedCount: number): boolean {
  return verifiedCount >= VOUCHING_UNLOCK_THRESHOLD;
}

export function requiredVouches(): number {
  return 2;
}
