import { describe, expect, test } from 'vitest';
import { buildSeed } from '../src/data/seed.ts';
import { VOUCHING_UNLOCK_THRESHOLD } from '../src/data/schema.ts';

const NOW = Date.UTC(2026, 8, 16);

describe('the demo network', () => {
  const s = buildSeed(NOW);

  test('exactly one school exists and no UI would need a second (D7)', () => {
    expect(s.school.verifiedDomains).toContain('astra.xlri.ac.in');
  });

  test('the five PRD personas are all present', () => {
    const names = s.members.map((m) => m.name);
    for (const n of ['Ananya', 'Rohit', 'Meera', 'Partho', 'Karan']) {
      expect(names.some((x) => x.startsWith(n)), `${n} missing`).toBe(true);
    }
  });

  test('enough verified members exist to unlock vouching (§6)', () => {
    const verified = s.members.filter((m) => m.status === 'verified').length;
    expect(verified).toBeGreaterThanOrEqual(VOUCHING_UNLOCK_THRESHOLD);
  });

  test('a pending Tier B case is waiting for an admin', () => {
    expect(s.cases.some((c) => c.decision === 'pending' && c.tier === 'B')).toBe(true);
  });

  test('all five §5.0 messages are seeded as posts', () => {
    expect(s.posts.length).toBeGreaterThanOrEqual(5);
    for (const p of s.posts.slice(0, 5)) expect(p.rawText.length).toBeGreaterThan(20);
  });

  test('three of the five seeded posts withhold the company, as in §5.0', () => {
    const withheld = s.posts.slice(0, 5).filter((p) => p.companyId === null);
    expect(withheld).toHaveLength(3);
    for (const p of withheld) expect(p.confidentialDescriptor).toBeTruthy();
  });

  test('all four relationship rungs are represented, so the board demonstrates ranking', () => {
    const rungs = new Set(s.posts.map((p) => p.posterRelationship));
    expect(rungs.size).toBe(4);
  });

  test('a duplicate post exists so the merge is visible', () => {
    expect(s.shares.length).toBeGreaterThan(0);
  });

  test('a stale post exists so decay is visible', () => {
    expect(s.posts.some((p) => NOW - p.lastConfirmedAt > 30 * 86_400_000)).toBe(true);
  });

  test('requests span every non-terminal state so the tracker has rows on both sides', () => {
    const states = new Set(s.requests.map((r) => r.state));
    for (const st of ['sent', 'accepted', 'submitted']) expect(states.has(st as never), `${st} missing`).toBe(true);
  });

  test('an overdue request exists for each side', () => {
    expect(s.requests.some((r) => r.stateOwner === 'referrer' && (r.nextUpdateDue ?? Infinity) < NOW)).toBe(true);
    expect(s.requests.some((r) => r.stateOwner === 'seeker' && (r.nextUpdateDue ?? Infinity) < NOW)).toBe(true);
  });

  test('the seed is deterministic for a fixed now', () => {
    expect(JSON.stringify(buildSeed(NOW))).toBe(JSON.stringify(buildSeed(NOW)));
  });
});
