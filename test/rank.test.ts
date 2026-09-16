import { describe, expect, test } from 'vitest';
import { sortPosts } from '../src/core/rank.ts';
import { DAY_MS } from '../src/core/time.ts';
import type { JobPost, PosterRelationship } from '../src/data/schema.ts';

const NOW = Date.UTC(2026, 8, 16);
const post = (id: string, rel: PosterRelationship, agedDays = 0, over: Partial<JobPost> = {}): JobPost => ({
  id, posterId: 'm1', companyId: 'c1', confidentialDescriptor: null, title: 'Role',
  locations: [], expMin: null, expMax: null, compText: null, function: null,
  applyMethod: 'email', applyValue: 'a@b.com', jdUrl: null,
  posterRelationship: rel, destinationType: 'company_ats',
  hiringContactName: null, hiringContactValue: null, contactConsentConfirmed: true,
  contactRemovalRequestedAt: null, rawText: '', parseConfidence: 1, dedupeHash: id,
  postedAt: NOW - agedDays * DAY_MS, lastConfirmedAt: NOW - agedDays * DAY_MS,
  confirmState: 'open', archivedAt: null, viewCount: 0, unreachableFlags: [], reportedBy: [], ...over,
});

describe('ranking (D16)', () => {
  test('connection rung beats recency', () => {
    const older_hm = post('hm', 'hiring_manager', 20);
    const newer_fwd = post('fwd', 'forwarded', 0);
    expect(sortPosts([newer_fwd, older_hm], NOW).map((p) => p.id)).toEqual(['hm', 'fwd']);
  });

  test('all four rungs order correctly', () => {
    const posts = [
      post('d', 'forwarded'), post('b', 'internal_can_refer'),
      post('a', 'hiring_manager'), post('c', 'knows_contact'),
    ];
    expect(sortPosts(posts, NOW).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('within a rung, an unconfirmed post deranks below a fresh one', () => {
    const fresh = post('fresh', 'forwarded', 2);
    const stale = post('stale', 'forwarded', 35);
    expect(sortPosts([stale, fresh], NOW).map((p) => p.id)).toEqual(['fresh', 'stale']);
  });

  test('within a rung and the same freshness, newer wins', () => {
    const newer = post('new', 'internal_can_refer', 1);
    const older = post('old', 'internal_can_refer', 5);
    expect(sortPosts([older, newer], NOW).map((p) => p.id)).toEqual(['new', 'old']);
  });

  test('a cold forward still appears — it is not filtered out', () => {
    expect(sortPosts([post('fwd', 'forwarded')], NOW)).toHaveLength(1);
  });

  test('archived and filled posts drop off the board', () => {
    const live = post('live', 'forwarded');
    const archived = post('arch', 'hiring_manager', 1, { archivedAt: NOW });
    const filled = post('filled', 'hiring_manager', 1, { confirmState: 'filled' });
    expect(sortPosts([archived, filled, live], NOW).map((p) => p.id)).toEqual(['live']);
  });

  test('sorting does not mutate the input array', () => {
    const input = [post('b', 'forwarded'), post('a', 'hiring_manager')];
    sortPosts(input, NOW);
    expect(input.map((p) => p.id)).toEqual(['b', 'a']);
  });
});
