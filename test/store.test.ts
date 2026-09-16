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
    // Setup only, and it has to come from the raw workspace now: `privacy` no
    // longer rides along on a member read (see the PublicMember test below),
    // which is the point. The assertion below is unchanged.
    const karan = store.getState().members.find((m) => m.name.startsWith('Karan'))!;
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

describe('field scoping — a row the viewer may see still withholds fields (D6)', () => {
  test('a member read carries no blocked list, no googleSub, no caps and no third-party email', () => {
    const karanRaw = store.getState().members.find((m) => m.name.startsWith('Karan'))!;
    const ananya = store.getState().members.find((m) => m.name.startsWith('Ananya'))!;
    store.setCurrentMember(ananya.id);

    const karan = store.listMembers().find((m) => m.id === karanRaw.id)!;
    expect(karan).toBeDefined();
    // Reading who a seeker hides from discloses that they are searching.
    expect('privacy' in karan).toBe(false);
    expect('googleSub' in karan).toBe(false);
    expect('caps' in karan).toBe(false);
    expect(karan.email).toBeNull();
    expect(JSON.stringify(karan)).not.toContain(karanRaw.email);
    expect(JSON.stringify(karan)).not.toContain(karanRaw.googleSub);

    // The same holds for the single-member read and the referrer picker.
    expect('privacy' in store.getMember(karanRaw.id)!).toBe(false);
    for (const m of store.alumniAt('c_foodhak')) expect('privacy' in m).toBe(false);

    // Your own record still gives you your own address — it is yours.
    expect(store.getMember(ananya.id)!.email).toBe(ananya.email);
    expect(store.getCurrentMember()!.privacy.confidentialSearch).toBe(true);
  });
});

