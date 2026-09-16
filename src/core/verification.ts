/**
 * Membership verification (Lite §3).
 *
 * D2 makes this the whole product: "a referral network that lets anyone in is
 * LinkedIn." An institute address is a domain fact and is therefore instant;
 * everything else waits for an admin, who decides against a LinkedIn URL plus
 * batch, programme and an optional "known by". Lite folds the case row into
 * `member` (there are no appeals to thread), so the decision machinery that
 * used to live here — `decideCase`, the tier ladder, vouching — now lives in
 * `data/store.ts`'s `decideVerification`, which is the only thing that can
 * record a reviewer and notify the member in the same write.
 *
 * What is left here is the one judgement that is pure: does this address prove
 * membership by itself?
 */

/** The one row §7 says stays config rather than a table until a second school exists. */
export const LOOP_SCHOOL = {
  name: 'XLRI Jamshedpur',
  verifiedDomains: ['astra.xlri.ac.in'],
};

/**
 * Tier A iff the address's domain is exactly an allowlisted one.
 *
 * Suffix matching would admit `astra.xlri.ac.in.example.com`, which is the
 * cheapest possible forgery of the one signal we treat as proof.
 */
export function tierForEmail(email: string, school: { verifiedDomains: string[] }): 'A' | null {
  // Exactly one '@', and the domain is what follows it.
  //
  // `split('@')[1]` is NOT the same thing and is a real bypass: for
  // `attacker@astra.xlri.ac.in@evil.com` it returns the allowlisted middle
  // segment while the address actually delivers to evil.com — granting instant
  // verification to a forged address, on the one signal this product treats as
  // proof. Requiring a single '@' rejects malformed input instead of guessing
  // which part of it to trust.
  const parts = String(email ?? '').trim().toLowerCase().split('@');
  if (parts.length !== 2) return null;
  const domain = parts[1];
  if (!domain) return null;
  return school.verifiedDomains.some((d) => d.toLowerCase() === domain) ? 'A' : null;
}
