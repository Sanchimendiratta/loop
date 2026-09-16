/**
 * Board ordering (D16): connection rung, then freshness, then recency.
 *
 * Cold forwards are allowed and honestly badged — §5.0 shows they are a real
 * share of useful volume — but they do not get the top of the board. Ranking by
 * proximity rather than recency is what stops the board becoming the WhatsApp
 * scroll it replaces.
 */
import { freshnessFor } from './freshness.ts';
import { RELATIONSHIP_RANK } from '../data/schema.ts';
import type { JobPost } from '../data/schema.ts';

const FRESHNESS_ORDER: Record<string, number> = {
  fresh: 0,
  confirm_due: 1,
  unconfirmed: 2,
  filled: 3,
  archived: 4,
};

export function rankKey(post: JobPost, now: number): [number, number, number] {
  const f = freshnessFor(post, now);
  return [RELATIONSHIP_RANK[post.posterRelationship], FRESHNESS_ORDER[f.state] ?? 9, -post.postedAt];
}

/** Live posts only, best first. Archived and filled leave the board entirely. */
export function sortPosts(posts: JobPost[], now: number): JobPost[] {
  return posts
    .filter((p) => {
      const f = freshnessFor(p, now);
      return f.state !== 'archived' && f.state !== 'filled';
    })
    .map((p) => ({ p, k: rankKey(p, now) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.k[2] - b.k[2])
    .map(({ p }) => p);
}
