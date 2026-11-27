import { expect, test } from 'vitest';
import { APPLICATION_STATUSES, CONNECTIONS, POST_STATUSES, TERMINAL_APPLICATION_STATUSES } from '../src/data/schema.ts';

test('the status ladder is Lite’s seven values in order', () => {
  expect(APPLICATION_STATUSES).toEqual([
    'yet_to_respond', 'in_review', 'interview_scheduled', 'awaiting_next_round',
    'offer', 'rejected', 'no_response',
  ]);
});

test('every terminal status is a real status', () => {
  // The length assertion is what stops this passing against an empty array —
  // which would silently make every row eligible for the staleness dot.
  expect(TERMINAL_APPLICATION_STATUSES).toEqual(['offer', 'rejected', 'no_response']);
  expect(TERMINAL_APPLICATION_STATUSES).toHaveLength(3);
  for (const s of TERMINAL_APPLICATION_STATUSES) expect(APPLICATION_STATUSES).toContain(s);
});

test('the four connection values exist', () => {
  expect(CONNECTIONS).toEqual(['hiring', 'works_here', 'knows_contact', 'forwarded']);
});

test('a poster sets one of three post statuses', () => {
  expect(POST_STATUSES).toEqual(['open', 'filled', 'unsure']);
});
