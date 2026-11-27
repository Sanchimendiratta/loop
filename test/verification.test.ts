import { describe, expect, test } from 'vitest';
import { LOOP_SCHOOL, tierForEmail } from '../src/core/verification.ts';

const school = { verifiedDomains: ['astra.xlri.ac.in'] };

describe('verification (Lite §3)', () => {
  test('an institute address is Tier A', () => {
    expect(tierForEmail('ananya@astra.xlri.ac.in', school)).toBe('A');
  });

  test('the domain match is case-insensitive and ignores surrounding space', () => {
    expect(tierForEmail('  Ananya@ASTRA.XLRI.AC.IN ', school)).toBe('A');
  });

  test('a lookalike domain is not Tier A', () => {
    expect(tierForEmail('someone@notastra.xlri.ac.in.evil.com', school)).toBeNull();
    expect(tierForEmail('someone@xlri.ac.in', school)).toBeNull();
  });

  test('a subdomain of the allowlisted domain is not Tier A', () => {
    expect(tierForEmail('someone@evil.astra.xlri.ac.in', school)).toBeNull();
  });

  test('an address with two @ signs cannot smuggle the allowlisted domain', () => {
    // Delivers to evil.com; `split('@')[1]` would have returned the middle
    // segment and granted Tier A.
    expect(tierForEmail('attacker@astra.xlri.ac.in@evil.com', school)).toBeNull();
  });

  test('malformed input is rejected rather than guessed at', () => {
    expect(tierForEmail('no-at-sign', school)).toBeNull();
    expect(tierForEmail('', school)).toBeNull();
  });

  test('an address with no local part is not Tier A — nobody can own it', () => {
    // The domain is allowlisted, but there is no mailbox, so the address
    // cannot be delivered to and cannot be anyone's institute address.
    // Granting it Tier A would hand instant, unreviewed membership to a string
    // nobody owns.
    expect(tierForEmail('@astra.xlri.ac.in', school)).toBeNull();
    expect(tierForEmail('   @astra.xlri.ac.in  ', school)).toBeNull();
  });

  test('a personal address needs manual review', () => {
    expect(tierForEmail('rohit@gmail.com', school)).toBeNull();
  });

  test('the shipped allowlist is the one institute domain', () => {
    expect(LOOP_SCHOOL.verifiedDomains).toEqual(['astra.xlri.ac.in']);
    expect(tierForEmail('ananya@astra.xlri.ac.in', LOOP_SCHOOL)).toBe('A');
  });
});
