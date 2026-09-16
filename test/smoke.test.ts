import { expect, test } from 'vitest';
import { DAY_MS } from '../src/core/time.ts';

test('the test runner and core imports are wired up', () => {
  expect(DAY_MS).toBe(86_400_000);
});
