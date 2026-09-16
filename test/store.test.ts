import { beforeEach, describe, expect, test } from 'vitest';
import * as store from '../src/data/store.ts';
import { RuleViolation } from '../src/core/requests.ts';

const NOW = Date.UTC(2026, 8, 16);

beforeEach(() => {
  // A fresh in-memory workspace per test; no localStorage in Node.
  store.reset();
});

describe('rule 1 — the privacy filter (spec §4.1)', () => {
  test('an unverified viewer reads nothing, rather than being redirected', () => {
    const pending = store.listMembers().find((m) => m.status === 'pending');
    store.setCurrentMember(pending!.id);
    expect(store.listMembers()).toEqual([]);
    expect(store.listPosts(NOW)).toEqual([]);
    expect(store.listRequests()).toEqual([]);
  });

  test('a verified member reads only their own requests', () => {
    const ananya = store.listMembers().find((m) => m.name.startsWith('Ananya'))!;
    store.setCurrentMember(ananya.id);
    for (const r of store.listRequests()) {
      expect(r.seekerId === ananya.id || r.referrerId === ananya.id).toBe(true);
    }
  });

  test('a member who blocked a company is invisible to that company’s employees', () => {
    const karan = store.listMembers().find((m) => m.name.startsWith('Karan'))!;
    const blockedCompany = karan.privacy.blockedCompanyIds[0];
    const employee = store.listMembers().find((m) => m.companyId === blockedCompany && m.id !== karan.id)!;
    store.setCurrentMember(employee.id);
    expect(store.listMembers().some((m) => m.id === karan.id)).toBe(false);
  });
});

describe('rule 2 — the duplicate-submission guard (spec DL1)', () => {
  test('a seeker may hold many open requests at one company', () => {
    const ananya = store.listMembers().find((m) => m.name.startsWith('Ananya'))!;
    store.setCurrentMember(ananya.id);
    const company = store.listCompanies()[0];
    const referrers = store.alumniAt(company.id).filter((m) => m.id !== ananya.id && m.openToReferring).slice(0, 3);
    expect(referrers.length).toBeGreaterThanOrEqual(2);
    for (const r of referrers) {
      expect(() =>
        store.sendRequest({ referrerId: r.id, companyId: company.id, roleTitle: 'Analyst', pitch: 'hi', roleUrl: null, jobPostId: null }),
      ).not.toThrow();
    }
  });

  test('a second submission of the same seeker to the same role is refused', () => {
    const submitted = store.getState().requests.find((r) => r.state === 'submitted')!;
    store.setCurrentMember(submitted.seekerId);
    const other = store.alumniAt(submitted.companyId).find((m) => m.id !== submitted.referrerId && m.openToReferring)!;
    const dupe = store.sendRequest({
      referrerId: other.id, companyId: submitted.companyId, roleTitle: submitted.roleTitle,
      pitch: 'again', roleUrl: null, jobPostId: null,
    });
    store.setCurrentMember(other.id);
    store.advanceRequest(dupe.id, 'accepted');
    expect(() => store.advanceRequest(dupe.id, 'submitted')).toThrow(RuleViolation);
  });
});

describe('rule 3 — referrer capacity', () => {
  test('a paused referrer refuses a new request', () => {
    const referrer = store.getState().members.find((m) => m.openToReferring)!;
    store.setCurrentMember(referrer.id);
    store.setCaps({ ...referrer.caps, paused: true });
    const seeker = store.getState().members.find((m) => m.name.startsWith('Ananya'))!;
    store.setCurrentMember(seeker.id);
    expect(() =>
      store.sendRequest({ referrerId: referrer.id, companyId: referrer.companyId!, roleTitle: 'X', pitch: 'p', roleUrl: null, jobPostId: null }),
    ).toThrow(RuleViolation);
  });
});

describe('rule 4 — state transitions', () => {
  test('a referrer cannot submit a request they never accepted', () => {
    const sent = store.getState().requests.find((r) => r.state === 'sent')!;
    store.setCurrentMember(sent.referrerId);
    expect(() => store.advanceRequest(sent.id, 'submitted')).toThrow(RuleViolation);
  });

  test('a seeker cannot accept on the referrer’s behalf', () => {
    const sent = store.getState().requests.find((r) => r.state === 'sent')!;
    store.setCurrentMember(sent.seekerId);
    expect(() => store.advanceRequest(sent.id, 'accepted')).toThrow(RuleViolation);
  });

  test('every advance appends an event', () => {
    const sent = store.getState().requests.find((r) => r.state === 'sent')!;
    const before = store.requestEventsFor(sent.id).length;
    store.setCurrentMember(sent.referrerId);
    store.advanceRequest(sent.id, 'accepted');
    expect(store.requestEventsFor(sent.id).length).toBe(before + 1);
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

describe('the tracker (spec §10)', () => {
  test('rows the viewer owes are marked "you" and sort first', () => {
    const seeker = store.getState().requests.find((r) => r.stateOwner === 'seeker')!;
    store.setCurrentMember(seeker.seekerId);
    const rows = store.trackerFor(seeker.seekerId, NOW);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].owed).toBe('you');
  });

  test('every row owed by the viewer carries exactly one CTA (§5.2)', () => {
    const member = store.getState().requests[0].seekerId;
    store.setCurrentMember(member);
    for (const row of store.trackerFor(member, NOW)) {
      if (row.owed === 'you') expect(row.cta).not.toBeNull();
      else expect(row.cta).toBeNull();
    }
  });

  test('the tracker never leaks a request the viewer is not party to', () => {
    const ananya = store.getState().members.find((m) => m.name.startsWith('Ananya'))!;
    store.setCurrentMember(ananya.id);
    const ids = store.trackerFor(ananya.id, NOW).filter((r) => r.kind === 'request').map((r) => r.id);
    for (const id of ids) {
      const req = store.getState().requests.find((r) => r.id === id)!;
      expect(req.seekerId === ananya.id || req.referrerId === ananya.id).toBe(true);
    }
  });
});

describe('the clock', () => {
  test('runClock expires a request the referrer never answered', () => {
    const sent = store.getState().requests.find((r) => r.state === 'sent')!;
    store.runClock(sent.updatedAt + 8 * 86_400_000);
    expect(store.getState().requests.find((r) => r.id === sent.id)!.state).toBe('expired');
  });

  test('runClock archives a post past day 45', () => {
    const post = store.getState().posts[0];
    store.runClock(post.postedAt + 46 * 86_400_000);
    expect(store.getState().posts.find((p) => p.id === post.id)!.archivedAt).not.toBeNull();
  });
});

describe('the WhatsApp digest (D17)', () => {
  test('it is one line per new post, each with a link', () => {
    const admin = store.getState().members.find((m) => m.isAdmin)!;
    store.setCurrentMember(admin.id);
    const digest = store.whatsappDigest(NOW);
    for (const line of digest.split('\n').filter(Boolean).slice(1)) {
      expect(line).toContain('/post/');
    }
  });
});
