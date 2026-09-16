import { describe, expect, test } from 'vitest';
import { postAge } from '../src/core/freshness.ts';
import { DAY_MS } from '../src/core/time.ts';

const NOW = Date.UTC(2026, 8, 17);

describe('post ageing (Lite §6 sheet 3 — visible ageing, no auto-archive)', () => {
  test('a new post is not stale', () => {
    const a = postAge({ postedAt: NOW }, NOW);
    expect(a.stale).toBe(false);
    expect(a.label).toBe('today');
  });

  test('yesterday reads as a day count', () => {
    expect(postAge({ postedAt: NOW - DAY_MS }, NOW).label).toBe('1d ago');
  });

  test('day 29 is still fresh', () => {
    expect(postAge({ postedAt: NOW - 29 * DAY_MS }, NOW).stale).toBe(false);
  });

  test('day 30 goes stale', () => {
    const a = postAge({ postedAt: NOW - 30 * DAY_MS }, NOW);
    expect(a.stale).toBe(true);
    expect(a.ageDays).toBe(30);
  });

  test('nothing archives — a very old post is stale, never hidden', () => {
    const a = postAge({ postedAt: NOW - 400 * DAY_MS }, NOW);
    expect(a.stale).toBe(true);
    expect(a).not.toHaveProperty('shouldArchive');
  });
});
