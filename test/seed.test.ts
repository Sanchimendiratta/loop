import { describe, expect, test } from 'vitest';
import { buildSeed } from '../src/data/seed.ts';
import { isStale } from '../src/core/applications.ts';
import { DAY_MS } from '../src/core/time.ts';
import { PROGRAMMES } from '../src/data/schema.ts';
import {
  MSG_1_CONFIDENTIAL_STARTUP, MSG_2_PHONE_ROUTE, MSG_3_SEARCH_FIRM,
  MSG_4_NAMED_COMPANY, MSG_5_CAREERS_EMAIL,
} from '../src/data/messages.ts';

const NOW = Date.UTC(2026, 8, 17);

describe('the Lite demo workspace', () => {
  const s = buildSeed(NOW);

  test('it is deterministic for a fixed now', () => {
    expect(JSON.stringify(buildSeed(NOW))).toBe(JSON.stringify(buildSeed(NOW)));
  });

  test('the five real messages are seeded as posts, byte for byte', () => {
    expect(s.posts.length).toBeGreaterThanOrEqual(5);
    // Byte-equality, not a length floor: the point of seeding from the real
    // corpus is that the demo runs the parser over exactly what the group
    // sends. A paraphrased paste would pass `length > 20` and quietly stop
    // exercising the input this parser exists for.
    const corpus = [
      MSG_1_CONFIDENTIAL_STARTUP, MSG_2_PHONE_ROUTE, MSG_3_SEARCH_FIRM,
      MSG_4_NAMED_COMPANY, MSG_5_CAREERS_EMAIL,
    ];
    expect(s.posts.slice(0, 5).map((p) => p.rawPaste)).toEqual(corpus);
  });

  test('all four connection values appear, so the board demonstrates ranking', () => {
    expect(new Set(s.posts.map((p) => p.connection)).size).toBe(4);
  });

  test('three posts withhold the company, as in the real traffic', () => {
    const withheld = s.posts.slice(0, 5).filter((p) => p.isConfidential);
    expect(withheld).toHaveLength(3);
    for (const p of withheld) {
      expect(p.companyName).toBeNull();
      expect(p.confidentialDescriptor).toBeTruthy();
    }
  });

  test('every post title is human-written, never a raw parser guess', () => {
    for (const p of s.posts) {
      expect(p.title, p.id).not.toMatch(/^for a |^Opening for/i);
      expect(p.title.length, p.id).toBeGreaterThan(3);
    }
  });

  test('a stale post exists so ageing is visible', () => {
    expect(s.posts.some((p) => NOW - p.postedAt >= 30 * DAY_MS)).toBe(true);
  });

  test('the personas cover every gate state', () => {
    const byStatus = (st: string) => s.members.filter((m) => m.status === st).length;
    expect(byStatus('verified')).toBeGreaterThan(3);
    expect(byStatus('pending')).toBeGreaterThanOrEqual(1);
    expect(byStatus('rejected')).toBeGreaterThanOrEqual(1);
    expect(s.members.some((m) => m.isAdmin && m.status === 'verified')).toBe(true);
  });

  test('both verification routes are represented', () => {
    expect(s.members.some((m) => m.verifiedBy === 'domain')).toBe(true);
    expect(s.members.some((m) => m.verifiedBy === 'admin')).toBe(true);
  });

  test('the current member is a verified seeker, so the app opens on the board', () => {
    const me = s.members.find((m) => m.id === s.currentMemberId)!;
    expect(me.status).toBe('verified');
    expect(me.isAdmin).toBe(false);
  });

  test('applications span the ladder, including a stale one and a terminal one', () => {
    const mine = s.applications.filter((a) => a.memberId === s.currentMemberId);
    expect(mine.length).toBeGreaterThanOrEqual(3);
    expect(mine.some((a) => isStale(a, NOW))).toBe(true);
    expect(mine.some((a) => a.status === 'rejected' || a.status === 'offer')).toBe(true);
  });

  test('one post has several applicants, so My posts has something to expand', () => {
    const counts = new Map<string, number>();
    for (const a of s.applications) counts.set(a.jobPostId, (counts.get(a.jobPostId) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeGreaterThanOrEqual(3);
  });

  test('a pending verification case is waiting for the admin, with evidence', () => {
    const pending = s.members.filter((m) => m.status === 'pending');
    expect(pending.length).toBeGreaterThanOrEqual(1);
    for (const m of pending) {
      // The four things §3 says an admin decides against. `linkedinUrl` is a
      // non-optional string, so `length > 0` alone was the only one of these
      // that could have failed — and an empty queue row is exactly what makes
      // the admin screen undemonstrable.
      expect(m.linkedinUrl, m.id).toMatch(/^https?:\/\//);
      expect(m.batch, m.id).toBeGreaterThan(1900);
      expect(PROGRAMMES, m.id).toContain(m.programme);
      expect(m.name.trim().length, m.id).toBeGreaterThan(0);
      // Undecided: no reviewer, no timestamp, no note.
      expect(m.decidedAt, m.id).toBeNull();
      expect(m.decidedById, m.id).toBeNull();
      expect(m.verifiedBy, m.id).toBeNull();
    }
  });

  test('unread notifications exist so the bell shows a count', () => {
    expect(s.notifications.some((n) => n.readAt === null)).toBe(true);
  });
});
