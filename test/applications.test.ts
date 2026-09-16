import { describe, expect, test } from 'vitest';
import { STALE_APPLICATION_DAYS, STATUS_LABEL, isStale, staleCount, staleNotice } from '../src/core/applications.ts';
import { DAY_MS } from '../src/core/time.ts';
import { APPLICATION_STATUSES } from '../src/data/schema.ts';
import type { Application } from '../src/data/schema.ts';

const NOW = Date.UTC(2026, 8, 17);
const app = (over: Partial<Application> = {}): Application => ({
  id: 'a1', jobPostId: 'p1', memberId: 'm1', appliedAt: NOW,
  status: 'yet_to_respond', statusUpdatedAt: NOW, ...over,
});

describe('status labels are plain language (§10)', () => {
  test('every status has a human label, never a raw code', () => {
    for (const s of APPLICATION_STATUSES) {
      const l = STATUS_LABEL[s];
      expect(l, s).toBeTruthy();
      expect(l, s).not.toMatch(/_/);
      expect(l[0], s).toBe(l[0].toUpperCase());
    }
  });

  test('the ladder reads as the PRD writes it', () => {
    expect(STATUS_LABEL.yet_to_respond).toBe('Yet to respond');
    expect(STATUS_LABEL.awaiting_next_round).toBe('Awaiting next round');
    expect(STATUS_LABEL.no_response).toBe('No response');
  });
});

describe('the one nudge that exists (§6 sheet 2)', () => {
  test('a row untouched for 14 days is stale', () => {
    expect(isStale(app({ statusUpdatedAt: NOW - 14 * DAY_MS }), NOW)).toBe(true);
  });

  test('13 days is not stale', () => {
    expect(isStale(app({ statusUpdatedAt: NOW - 13 * DAY_MS }), NOW)).toBe(false);
  });

  test('staleness measures the last status change, not the apply date', () => {
    const touched = app({ appliedAt: NOW - 60 * DAY_MS, statusUpdatedAt: NOW - 2 * DAY_MS });
    expect(isStale(touched, NOW)).toBe(false);
  });

  test('a terminal status is never stale — there is nothing left to update', () => {
    for (const s of ['offer', 'rejected', 'no_response'] as const) {
      expect(isStale(app({ status: s, statusUpdatedAt: NOW - 90 * DAY_MS }), NOW), s).toBe(false);
    }
  });

  test('the notice counts only stale rows', () => {
    const apps = [
      app({ id: 'a', statusUpdatedAt: NOW - 20 * DAY_MS }),
      app({ id: 'b', statusUpdatedAt: NOW - 20 * DAY_MS }),
      app({ id: 'c', statusUpdatedAt: NOW }),
    ];
    expect(staleCount(apps, NOW)).toBe(2);
  });

  test('the notice is the PRD sentence, and absent when nothing is stale', () => {
    expect(staleNotice(3)).toBe("3 applications haven't been updated in a while.");
    expect(staleNotice(1)).toBe("1 application hasn't been updated in a while.");
    expect(staleNotice(0)).toBeNull();
  });

  test('the threshold is 14 days', () => {
    expect(STALE_APPLICATION_DAYS).toBe(14);
  });
});
