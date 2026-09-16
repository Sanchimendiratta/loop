/**
 * Board ordering (Lite §6): connection rung, then newest.
 *
 * Lite drops v1.3's freshness tier from the sort key — a stale post sinks
 * because it is older, not because a separate rule demotes it, and nothing is
 * filtered off the board at all.
 */
import { CONNECTION_RANK } from './disclosure.ts';
import type { JobPost } from '../data/schema.ts';

export function sortPosts(posts: JobPost[], _now: number, mode: 'connection' | 'recent' = 'connection'): JobPost[] {
  return [...posts].sort((a, b) =>
    mode === 'recent'
      ? b.postedAt - a.postedAt
      : CONNECTION_RANK[a.connection] - CONNECTION_RANK[b.connection] || b.postedAt - a.postedAt,
  );
}
