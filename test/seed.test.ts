import { describe, expect, test } from 'vitest';
import { buildSeed } from '../src/data/seed.ts';
import { isStale } from '../src/core/applications.ts';
import { DAY_MS } from '../src/core/time.ts';

const NOW = Date.UTC(2026, 8, 17);

describe('the Lite demo workspace', () => {
  const s = buildSeed(NOW);

  test('it is deterministic for a fixed now', () => {
    expect(JSON.stringify(buildSeed(NOW))).toBe(JSON.stringify(buildSeed(NOW)));
  });

  test('the five real messages are seeded as posts', () => {
    expect(s.posts.length).toBeGreaterThanOrEqual(5);
    for (const p of s.posts.slice(0, 5)) expect(p.rawPaste?.length ?? 0).toBeGreaterThan(20);
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

  test('a pending verification case is waiting for the admin', () => {
    expect(s.members.some((m) => m.status === 'pending' && m.linkedinUrl.length > 0)).toBe(true);
  });

  test('unread notifications exist so the bell shows a count', () => {
    expect(s.notifications.some((n) => n.readAt === null)).toBe(true);
  });
});
