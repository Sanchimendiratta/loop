import { describe, expect, test } from 'vitest';
import { sortPosts } from '../src/core/rank.ts';
import { DAY_MS } from '../src/core/time.ts';
import type { Connection, JobPost } from '../src/data/schema.ts';

const NOW = Date.UTC(2026, 8, 17);
const post = (id: string, connection: Connection, agedDays = 0): JobPost =>
  ({ id, connection, postedAt: NOW - agedDays * DAY_MS }) as JobPost;

describe('board ordering (Lite §6: connection rung, then newest)', () => {
  test('connection beats recency', () => {
    const out = sortPosts([post('f', 'forwarded', 0), post('h', 'hiring', 30)], NOW);
    expect(out.map((p) => p.id)).toEqual(['h', 'f']);
  });

  test('all four rungs order correctly', () => {
    const out = sortPosts(
      [post('d', 'forwarded'), post('b', 'works_here'), post('a', 'hiring'), post('c', 'knows_contact')],
      NOW,
    );
    expect(out.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('within a rung, newer first', () => {
    const out = sortPosts([post('old', 'hiring', 5), post('new', 'hiring', 1)], NOW);
    expect(out.map((p) => p.id)).toEqual(['new', 'old']);
  });

  test('"Most recent" mode ignores the rung', () => {
    const out = sortPosts([post('h', 'hiring', 9), post('f', 'forwarded', 1)], NOW, 'recent');
    expect(out.map((p) => p.id)).toEqual(['f', 'h']);
  });

  test('a stale post still appears — Lite never hides a post', () => {
    expect(sortPosts([post('s', 'forwarded', 400)], NOW)).toHaveLength(1);
  });

  test('sorting does not mutate the input', () => {
    const input = [post('b', 'forwarded'), post('a', 'hiring')];
    sortPosts(input, NOW);
    expect(input.map((p) => p.id)).toEqual(['b', 'a']);
  });
});
