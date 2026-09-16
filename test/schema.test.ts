import { expect, test } from 'vitest';
import { RELATIONSHIP_RANK, REQUEST_STATES, TERMINAL_REQUEST_STATES } from '../src/data/schema.ts';

test('relationship rungs rank hiring manager highest (D16)', () => {
  expect(RELATIONSHIP_RANK.hiring_manager).toBe(1);
  expect(RELATIONSHIP_RANK.internal_can_refer).toBe(2);
  expect(RELATIONSHIP_RANK.knows_contact).toBe(3);
  expect(RELATIONSHIP_RANK.forwarded).toBe(4);
});

test('every terminal state is a real request state', () => {
  for (const s of TERMINAL_REQUEST_STATES) expect(REQUEST_STATES).toContain(s);
});
