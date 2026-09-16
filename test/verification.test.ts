import { describe, expect, test } from 'vitest';
import { canAppeal, decideCase, requiredVouches, tierForEmail, vouchingUnlocked } from '../src/core/verification.ts';
import type { School, VerificationCase } from '../src/data/schema.ts';

const school: School = { id: 's1', name: 'XLRI', verifiedDomains: ['astra.xlri.ac.in'] };

const pendingCase = (over: Partial<VerificationCase> = {}): VerificationCase => ({
  id: 'v1', memberId: 'm1', tier: 'B',
  evidence: { linkedinUrl: 'https://linkedin.com/in/rohit', batch: 2019, programme: 'HRM', nameAtGraduation: 'Rohit' },
  decision: 'pending', reviewerId: null, decidedAt: null, notes: '', isAppeal: false, submittedAt: 0, ...over,
});

describe('verification (section 6)', () => {
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
    expect(tierForEmail('@astra.xlri.ac.in', school)).toBe('A');
  });

  test('a personal address needs manual review', () => {
    expect(tierForEmail('rohit@gmail.com', school)).toBeNull();
  });

  test('a decision records reviewer, time and reason', () => {
    const decided = decideCase(pendingCase(), 'approved', 'admin1', 1000, 'LinkedIn shows XLRI HRM 2019');
    expect(decided.decision).toBe('approved');
    expect(decided.reviewerId).toBe('admin1');
    expect(decided.decidedAt).toBe(1000);
    expect(decided.notes).toBe('LinkedIn shows XLRI HRM 2019');
  });

  test('deciding does not mutate the original case', () => {
    const original = pendingCase();
    decideCase(original, 'rejected', 'admin1', 1000, 'no XLRI entry');
    expect(original.decision).toBe('pending');
  });

  test('a rejected case may be appealed once', () => {
    const rejected = decideCase(pendingCase(), 'rejected', 'admin1', 1000, 'no');
    expect(canAppeal(rejected)).toBe(true);
    expect(canAppeal({ ...rejected, isAppeal: true })).toBe(false);
  });

  test('an approved case cannot be appealed', () => {
    expect(canAppeal(decideCase(pendingCase(), 'approved', 'a', 1, ''))).toBe(false);
  });

  test('a pending case cannot be appealed', () => {
    expect(canAppeal(pendingCase())).toBe(false);
  });

  test('vouching stays locked below the threshold', () => {
    expect(vouchingUnlocked(199)).toBe(false);
    expect(vouchingUnlocked(200)).toBe(true);
    expect(requiredVouches()).toBe(2);
  });
});
