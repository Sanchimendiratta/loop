/**
 * Post ageing (Lite §6 sheet 3).
 *
 * v1.3 ran a confirm-or-decay clock with prompts at day 14 and 28 and an
 * auto-archive at 45. Lite keeps only the visible half: a post with no update
 * in 30 days greys out and drops to the bottom. Nothing is hidden, and there is
 * deliberately no `shouldArchive` — a poster who never returns should see their
 * post fade, not vanish.
 */
import { daysBetween } from './time.ts';

export const STALE_AFTER_DAYS = 30;

export function postAge(post: { postedAt: number }, now: number): { ageDays: number; stale: boolean; label: string } {
  const ageDays = daysBetween(post.postedAt, now);
  return {
    ageDays,
    stale: ageDays >= STALE_AFTER_DAYS,
    label: ageDays === 0 ? 'today' : `${ageDays}d ago`,
  };
}
