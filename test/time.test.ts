import { describe, expect, test } from 'vitest';
import { DAY_MS, addDays, daysBetween, startOfDay } from '../src/core/time.ts';

describe('time', () => {
  test('daysBetween counts whole elapsed days', () => {
    const t0 = Date.UTC(2026, 8, 1, 9, 0, 0);
    expect(daysBetween(t0, t0 + 3 * DAY_MS)).toBe(3);
  });

  test('daysBetween floors a partial day', () => {
    const t0 = Date.UTC(2026, 8, 1, 9, 0, 0);
    expect(daysBetween(t0, t0 + 3 * DAY_MS + 60_000)).toBe(3);
  });

  test('daysBetween never returns a negative', () => {
    const t0 = Date.UTC(2026, 8, 10);
    expect(daysBetween(t0, t0 - 5 * DAY_MS)).toBe(0);
  });

  test('addDays advances by whole days', () => {
    const t0 = Date.UTC(2026, 8, 1);
    expect(addDays(t0, 14)).toBe(t0 + 14 * DAY_MS);
  });

  test('startOfDay strips the time portion', () => {
    const at = new Date(2026, 8, 16, 17, 45, 30).getTime();
    const start = new Date(startOfDay(at));
    expect([start.getHours(), start.getMinutes(), start.getSeconds()]).toEqual([0, 0, 0]);
  });
});
