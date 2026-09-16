/**
 * Confirm-or-decay (D14).
 *
 * §5.1 names the defining failure of WhatsApp job forwarding: a filled role
 * still circulating three months later. A post therefore has to earn its place
 * on the board repeatedly rather than once.
 *
 * "I don't know" is a first-class answer, not a non-answer. A *Forwarded*
 * poster genuinely cannot know whether the role is still open, and forcing a
 * yes/no out of them would manufacture exactly the false confidence the clock
 * exists to remove — so it resets the confirmation clock without asserting the
 * post is open.
 */
import { daysBetween } from './time.ts';
import type { JobPost } from '../data/schema.ts';

export const CONFIRM_PROMPT_DAYS = [14, 28] as const;
export const DEFAULT_LIFE_DAYS = 30;
export const ARCHIVE_DAY = 45;

export type FreshnessState = 'fresh' | 'confirm_due' | 'unconfirmed' | 'filled' | 'archived';

export interface Freshness {
  state: FreshnessState;
  ageDays: number;
  daysSinceConfirmed: number;
  label: string;
  promptDue: boolean;
  shouldArchive: boolean;
}

export function freshnessFor(post: JobPost, now: number): Freshness {
  const ageDays = daysBetween(post.postedAt, now);
  const daysSinceConfirmed = daysBetween(post.lastConfirmedAt, now);

  if (post.archivedAt !== null) {
    return { state: 'archived', ageDays, daysSinceConfirmed, label: 'Archived', promptDue: false, shouldArchive: false };
  }

  if (post.confirmState === 'filled') {
    return { state: 'filled', ageDays, daysSinceConfirmed, label: 'Filled', promptDue: false, shouldArchive: true };
  }

  if (ageDays >= ARCHIVE_DAY) {
    return {
      state: 'unconfirmed', ageDays, daysSinceConfirmed,
      label: `Unconfirmed — last confirmed ${daysSinceConfirmed} days ago`,
      promptDue: false, shouldArchive: true,
    };
  }

  if (daysSinceConfirmed > DEFAULT_LIFE_DAYS) {
    return {
      state: 'unconfirmed', ageDays, daysSinceConfirmed,
      label: `Unconfirmed — last confirmed ${daysSinceConfirmed} days ago`,
      promptDue: true, shouldArchive: false,
    };
  }

  const promptDue = CONFIRM_PROMPT_DAYS.some((d) => daysSinceConfirmed >= d);
  if (promptDue) {
    return {
      state: 'confirm_due', ageDays, daysSinceConfirmed,
      label: `Posted ${ageDays} days ago — still open?`, promptDue: true, shouldArchive: false,
    };
  }

  return {
    state: 'fresh', ageDays, daysSinceConfirmed,
    label: ageDays === 0 ? 'Posted today' : `Posted ${ageDays} days ago`,
    promptDue: false, shouldArchive: false,
  };
}
