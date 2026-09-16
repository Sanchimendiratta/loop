import { describe, expect, test } from 'vitest';
import { dedupeHash, normaliseRoute, normaliseTitle, sharerSummary } from '../src/core/dedupe.ts';

describe('normalisation', () => {
  test('an email route ignores case and surrounding space', () => {
    expect(normaliseRoute('  Careers@Anveshan.Farm ')).toBe('careers@anveshan.farm');
  });

  test('a URL ignores scheme, www, trailing slash and tracking params', () => {
    expect(normaliseRoute('https://www.jobs.lever.co/x/1/?utm_source=whatsapp'))
      .toBe(normaliseRoute('http://jobs.lever.co/x/1'));
  });

  test('a phone route keeps digits only and drops the country code', () => {
    expect(normaliseRoute('+91 88000 29599')).toBe('8800029599');
    expect(normaliseRoute('88000-29599')).toBe('8800029599');
  });

  test('a title ignores case, punctuation and filler', () => {
    expect(normaliseTitle('Head of Operations!')).toBe(normaliseTitle('head of operations'));
    expect(normaliseTitle('Sr. Brand Marketing Manager')).toBe(normaliseTitle('Senior Brand Marketing Manager'));
  });
});

describe('dedupe hash (§5.1)', () => {
  test('the same role from two posters collides', () => {
    expect(dedupeHash('careers@anveshan.farm', 'Head of Operations'))
      .toBe(dedupeHash('  CAREERS@ANVESHAN.FARM', 'head of operations!'));
  });

  test('different roles at the same address do not collide', () => {
    expect(dedupeHash('careers@anveshan.farm', 'Head of Operations'))
      .not.toBe(dedupeHash('careers@anveshan.farm', 'Head of Marketing'));
  });

  test('the same role at different addresses does not collide', () => {
    expect(dedupeHash('careers@anveshan.farm', 'Head of Operations'))
      .not.toBe(dedupeHash('jobs@anveshan.farm', 'Head of Operations'));
  });
});

describe('corroboration copy', () => {
  test('one other sharer is named', () => {
    expect(sharerSummary(['Rhea'])).toBe('Also shared by Rhea');
  });

  test('two are both named', () => {
    expect(sharerSummary(['Rhea', 'Karan'])).toBe('Also shared by Rhea and Karan');
  });

  test('more than two are summarised as in §5.1', () => {
    expect(sharerSummary(['Rhea', 'Karan', 'Dev', 'Asha'])).toBe('Also shared by Rhea, Karan +2');
  });

  test('nobody else yields an empty string', () => {
    expect(sharerSummary([])).toBe('');
  });
});
