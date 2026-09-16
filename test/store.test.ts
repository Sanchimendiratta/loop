import { beforeEach, describe, expect, test } from 'vitest';
import * as store from '../src/data/store.ts';
import { RuleViolation } from '../src/data/store.ts';

const NOW = Date.UTC(2026, 8, 17);
beforeEach(() => { store.reset(); });

const asMember = (pred: (m: any) => boolean) => {
  const m = store.getState().members.find(pred)!;
  store.setCurrentMember(m.id);
  return m;
};

describe('rule 1 — D2: an unverified or pending member reads nothing', () => {
  test('a pending member reads no posts, no applications, no notifications', () => {
    asMember((m) => m.status === 'pending');
    expect(store.listPosts(NOW)).toEqual([]);
    expect(store.myApplications(NOW)).toEqual([]);
    expect(store.myNotifications()).toEqual([]);
    expect(store.myPosts()).toEqual([]);
  });

  test('a rejected member reads nothing either', () => {
    asMember((m) => m.status === 'rejected');
    expect(store.listPosts(NOW)).toEqual([]);
  });

  test('a pending member cannot apply', () => {
    const post = store.getState().posts[0];
    asMember((m) => m.status === 'pending');
    expect(() => store.applyToPost(post.id)).toThrow(RuleViolation);
  });

  test('a verified member reads the board', () => {
    asMember((m) => m.status === 'verified' && !m.isAdmin);
    expect(store.listPosts(NOW).length).toBeGreaterThan(0);
  });

  test('the admin queue is admin-only, even for a verified member', () => {
    asMember((m) => m.status === 'verified' && !m.isAdmin);
    expect(store.pendingCases()).toEqual([]);
    asMember((m) => m.isAdmin);
    expect(store.pendingCases().length).toBeGreaterThan(0);
  });
});

describe('rule 2 — applicant details reach exactly one person', () => {
  test('the poster of a post sees its applicants in full', () => {
    const st = store.getState();
    const counts = new Map<string, number>();
    for (const a of st.applications) counts.set(a.jobPostId, (counts.get(a.jobPostId) ?? 0) + 1);
    const postId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const post = st.posts.find((p) => p.id === postId)!;
    store.setCurrentMember(post.posterId);
    const as = store.applicantsFor(postId);
    expect(as.length).toBeGreaterThanOrEqual(3);
    expect(as[0]).toHaveProperty('linkedinUrl');
    expect(as[0]).toHaveProperty('batch');
  });

  test('a member who is not the poster sees no applicants', () => {
    const st = store.getState();
    const post = st.posts[0];
    const other = st.members.find((m) => m.status === 'verified' && m.id !== post.posterId && !m.isAdmin)!;
    store.setCurrentMember(other.id);
    expect(store.applicantsFor(post.id)).toEqual([]);
  });

  test('an admin is not a third party to applicants either', () => {
    const st = store.getState();
    const post = st.posts[0];
    asMember((m) => m.isAdmin);
    expect(store.applicantsFor(post.id)).toEqual([]);
  });

  test('applyDisclosureFields names every field the poster will see', () => {
    asMember((m) => m.status === 'verified' && !m.isAdmin);
    const fields = store.applyDisclosureFields();
    for (const f of ['name', 'batch', 'programme', 'LinkedIn']) {
      expect(fields.join(' ').toLowerCase()).toContain(f.toLowerCase());
    }
  });
});

describe('rule 3 — you edit only your own rows', () => {
  test('a member cannot set the status of an application that is not theirs', () => {
    const st = store.getState();
    const someoneElses = st.applications.find((a) => a.memberId !== st.currentMemberId)!;
    // Any verified member who is NOT the application's owner. Selecting the
    // actor by a nested find over the same array can resolve back to the
    // target's own member, which would make the assertion vacuous.
    asMember((m) => m.status === 'verified' && m.id !== someoneElses.memberId);
    expect(() => store.setApplicationStatus(someoneElses.id, 'offer')).toThrow(RuleViolation);
  });

  test('a member cannot set the status of a post they do not own', () => {
    const st = store.getState();
    const post = st.posts[0];
    const other = st.members.find((m) => m.status === 'verified' && m.id !== post.posterId)!;
    store.setCurrentMember(other.id);
    expect(() => store.setPostStatus(post.id, 'filled')).toThrow(RuleViolation);
  });

  test('a member cannot report their own post', () => {
    const post = store.getState().posts[0];
    store.setCurrentMember(post.posterId);
    expect(() => store.reportPost(post.id, 'spam')).toThrow(RuleViolation);
  });

  test('setting a status stamps statusUpdatedAt so staleness resets', () => {
    const st = store.getState();
    const mine = st.applications.find((a) => a.memberId === st.currentMemberId)!;
    const before = mine.statusUpdatedAt;
    store.setApplicationStatus(mine.id, 'in_review');
    expect(store.getState().applications.find((a) => a.id === mine.id)!.statusUpdatedAt).toBeGreaterThan(before);
  });
});

