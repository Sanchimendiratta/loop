import { describe, expect, test } from 'vitest';
import { ARCHIVE_DAY, freshnessFor } from '../src/core/freshness.ts';
import { DAY_MS } from '../src/core/time.ts';
import type { JobPost } from '../src/data/schema.ts';

const NOW = Date.UTC(2026, 8, 16);
const post = (over: Partial<JobPost> = {}): JobPost => ({
  id: 'p1', posterId: 'm1', companyId: 'c1', confidentialDescriptor: null, title: 'Head of Ops',
  locations: ['Manesar'], expMin: 10, expMax: 15, compText: null, function: null,
  applyMethod: 'email', applyValue: 'careers@anveshan.farm', jdUrl: null,
  posterRelationship: 'forwarded', destinationType: 'company_ats',
  hiringContactName: null, hiringContactValue: null, contactConsentConfirmed: true,
  contactRemovalRequestedAt: null, rawText: '', parseConfidence: 0.8, dedupeHash: 'h',
  postedAt: NOW, lastConfirmedAt: NOW, confirmState: 'open', archivedAt: null,
  viewCount: 0, unreachableFlags: [], reportedBy: [], ...over,
});

describe('freshness (D14)', () => {
  test('a new post is fresh', () => {
    expect(freshnessFor(post(), NOW).state).toBe('fresh');
  });

  test('day 14 makes a confirmation prompt due', () => {
    const f = freshnessFor(post(), NOW + 14 * DAY_MS);
    expect(f.state).toBe('confirm_due');
    expect(f.promptDue).toBe(true);
  });

  test('day 28 prompts again', () => {
    expect(freshnessFor(post(), NOW + 28 * DAY_MS).promptDue).toBe(true);
  });

  test('confirming resets the clock and clears the prompt', () => {
    const confirmed = post({ lastConfirmedAt: NOW + 14 * DAY_MS });
    const f = freshnessFor(confirmed, NOW + 15 * DAY_MS);
    expect(f.state).toBe('fresh');
    expect(f.promptDue).toBe(false);
  });

  test('past the default life an unconfirmed post reads as unconfirmed', () => {
    const f = freshnessFor(post(), NOW + 31 * DAY_MS);
    expect(f.state).toBe('unconfirmed');
    expect(f.label).toBe('Unconfirmed — last confirmed 31 days ago');
  });

  test('"I don\'t know" is a real answer and does not archive the post', () => {
    const f = freshnessFor(post({ confirmState: 'unknown', lastConfirmedAt: NOW + 14 * DAY_MS }), NOW + 15 * DAY_MS);
    expect(f.shouldArchive).toBe(false);
    expect(f.state).not.toBe('archived');
  });

  test('marking it filled archives it immediately', () => {
    const f = freshnessFor(post({ confirmState: 'filled' }), NOW + DAY_MS);
    expect(f.state).toBe('filled');
    expect(f.shouldArchive).toBe(true);
  });

  test(`day ${ARCHIVE_DAY} auto-archives an unconfirmed post`, () => {
    const f = freshnessFor(post(), NOW + ARCHIVE_DAY * DAY_MS);
    expect(f.shouldArchive).toBe(true);
  });

  test('an already-archived post stays archived', () => {
    expect(freshnessFor(post({ archivedAt: NOW }), NOW + DAY_MS).state).toBe('archived');
  });
});
