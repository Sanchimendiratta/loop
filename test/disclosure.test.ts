import { describe, expect, test } from 'vitest';
import { destinationLabel, disclosureSentence, relationshipBadge } from '../src/core/disclosure.ts';
import { RELATIONSHIP_RANK } from '../src/data/schema.ts';

describe('badges (D13 field 1)', () => {
  test('each rung has the PRD label and rank', () => {
    expect(relationshipBadge('hiring_manager')).toEqual({ label: 'Hiring manager', rank: 1 });
    expect(relationshipBadge('internal_can_refer')).toEqual({ label: 'Internal · can refer', rank: 2 });
    expect(relationshipBadge('knows_contact')).toEqual({ label: 'Connected · knows the contact', rank: 3 });
    expect(relationshipBadge('forwarded')).toEqual({ label: 'Forwarded', rank: 4 });
  });

  test('badge ranks agree with the schema', () => {
    for (const r of ['hiring_manager', 'internal_can_refer', 'knows_contact', 'forwarded'] as const) {
      expect(relationshipBadge(r).rank).toBe(RELATIONSHIP_RANK[r]);
    }
  });
});

describe('destination labels (D13 field 2)', () => {
  const ctx = { posterName: 'Partho', companyName: 'FOODHAK', contactName: 'Nikita' };

  test('each destination renders the PRD label', () => {
    expect(destinationLabel('company_ats', ctx)).toBe('Company application');
    expect(destinationLabel('named_person', ctx)).toBe('Direct to Nikita at FOODHAK');
    expect(destinationLabel('external_recruiter', ctx)).toBe('External recruiter');
    expect(destinationLabel('third_party_platform', ctx)).toBe('Third-party platform');
    expect(destinationLabel('via_poster', ctx)).toBe('Through Partho');
  });

  test('a named route degrades gracefully when the contact is unnamed', () => {
    expect(destinationLabel('named_person', { ...ctx, contactName: null })).toBe('Direct to a named contact at FOODHAK');
  });

  test('a named route degrades gracefully when the company is withheld', () => {
    expect(destinationLabel('named_person', { ...ctx, companyName: null })).toBe('Direct to Nikita');
  });
});

describe('the combined sentence — §5.1 worked examples, verbatim', () => {
  test('hiring manager, direct', () => {
    expect(disclosureSentence({
      relationship: 'hiring_manager', destination: 'named_person',
      posterName: 'Meera', companyName: 'Acme', contactName: 'Meera',
    })).toBe('Meera is hiring for their own team. Applying puts you in front of the decision-maker.');
  });

  test('internal, through the poster', () => {
    expect(disclosureSentence({
      relationship: 'internal_can_refer', destination: 'via_poster',
      posterName: 'Karan', companyName: 'Acme', contactName: null,
    })).toBe('Karan works here and will submit you as an internal referral.');
  });

  test('connected, direct to a named contact', () => {
    expect(disclosureSentence({
      relationship: 'knows_contact', destination: 'named_person',
      posterName: 'Partho', companyName: 'Acme', contactName: 'Nikita',
    })).toBe(
      "Partho doesn't work here, but knows Nikita, who is hiring. Your CV goes straight to them — and Partho can follow up for you.",
    );
  });

  test('forwarded, external recruiter — the blunt one', () => {
    expect(disclosureSentence({
      relationship: 'forwarded', destination: 'external_recruiter',
      posterName: 'Partho', companyName: null, contactName: null,
    })).toBe(
      'Partho has no connection to this company. Your CV goes to an external search firm, which may retain it for other roles. Nobody here can push your profile.',
    );
  });
});

describe('every combination produces a sentence', () => {
  test('no rung × destination pair returns empty', () => {
    const rungs = ['hiring_manager', 'internal_can_refer', 'knows_contact', 'forwarded'] as const;
    const dests = ['company_ats', 'named_person', 'external_recruiter', 'third_party_platform', 'via_poster'] as const;
    for (const relationship of rungs) {
      for (const destination of dests) {
        const s = disclosureSentence({ relationship, destination, posterName: 'Asha', companyName: 'Acme', contactName: 'Dev' });
        expect(s.length, `${relationship} × ${destination}`).toBeGreaterThan(20);
        expect(s.endsWith('.'), `${relationship} × ${destination}`).toBe(true);
      }
    }
  });
});