describe('applying', () => {
  test('applying twice to one post is refused', () => {
    asMember((m) => m.status === 'verified' && !m.isAdmin);
    const post = store.listPosts(NOW).find((p) => !store.applicationFor(p.id))!;
    store.applyToPost(post.id);
    expect(() => store.applyToPost(post.id)).toThrow(RuleViolation);
  });

  test('applying notifies the poster, and nobody else', () => {
    const me = asMember((m) => m.status === 'verified' && !m.isAdmin);
    const post = store.listPosts(NOW).find((p) => p.posterId !== me.id && !store.applicationFor(p.id))!;
    store.applyToPost(post.id);
    const ns = store.getState().notifications.filter((n) => n.kind === 'applied_to_your_post');
    expect(ns.some((n) => n.memberId === post.posterId)).toBe(true);
    expect(ns.every((n) => n.memberId !== me.id)).toBe(true);
  });

  test('marking a post filled notifies everyone who applied', () => {
    const st = store.getState();
    const counts = new Map<string, number>();
    for (const a of st.applications) counts.set(a.jobPostId, (counts.get(a.jobPostId) ?? 0) + 1);
    const postId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const post = st.posts.find((p) => p.id === postId)!;
    const applicants = st.applications.filter((a) => a.jobPostId === postId).map((a) => a.memberId);
    store.setCurrentMember(post.posterId);
    store.setPostStatus(postId, 'filled');
    const filled = store.getState().notifications.filter((n) => n.kind === 'post_filled');
    for (const m of applicants) expect(filled.some((n) => n.memberId === m), m).toBe(true);
  });
});

describe('verification', () => {
  test('an astra address verifies instantly, without an admin', () => {
    const m = store.submitVerification({
      googleSub: 'g_new', email: 'new.person@astra.xlri.ac.in', name: 'New Person',
      batch: 2025, programme: 'BM', linkedinUrl: 'https://linkedin.com/in/new', knownBy: null,
    });
    expect(m.status).toBe('verified');
    expect(m.verifiedBy).toBe('domain');
  });

  test('any other address lands pending', () => {
    const m = store.submitVerification({
      googleSub: 'g_g', email: 'someone@gmail.com', name: 'Someone',
      batch: 2019, programme: 'HRM', linkedinUrl: 'https://linkedin.com/in/someone', knownBy: 'Rohit Mehta',
    });
    expect(m.status).toBe('pending');
    expect(m.verifiedBy).toBeNull();
  });

  test('a multi-@ address cannot smuggle the allowlisted domain', () => {
    const m = store.submitVerification({
      googleSub: 'g_x', email: 'attacker@astra.xlri.ac.in@evil.com', name: 'Attacker',
      batch: 2020, programme: 'BM', linkedinUrl: 'https://linkedin.com/in/x', knownBy: null,
    });
    expect(m.status).toBe('pending');
  });

  test('approving records the reviewer, the time and the note, and notifies', () => {
    const pending = store.getState().members.find((m) => m.status === 'pending')!;
    const admin = asMember((m) => m.isAdmin);
    const out = store.decideVerification(pending.id, 'verified', 'LinkedIn matches batch records.');
    expect(out.status).toBe('verified');
    expect(out.verifiedBy).toBe('admin');
    expect(out.decidedById).toBe(admin.id);
    expect(out.decisionNote).toBe('LinkedIn matches batch records.');
    expect(store.getState().notifications.some(
      (n) => n.memberId === pending.id && n.kind === 'you_were_verified')).toBe(true);
  });

  test('a non-admin cannot decide a case', () => {
    const pending = store.getState().members.find((m) => m.status === 'pending')!;
    asMember((m) => m.status === 'verified' && !m.isAdmin);
    expect(() => store.decideVerification(pending.id, 'verified', 'x')).toThrow(RuleViolation);
  });
});

describe('publishing', () => {
  test('a post without a connection is refused — it is the honesty field', () => {
    asMember((m) => m.status === 'verified' && !m.isAdmin);
    expect(() => store.publishPost({
      title: 'Ops Lead', companyName: 'Acme', isConfidential: false, confidentialDescriptor: null,
      function: 'Operations & Supply Chain', location: 'Pune', isRemote: false,
      expMin: 5, expMax: 8, compText: null, applyMethod: 'email', applyValue: 'careers@acme.com',
      jdUrl: null, note: null, connection: null as never, contactName: null, rawPaste: null,
    })).toThrow(RuleViolation);
  });

  test('a confidential post needs a descriptor', () => {
    asMember((m) => m.status === 'verified' && !m.isAdmin);
    expect(() => store.publishPost({
      title: 'Ops Lead', companyName: null, isConfidential: true, confidentialDescriptor: '',
      function: 'Operations & Supply Chain', location: 'Pune', isRemote: false,
      expMin: 5, expMax: 8, compText: null, applyMethod: 'email', applyValue: 'careers@acme.com',
      jdUrl: null, note: null, connection: 'forwarded', contactName: null, rawPaste: null,
    })).toThrow(RuleViolation);
  });

  test('any verified member can post — no pre-approval (L3)', () => {
    asMember((m) => m.status === 'verified' && !m.isAdmin);
    const p = store.publishPost({
      title: 'Ops Lead', companyName: 'Acme', isConfidential: false, confidentialDescriptor: null,
      function: 'Operations & Supply Chain', location: 'Pune', isRemote: false,
      expMin: 5, expMax: 8, compText: null, applyMethod: 'email', applyValue: 'careers@acme.com',
      jdUrl: null, note: null, connection: 'works_here', contactName: null, rawPaste: null,
    });
    expect(p.postStatus).toBe('open');
  });
});
