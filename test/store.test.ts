import { beforeEach, describe, expect, test } from 'vitest';
import * as store from '../src/data/store.ts';
import { RuleViolation } from '../src/data/store.ts';

const NOW = Date.UTC(2026, 8, 16);

beforeEach(() => {
  // A fresh in-memory workspace per test; no localStorage in Node.
  store.reset();
});

describe('rule 1 — the privacy filter (spec §4.1)', () => {
  test('an unverified viewer reads nothing, rather than being redirected (D2)', () => {
    const pending = store.getState().members.find((m) => m.status === 'pending');
    store.setCurrentMember(pending!.id);
    expect(store.listPosts(NOW)).toEqual([]);
  });
});

describe('publishing', () => {
  test('a post without a relationship is refused — the one field a parser cannot fill (D13)', () => {
    const meera = store.getState().members.find((m) => m.name.startsWith('Meera'))!;
    store.setCurrentMember(meera.id);
    expect(() =>
      store.publishPost({
        rawText: 'Head of Ops at Acme. Mail careers@acme.com', title: 'Head of Ops', companyId: null,
        confidentialDescriptor: 'a logistics firm', locations: ['Pune'], expMin: 5, expMax: 8,
        compText: null, function: null, applyMethod: 'email', applyValue: 'careers@acme.com', jdUrl: null,
        posterRelationship: null as never, destinationType: 'company_ats', hiringContactName: null,
        hiringContactValue: null, contactConsentConfirmed: true, parseConfidence: 0.8,
      }),
    ).toThrow(RuleViolation);
  });

  test('a named contact requires the consent tick (D13)', () => {
    const partho = store.getState().members.find((m) => m.name.startsWith('Partho'))!;
    store.setCurrentMember(partho.id);
    expect(() =>
      store.publishPost({
        rawText: 'x', title: 'Strategy', companyId: null, confidentialDescriptor: 'an insurer',
        locations: ['Mumbai'], expMin: 2, expMax: 5, compText: null, function: null,
        applyMethod: 'phone', applyValue: '8800029599', jdUrl: null,
        posterRelationship: 'knows_contact', destinationType: 'named_person',
        hiringContactName: 'Nikita', hiringContactValue: '8800029599',
        contactConsentConfirmed: false, parseConfidence: 0.8,
      }),
    ).toThrow(RuleViolation);
  });

  test('a duplicate post merges into the existing card rather than creating a second', () => {
    const existing = store.getState().posts[4];
    const partho = store.getState().members.find((m) => m.name.startsWith('Partho'))!;
    store.setCurrentMember(partho.id);
    const before = store.getState().posts.length;
    const merged = store.publishPost({
      rawText: 'same role, different forward', title: existing.title, companyId: existing.companyId,
      confidentialDescriptor: null, locations: existing.locations, expMin: null, expMax: null,
      compText: null, function: null, applyMethod: existing.applyMethod, applyValue: existing.applyValue,
      jdUrl: null, posterRelationship: 'forwarded', destinationType: existing.destinationType,
      hiringContactName: null, hiringContactValue: null, contactConsentConfirmed: true, parseConfidence: 0.7,
    });
    expect(merged.id).toBe(existing.id);
    expect(store.getState().posts.length).toBe(before);
  });
});

describe('the clock', () => {
  test('runClock archives a post past day 45', () => {
    const post = store.getState().posts[0];
    store.runClock(post.postedAt + 46 * 86_400_000);
    expect(store.getState().posts.find((p) => p.id === post.id)!.archivedAt).not.toBeNull();
  });
});

describe('the clock, run repeatedly', () => {
  test('a second tick at the same instant changes nothing and notifies nobody', () => {
    const now = store.getState().posts[0].postedAt + 46 * 86_400_000;
    store.runClock(now);
    const snapshot = JSON.stringify(store.getState());

    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications += 1;
    });
    store.runClock(now);
    unsubscribe();

    expect(JSON.stringify(store.getState())).toBe(snapshot);
    expect(notifications).toBe(0);
  });
});

describe('publishing — what is not a merge target', () => {
  test('a filled post is not merged into; the next forward starts a fresh card', () => {
    const existing = store.getState().posts[4];
    store.setCurrentMember(existing.posterId);
    store.confirmPost(existing.id, 'filled');

    const partho = store.getState().members.find((m) => m.name.startsWith('Partho'))!;
    store.setCurrentMember(partho.id);
    const before = store.getState().posts.length;
    const fresh = store.publishPost({
      rawText: 'reposted after it was filled', title: existing.title, companyId: existing.companyId,
      confidentialDescriptor: null, locations: existing.locations, expMin: null, expMax: null,
      compText: null, function: null, applyMethod: existing.applyMethod, applyValue: existing.applyValue,
      jdUrl: null, posterRelationship: 'forwarded', destinationType: existing.destinationType,
      hiringContactName: null, hiringContactValue: null, contactConsentConfirmed: true, parseConfidence: 0.7,
    });

    expect(fresh.id).not.toBe(existing.id);
    expect(store.getState().posts.length).toBe(before + 1);
    expect(store.getState().shares.some((s) => s.jobPostId === existing.id && s.sharerId === partho.id)).toBe(false);
  });
});