describe('the store’s own authority rules', () => {
  test('a third party cannot move someone else’s request — not even an admin', () => {
    const sent = store.getState().requests.find((r) => r.state === 'sent')!;

    const admin = store.getState().members.find((m) => m.isAdmin)!;
    store.setCurrentMember(admin.id);
    // An admin may READ a request (§4.1) but never drive one.
    expect(store.getRequest(sent.id)).not.toBeNull();
    expect(() => store.advanceRequest(sent.id, 'accepted')).toThrow(RuleViolation);

    const stranger = store.getState().members.find(
      (m) => m.status === 'verified' && !m.isAdmin && m.id !== sent.seekerId && m.id !== sent.referrerId,
    )!;
    store.setCurrentMember(stranger.id);
    expect(() => store.advanceRequest(sent.id, 'accepted')).toThrow(RuleViolation);

    expect(store.getState().requests.find((r) => r.id === sent.id)!.state).toBe('sent');
  });

  test('the verification queue is admin-only, and is not sourced through member visibility', () => {
    const ananya = store.getState().members.find((m) => m.name.startsWith('Ananya'))!;
    const admin = store.getState().members.find((m) => m.isAdmin)!;
    const karan = store.getState().members.find((m) => m.name.startsWith('Karan'))!;

    store.setCurrentMember(ananya.id);
    expect(store.listCases()).toEqual([]);

    // Karan blocks the admin outright. His profile must refuse to render...
    store.setCurrentMember(karan.id);
    store.setPrivacy({ ...karan.privacy, blockedMemberIds: [admin.id] });
    store.setCurrentMember(admin.id);
    expect(store.getMember(karan.id)).toBeNull();

    // ...and his case must still be reviewable: he submitted the evidence
    // himself, so it carries its own consent.
    const cases = store.listCases();
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.some((c) => c.decision === 'pending')).toBe(true);
    expect(cases.some((c) => c.memberId === karan.id)).toBe(true);
  });

  test('the tracker refuses to render anyone else’s — including for an admin', () => {
    const ananya = store.getState().members.find((m) => m.name.startsWith('Ananya'))!;
    store.setCurrentMember(ananya.id);
    expect(store.trackerFor(ananya.id, NOW).length).toBeGreaterThan(0);

    const admin = store.getState().members.find((m) => m.isAdmin)!;
    store.setCurrentMember(admin.id);
    expect(store.trackerFor(ananya.id, NOW)).toEqual([]);
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

  test('a nudge is at most one per day, and leaves a trace on the timeline', () => {
    const req = store.getState().requests.find((r) => r.id === 'req_d_submitted_overdue')!;
    const nudgesOf = (id: string) => store.getState().requests.find((r) => r.id === id)!.nudgeCount;
    const eventsOf = (id: string) => store.getState().requestEvents.filter((e) => e.requestId === id).length;
    const before = eventsOf(req.id);

    // 46 days into `submitted`, this request is past ALL THREE of its schedule
    // thresholds (14/30/45). Without the daily guard it catches the whole
    // sequence up in three successive minute-ticks instead of over a month.
    const now = req.updatedAt + 46 * 86_400_000;

    store.runClock(now);
    expect(nudgesOf(req.id)).toBe(1);
    // The nudge is on the timeline, so the eventual auto-advance is not a
    // history jumping from `submitted` straight to `no_response`.
    expect(eventsOf(req.id)).toBe(before + 1);

    store.runClock(now + 60_000);
    store.runClock(now + 120_000);
    expect(nudgesOf(req.id)).toBe(1);
    expect(eventsOf(req.id)).toBe(before + 1);

    // A day later the next one lands, and the request has not been advanced
    // out from under its owner in the meantime.
    store.runClock(now + 86_400_000);
    expect(nudgesOf(req.id)).toBe(2);
    expect(store.getState().requests.find((r) => r.id === req.id)!.state).toBe('submitted');
  });
});

describe('the appeal path (§6)', () => {
  test('a rejected member can appeal despite failing canSeeNetwork', () => {
    const rejected = store.getState().members.find((m) => m.status === 'rejected')!;
    store.setCurrentMember(rejected.id);
    // The normal viewer gate refuses this member everything else in the store.
    expect(store.listPosts(NOW)).toEqual([]);

    const appeal = store.submitAppeal({
      linkedinUrl: rejected.linkedinUrl ?? '',
      batch: rejected.batch,
      programme: rejected.programme,
      nameAtGraduation: rejected.name,
    });

    expect(appeal.isAppeal).toBe(true);
    expect(appeal.decision).toBe('pending');
    expect(store.getState().members.find((m) => m.id === rejected.id)!.status).toBe('pending');
  });

  test('the one appeal §6 allows cannot be brought twice', () => {
    const rejected = store.getState().members.find((m) => m.status === 'rejected')!;
    store.setCurrentMember(rejected.id);
    const evidence = {
      linkedinUrl: rejected.linkedinUrl ?? '',
      batch: rejected.batch,
      programme: rejected.programme,
      nameAtGraduation: rejected.name,
    };
    store.submitAppeal(evidence);
    // The member's own latest case is now the appeal itself — still pending,
    // not rejected — so a second call has nothing eligible to appeal.
    expect(() => store.submitAppeal(evidence)).toThrow(RuleViolation);
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

describe('the profile (Task 24, §7.4)', () => {
  test('setProfile edits only the viewer’s own record', () => {
    const ananya = store.getState().members.find((m) => m.name.startsWith('Ananya'))!;
    const karan = store.getState().members.find((m) => m.name.startsWith('Karan'))!;
    store.setCurrentMember(ananya.id);

    const updated = store.setProfile({
      name: ananya.name,
      batch: ananya.batch,
      programme: ananya.programme,
      companyId: ananya.companyId,
      title: 'New Title',
      function: 'Strategy',
      location: 'Remote',
      linkedinUrl: 'https://linkedin.com/in/example',
      openToReferring: !ananya.openToReferring,
    });

    expect(updated.title).toBe('New Title');
    expect(store.getState().members.find((m) => m.id === karan.id)!.title).toBe(karan.title);
  });

  test('setProfile refuses an empty name', () => {
    const ananya = store.getState().members.find((m) => m.name.startsWith('Ananya'))!;
    store.setCurrentMember(ananya.id);
    expect(() =>
      store.setProfile({
        name: '   ',
        batch: ananya.batch,
        programme: ananya.programme,
        companyId: ananya.companyId,
        title: null,
        function: null,
        location: null,
        linkedinUrl: null,
        openToReferring: false,
      }),
    ).toThrow(RuleViolation);
  });

  test('uploadResume stores a filename only and points the member at it; myResume is viewer-scoped', () => {
    const ananya = store.getState().members.find((m) => m.name.startsWith('Ananya'))!;
    const karan = store.getState().members.find((m) => m.name.startsWith('Karan'))!;

    store.setCurrentMember(karan.id);
    expect(store.myResume()).toBeNull();

    const resume = store.uploadResume('Karan_Shah_Resume.pdf');
    expect(resume.filename).toBe('Karan_Shah_Resume.pdf');
    expect(store.myResume()?.id).toBe(resume.id);
    expect(store.getState().members.find((m) => m.id === karan.id)!.resumeVersionId).toBe(resume.id);

    // Someone else's resume pointer is untouched, and `myResume` never
    // answers for anyone but the current viewer.
    store.setCurrentMember(ananya.id);
    expect(store.myResume()?.filename).not.toBe('Karan_Shah_Resume.pdf');
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
