import { describe, expect, test } from 'vitest';
import { CONNECTION_RANK, connectionBadge, connectionLine } from '../src/core/disclosure.ts';

describe('connection badges (Lite §4 field 7)', () => {
  test('each value has a badge', () => {
    expect(connectionBadge('hiring')).toBe("I'm hiring");
    expect(connectionBadge('works_here')).toBe('Works here');
    expect(connectionBadge('knows_contact')).toBe('Knows the contact');
    expect(connectionBadge('forwarded')).toBe('Just passing it on');
  });

  test('rank orders hiring first and a cold forward last', () => {
    expect(CONNECTION_RANK.hiring).toBe(1);
    expect(CONNECTION_RANK.works_here).toBe(2);
    expect(CONNECTION_RANK.knows_contact).toBe(3);
    expect(CONNECTION_RANK.forwarded).toBe(4);
  });
});

describe('the one line on every card (Lite §4)', () => {
  test('hiring', () => {
    expect(connectionLine('hiring', 'Meera', null)).toBe('Meera is hiring for this role.');
  });

  test('works here', () => {
    expect(connectionLine('works_here', 'Karan', null)).toBe('Karan works here and can refer you.');
  });

  test('knows the contact, named — the PRD wording', () => {
    expect(connectionLine('knows_contact', 'Partho', 'Nikita')).toBe(
      "Partho doesn't work here but knows Nikita, the hiring contact.",
    );
  });

  test('knows the contact, unnamed', () => {
    expect(connectionLine('knows_contact', 'Partho', null)).toBe(
      "Partho doesn't work here but knows the hiring contact.",
    );
  });

  test('forwarded — the blunt one, kept blunt', () => {
    expect(connectionLine('forwarded', 'Partho', null)).toBe(
      'Partho has no connection — this is a cold application.',
    );
  });

  test('every value yields a sentence ending in a full stop', () => {
    for (const c of ['hiring', 'works_here', 'knows_contact', 'forwarded'] as const) {
      const s = connectionLine(c, 'Asha', 'Dev');
      expect(s.length, c).toBeGreaterThan(15);
      expect(s.endsWith('.'), c).toBe(true);
    }
  });
});