describe('member-facing reports (§7.1 Must / §8)', () => {
  test('a member cannot report their own post', () => {
    const post = store.getState().posts[0];
    store.setCurrentMember(post.posterId);
    expect(() => store.reportTarget('post', post.id, 'looks wrong')).toThrow(RuleViolation);
  });

  test('a member cannot report themselves', () => {
    const ananya = store.getState().members.find((m) => m.name.startsWith('Ananya'))!;
    store.setCurrentMember(ananya.id);
    expect(() => store.reportTarget('member', ananya.id, 'testing')).toThrow(RuleViolation);
  });

  test('reporting someone else’s post hides it from the board pending review, but not from an admin', () => {
    const post = store.getState().posts.find((p) => p.archivedAt === null)!;
    const reporter = store.getState().members.find(
      (m) => m.status === 'verified' && m.id !== post.posterId,
    )!;
    store.setCurrentMember(reporter.id);
    store.reportTarget('post', post.id, 'This looks like a scam.');

    expect(store.getPost(post.id)).toBeNull();
    expect(store.listPosts(NOW).some((p) => p.id === post.id)).toBe(false);

    const admin = store.getState().members.find((m) => m.isAdmin)!;
    store.setCurrentMember(admin.id);
    expect(store.getPost(post.id)?.id).toBe(post.id);
    expect(store.listReports().some((r) => r.targetId === post.id)).toBe(true);
  });
});

describe('post visibility is one rule — postsVisibleTo (Fix 1)', () => {
  test('a post with an open report drops out of posterStatsFor’s counts', () => {
    const post = store.getState().posts.find((p) => p.id === 'p_anveshan')!;
    const reporter = store.getState().members.find(
      (m) => m.status === 'verified' && m.id !== post.posterId,
    )!;
    store.setCurrentMember(reporter.id);
    store.reportTarget('post', post.id, 'This looks off.');

    store.setCurrentMember(post.posterId);
    expect(store.posterStatsFor(post.id)).toEqual({
      views: 0,
      applied: 0,
      heardBack: 0,
      interviewing: 0,
      outcomesUnknown: true,
    });
  });

  test('confirmPost on a reported post fails closed rather than succeeding', () => {
    const post = store.getState().posts.find((p) => p.id === 'p_anveshan')!;
    const reporter = store.getState().members.find(
      (m) => m.status === 'verified' && m.id !== post.posterId,
    )!;
    store.setCurrentMember(reporter.id);
    store.reportTarget('post', post.id, 'This looks off.');

    store.setCurrentMember(post.posterId);
    expect(() => store.confirmPost(post.id, 'open')).toThrow(RuleViolation);
  });
});

describe('a suspended member’s posts come down too (Fix 5)', () => {
  test('hidden from a non-admin, still visible to an admin', () => {
    const post = store.getState().posts.find((p) => p.archivedAt === null)!;
    const poster = store.getState().members.find((m) => m.id === post.posterId)!;
    const reporter = store.getState().members.find(
      (m) => m.status === 'verified' && m.id !== poster.id && !m.isAdmin,
    )!;
    const admin = store.getState().members.find((m) => m.isAdmin && m.id !== poster.id)!;

    store.setCurrentMember(reporter.id);
    const report = store.reportTarget('member', poster.id, 'Spamming the board.');

    store.setCurrentMember(admin.id);
    store.upholdReport(report.id);
    expect(store.getState().members.find((m) => m.id === poster.id)!.status).toBe('suspended');

    store.setCurrentMember(reporter.id);
    expect(store.getPost(post.id)).toBeNull();
    expect(store.listPosts(NOW).some((p) => p.id === post.id)).toBe(false);

    store.setCurrentMember(admin.id);
    expect(store.getPost(post.id)?.id).toBe(post.id);
  });
});

describe('recordPostView (Fix 8)', () => {
  test('increments for a non-poster viewer and is a no-op for the poster', () => {
    const post = store.getState().posts.find((p) => p.archivedAt === null)!;
    const before = post.viewCount;

    store.setCurrentMember(post.posterId);
    store.recordPostView(post.id);
    expect(store.getState().posts.find((p) => p.id === post.id)!.viewCount).toBe(before);

    const viewer = store.getState().members.find(
      (m) => m.status === 'verified' && m.id !== post.posterId,
    )!;
    store.setCurrentMember(viewer.id);
    store.recordPostView(post.id);
    expect(store.getState().posts.find((p) => p.id === post.id)!.viewCount).toBe(before + 1);
  });
});

describe('requestContactRemoval is not gated to the poster or an admin (Fix 9)', () => {
  test('any verified, non-poster, non-admin member may request it on the contact’s behalf', () => {
    const post = store.getState().posts.find((p) => p.hiringContactValue !== null && p.archivedAt === null)!;
    const outsider = store.getState().members.find(
      (m) => m.status === 'verified' && !m.isAdmin && m.id !== post.posterId,
    )!;
    store.setCurrentMember(outsider.id);
    expect(() => store.requestContactRemoval(post.id)).not.toThrow();

    const updated = store.getState().posts.find((p) => p.id === post.id)!;
    expect(updated.hiringContactValue).toBeNull();
    expect(updated.contactRemovalRequestedAt).not.toBeNull();
  });
});
