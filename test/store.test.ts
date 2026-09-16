import { beforeEach, describe, expect, test } from 'vitest';
import * as store from '../src/data/store.ts';
import { RuleViolation } from '../src/data/store.ts';
import { buildSeed } from '../src/data/seed.ts';
import { SCHEMA_VERSION } from '../src/data/schema.ts';

const NOW = Date.UTC(2026, 8, 17);

// The seed is built AT `NOW` and every write below is passed `NOW` explicitly,
// so the suite is genuinely time-controlled rather than merely looking it:
// `reset()` with no argument would build the fixtures at `Date.now()` while the
// assertions reasoned about a fixed instant.
beforeEach(() => { store.reset(NOW); });

const asMember = (pred: (m: any) => boolean) => {
  const m = store.getState().members.find(pred)!;
  store.setCurrentMember(m.id);
  return m;
};

/** The thrown rule's code, so a test can tell WHICH refusal it triggered. */
const violationCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(RuleViolation);
    return (e as RuleViolation).code;
  }
  throw new Error('expected a RuleViolation, but nothing was thrown');
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

  test('the remaining gated reads are gated too', () => {
    const st = store.getState();
    const post = st.posts[0];
    asMember((m) => m.status === 'pending');
    expect(store.getPost(post.id)).toBeNull();
    expect(store.applicationFor(post.id)).toBeNull();
    expect(store.posterName(post.posterId)).toBe('');
    expect(store.applyDisclosureFields()).toEqual([]);
  });

  test('a pending member who owns a post still sees none of its applicants', () => {
    // Placed as a fixture, because the seed has no pending poster: without the
    // D2 gate, `applicantsFor` would answer for this member — they ARE the
    // poster, which is the one thing rule 2 lets through.
    const st = store.getState();
    const pending = st.members.find((m) => m.status === 'pending')!;
    const busiest = 'p_foodhak';
    st.posts = st.posts.map((p) => (p.id === busiest ? { ...p, posterId: pending.id } : p));
    store.setCurrentMember(pending.id);
    expect(store.applicantsFor(busiest)).toEqual([]);
    expect(store.myPosts()).toEqual([]);
  });

  test('a pending ADMIN reads nothing — D2 has no admin exception', () => {
    const st = store.getState();
    const pending = st.members.find((m) => m.status === 'pending')!;
    st.members = st.members.map((m) => (m.id === pending.id ? { ...m, isAdmin: true } : m));
    store.setCurrentMember(pending.id);
    expect(store.pendingCases()).toEqual([]);
    expect(store.listReports()).toEqual([]);
    expect(store.listPosts(NOW)).toEqual([]);
  });

  test('a pending member cannot apply', () => {
    const post = store.getState().posts[0];
    asMember((m) => m.status === 'pending');
    expect(() => store.applyToPost(post.id, NOW)).toThrow(RuleViolation);
  });

  test('a verified member reads the board', () => {
    asMember((m) => m.status === 'verified' && !m.isAdmin);
    expect(store.listPosts(NOW).length).toBeGreaterThan(0);
  });

  test('the admin queue is admin-only, even for a verified member', () => {
    asMember((m) => m.status === 'verified' && !m.isAdmin);
    expect(store.pendingCases()).toEqual([]);
    expect(store.listReports()).toEqual([]);
    asMember((m) => m.isAdmin);
    expect(store.pendingCases().length).toBeGreaterThan(0);
    expect(store.listReports().length).toBeGreaterThan(0);
  });
});

describe('rule 2 — applicant details reach exactly one person', () => {
  const busiestPost = () => {
    const st = store.getState();
    const counts = new Map<string, number>();
    for (const a of st.applications) counts.set(a.jobPostId, (counts.get(a.jobPostId) ?? 0) + 1);
    const postId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return st.posts.find((p) => p.id === postId)!;
  };

  test('the poster of a post sees its applicants in full, and correctly', () => {
    const st = store.getState();
    const post = busiestPost();
    store.setCurrentMember(post.posterId);
    const as = store.applicantsFor(post.id);
    expect(as.length).toBeGreaterThanOrEqual(3);

    // Compared against the real records, not `toHaveProperty` — which passes
    // for any object that merely has the key, including one built from the
    // wrong member.
    for (const a of as) {
      const m = st.members.find((x) => x.id === a.memberId)!;
      const app = st.applications.find((x) => x.jobPostId === post.id && x.memberId === a.memberId)!;
      expect(a, a.memberId).toEqual({
        memberId: m.id,
        name: m.name,
        batch: m.batch,
        programme: m.programme,
        linkedinUrl: m.linkedinUrl,
        status: app.status,
        appliedAt: app.appliedAt,
      });
    }

    // Exactly who applied — no more, no fewer.
    expect(new Set(as.map((a) => a.memberId))).toEqual(
      new Set(st.applications.filter((a) => a.jobPostId === post.id).map((a) => a.memberId)),
    );
  });

  test('a member who is not the poster sees no applicants', () => {
    const st = store.getState();
    const post = st.posts[0];
    const other = st.members.find((m) => m.status === 'verified' && m.id !== post.posterId && !m.isAdmin)!;
    store.setCurrentMember(other.id);
    expect(store.applicantsFor(post.id)).toEqual([]);
  });

  test('a fellow applicant on the same post sees no applicants', () => {
    const st = store.getState();
    const post = st.posts.find((p) => p.id === 'p_foodhak')!;
    const fellow = st.applications.find((a) => a.jobPostId === post.id && a.memberId !== post.posterId)!;
    store.setCurrentMember(fellow.memberId);
    expect(store.applicantsFor(post.id)).toEqual([]);
  });

  test('an admin is not a third party to applicants either', () => {
    const st = store.getState();
    const post = st.posts[0];
    asMember((m) => m.isAdmin);
    expect(store.applicantsFor(post.id)).toEqual([]);
  });

  test('applyDisclosureFields names exactly the fields the poster will see', () => {
    asMember((m) => m.status === 'verified' && !m.isAdmin);
    // The exact array, not substrings: the consent line has to be able to
    // quote this, and a silently-added fifth field would be a promise broken
    // without anything failing.
    expect(store.applyDisclosureFields()).toEqual([
      'your name',
      'your batch and programme',
      'your LinkedIn URL',
      'the status you set',
      'when you applied',
    ]);
  });
});

describe('rule 3 — you edit only your own rows', () => {
  test('a member cannot set the status of an application that is not theirs', () => {
    const st = store.getState();
    const someoneElses = st.applications.find((a) => a.memberId !== st.currentMemberId)!;
    // A named verified non-admin who is NOT the owner, chosen from `members`
    // rather than derived from `applications`: deriving the actor from the same
    // array the target came from can resolve back to the owner and make the
    // assertion vacuous.
    const actor = st.members.find(
      (m) => m.status === 'verified' && !m.isAdmin && m.id !== someoneElses.memberId,
    )!;
    expect(actor.id).not.toBe(someoneElses.memberId);
    store.setCurrentMember(actor.id);

    // The code proves it was refused for ownership, not for being unverified.
    expect(violationCode(() => store.setApplicationStatus(someoneElses.id, 'offer', NOW))).toBe('not_yours');
    expect(store.getState().applications.find((a) => a.id === someoneElses.id)!.status).toBe(someoneElses.status);
  });

  test('a member cannot set the status of a post they do not own', () => {
    const st = store.getState();
    const post = st.posts[0];
    const other = st.members.find((m) => m.status === 'verified' && m.id !== post.posterId)!;
    store.setCurrentMember(other.id);
    expect(violationCode(() => store.setPostStatus(post.id, 'filled', NOW))).toBe('not_yours');
  });

  test('a member cannot report their own post', () => {
    const post = store.getState().posts[0];
    store.setCurrentMember(post.posterId);
    expect(violationCode(() => store.reportPost(post.id, 'spam', NOW))).toBe('self_report');
  });

  test('setting a status stamps statusUpdatedAt so staleness resets', () => {
    const st = store.getState();
    const mine = st.applications.find((a) => a.memberId === st.currentMemberId)!;
    const before = mine.statusUpdatedAt;
    store.setApplicationStatus(mine.id, 'in_review', NOW);
    const after = store.getState().applications.find((a) => a.id === mine.id)!;
    expect(after.statusUpdatedAt).toBeGreaterThan(before);
    expect(after.statusUpdatedAt).toBe(NOW);
    expect(after.status).toBe('in_review');
  });
});

describe('applying', () => {
  test('applying twice to one post is refused', () => {
    const me = asMember((m) => m.status === 'verified' && !m.isAdmin);
    const post = store.listPosts(NOW).find((p) => p.posterId !== me.id && !store.applicationFor(p.id))!;
    store.applyToPost(post.id, NOW);
    expect(violationCode(() => store.applyToPost(post.id, NOW))).toBe('already_applied');
  });

  test('you cannot apply to your own post', () => {
    const post = store.getState().posts[0];
    store.setCurrentMember(post.posterId);
    // `self_apply`, not `already_applied` — the poster has no application on
    // this post, so a duplicate guard would not have caught it.
    expect(violationCode(() => store.applyToPost(post.id, NOW))).toBe('self_apply');
    expect(store.applicantsFor(post.id).some((a) => a.memberId === post.posterId)).toBe(false);
  });

  test('applying notifies the poster, and nobody else', () => {
    const me = asMember((m) => m.status === 'verified' && !m.isAdmin);
    const post = store.listPosts(NOW).find((p) => p.posterId !== me.id && !store.applicationFor(p.id))!;
    store.applyToPost(post.id, NOW);
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
    store.setPostStatus(postId, 'filled', NOW);
    const filled = store.getState().notifications.filter((n) => n.kind === 'post_filled');
    for (const m of applicants) expect(filled.some((n) => n.memberId === m), m).toBe(true);
  });
});

describe('verification', () => {
  test('an astra address verifies instantly, without an admin', () => {
    const m = store.submitVerification({
      googleSub: 'g_new', email: 'new.person@astra.xlri.ac.in', name: 'New Person',
      batch: 2025, programme: 'BM', linkedinUrl: 'https://linkedin.com/in/new', knownBy: null,
    }, NOW);
    expect(m.status).toBe('verified');
    expect(m.verifiedBy).toBe('domain');
  });

  test('any other address lands pending', () => {
    const m = store.submitVerification({
      googleSub: 'g_g', email: 'someone@gmail.com', name: 'Someone',
      batch: 2019, programme: 'HRM', linkedinUrl: 'https://linkedin.com/in/someone', knownBy: 'Rohit Mehta',
    }, NOW);
    expect(m.status).toBe('pending');
    expect(m.verifiedBy).toBeNull();
  });

  test('a multi-@ address cannot smuggle the allowlisted domain', () => {
    const m = store.submitVerification({
      googleSub: 'g_x', email: 'attacker@astra.xlri.ac.in@evil.com', name: 'Attacker',
      batch: 2020, programme: 'BM', linkedinUrl: 'https://linkedin.com/in/x', knownBy: null,
    }, NOW);
    expect(m.status).toBe('pending');
  });

  test('an address with no local part does not get instant membership', () => {
    // The domain is allowlisted, but nobody can own `@astra.xlri.ac.in` — it
    // cannot be delivered to. It must wait for a reviewer like any other
    // unproven address.
    const m = store.submitVerification({
      googleSub: 'g_empty', email: '@astra.xlri.ac.in', name: 'No Local Part',
      batch: 2020, programme: 'BM', linkedinUrl: 'https://linkedin.com/in/empty', knownBy: null,
    }, NOW);
    expect(m.status).toBe('pending');
    expect(m.verifiedBy).toBeNull();
  });

  test('approving records the reviewer, the time and the note, and notifies', () => {
    const pending = store.getState().members.find((m) => m.status === 'pending')!;
    const admin = asMember((m) => m.isAdmin);
    const out = store.decideVerification(pending.id, 'verified', 'LinkedIn matches batch records.', NOW);
    expect(out.status).toBe('verified');
    expect(out.verifiedBy).toBe('admin');
    expect(out.decidedById).toBe(admin.id);
    expect(out.decidedAt).toBe(NOW);
    expect(out.decisionNote).toBe('LinkedIn matches batch records.');
    expect(store.getState().notifications.some(
      (n) => n.memberId === pending.id && n.kind === 'you_were_verified')).toBe(true);
  });

  test('a non-admin cannot decide a case', () => {
    const pending = store.getState().members.find((m) => m.status === 'pending')!;
    asMember((m) => m.status === 'verified' && !m.isAdmin);
    expect(violationCode(() => store.decideVerification(pending.id, 'verified', 'x', NOW))).toBe('not_admin');
  });

  test('the decided list carries only cases a reviewer actually ruled on', () => {
    const pending = store.getState().members.find((m) => m.status === 'pending')!;
    const admin = asMember((m) => m.isAdmin);
    store.decideVerification(pending.id, 'rejected', 'No XLRI entry on LinkedIn.', NOW);

    const decided = store.decidedCases();
    // A domain-verified member (e.g. the current admin, or Ananya) was never
    // ruled on by anyone, so it stays off this list despite status: 'verified'.
    expect(decided.some((m) => m.verifiedBy === 'domain')).toBe(false);
    const row = decided.find((m) => m.id === pending.id)!;
    expect(row.status).toBe('rejected');
    expect(row.decidedById).toBe(admin.id);
    expect(row.decisionNote).toBe('No XLRI entry on LinkedIn.');
  });

  test('the decided list is admin-only, even for a verified member', () => {
    asMember((m) => m.status === 'verified' && !m.isAdmin);
    expect(store.decidedCases()).toEqual([]);
  });
});

describe('publishing', () => {
  const draft = {
    title: 'Ops Lead', companyName: 'Acme', isConfidential: false, confidentialDescriptor: null,
    function: 'Operations & Supply Chain', location: 'Pune', isRemote: false,
    expMin: 5, expMax: 8, compText: null, applyMethod: 'email', applyValue: 'careers@acme.com',
    jdUrl: null, note: null, connection: 'works_here', contactName: null, rawPaste: null,
  } as const;

  test('a post without a connection is refused — it is the honesty field', () => {
    asMember((m) => m.status === 'verified' && !m.isAdmin);
    expect(violationCode(() => store.publishPost({ ...draft, connection: null as never }, NOW)))
      .toBe('missing_connection');
  });

  test('a confidential post needs a descriptor', () => {
    asMember((m) => m.status === 'verified' && !m.isAdmin);
    expect(violationCode(() => store.publishPost(
      { ...draft, companyName: null, isConfidential: true, confidentialDescriptor: '', connection: 'forwarded' },
      NOW,
    ))).toBe('missing_descriptor');
  });

  test('any verified member can post — no pre-approval (L3)', () => {
    const me = asMember((m) => m.status === 'verified' && !m.isAdmin);
    const p = store.publishPost({ ...draft }, NOW);
    expect(p.postStatus).toBe('open');
    expect(p.posterId).toBe(me.id);
    expect(p.postedAt).toBe(NOW);
    expect(store.myPosts().some((x) => x.id === p.id)).toBe(true);
  });
});

describe('moderation', () => {
  test('deleting a post is admin-only — not even the poster may do it', () => {
    const post = store.getState().posts[0];
    store.setCurrentMember(post.posterId);
    expect(violationCode(() => store.deletePost(post.id, NOW))).toBe('not_admin');
    expect(store.getState().posts.some((p) => p.id === post.id)).toBe(true);
  });

  test('an admin delete removes the post and resolves its open reports', () => {
    const report = store.getState().reports.find((r) => r.resolvedAt === null)!;
    const postId = report.jobPostId;
    asMember((m) => m.isAdmin);
    expect(store.listReports().some((r) => r.id === report.id)).toBe(true);

    store.deletePost(postId, NOW);

    const after = store.getState();
    expect(after.posts.some((p) => p.id === postId)).toBe(false);
    expect(after.reports.find((r) => r.id === report.id)!.resolvedAt).toBe(NOW);
    // A resolved report leaves the queue.
    expect(store.listReports().some((r) => r.id === report.id)).toBe(false);
  });

  test('reporting a post someone else owns lands in the admin queue', () => {
    const st = store.getState();
    const post = st.posts.find((p) => p.posterId !== st.currentMemberId)!;
    const r = store.reportPost(post.id, 'Role was filled weeks ago.', NOW);
    expect(r.reporterId).toBe(st.currentMemberId);
    expect(r.resolvedAt).toBeNull();
    asMember((m) => m.isAdmin);
    expect(store.listReports().some((x) => x.id === r.id)).toBe(true);
  });
});

describe('the bell', () => {
  test('marking read touches only the viewer’s own unread notifications', () => {
    const before = store.getState().notifications;
    const me = store.getState().currentMemberId;
    const alreadyRead = before.find((n) => n.memberId === me && n.readAt !== null)!;
    const othersBefore = before.filter((n) => n.memberId !== me);
    expect(store.myNotifications().some((n) => n.readAt === null)).toBe(true);
    expect(othersBefore.some((n) => n.readAt === null)).toBe(true);

    store.markNotificationsRead(NOW);

    const after = store.getState().notifications;
    expect(after.filter((n) => n.memberId === me).every((n) => n.readAt !== null)).toBe(true);
    // An already-read item keeps its original timestamp rather than being restamped.
    expect(after.find((n) => n.id === alreadyRead.id)!.readAt).toBe(alreadyRead.readAt);
    // Nobody else's bell is touched.
    for (const n of othersBefore) expect(after.find((x) => x.id === n.id)!.readAt).toBe(n.readAt);
  });

  test('a pending member cannot clear a bell they cannot read', () => {
    asMember((m) => m.status === 'pending');
    store.markNotificationsRead(NOW);
    expect(store.getState().notifications.some((n) => n.readAt === null)).toBe(true);
  });
});

describe('push subscriptions', () => {
  test('an endpoint is stored once per member, and a second endpoint is added', () => {
    const me = asMember((m) => m.status === 'verified' && !m.isAdmin);
    store.savePushSubscription('https://push.example/abc', '{"p256dh":"k1"}', NOW);
    store.savePushSubscription('https://push.example/abc', '{"p256dh":"k1"}', NOW);
    const subs = store.getState().pushSubscriptions;
    expect(subs).toHaveLength(1);
    expect(subs[0].memberId).toBe(me.id);
    expect(subs[0].endpoint).toBe('https://push.example/abc');
    store.savePushSubscription('https://push.example/def', '{"p256dh":"k2"}', NOW);
    expect(store.getState().pushSubscriptions).toHaveLength(2);
  });

  test('a pending member cannot register for push', () => {
    asMember((m) => m.status === 'pending');
    store.savePushSubscription('https://push.example/xyz', '{"p256dh":"k"}', NOW);
    expect(store.getState().pushSubscriptions).toEqual([]);
  });
});

describe('persistence', () => {
  // Vitest has no DOM, so `storage()` returns null and persistence is off by
  // default. These two cases install a stub for the duration, which is the
  // only way to exercise the load path the browser actually takes.
  const withStorage = (fn: (mem: Map<string, string>) => void) => {
    const mem = new Map<string, string>();
    (globalThis as any).localStorage = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => { mem.set(k, String(v)); },
      removeItem: (k: string) => { mem.delete(k); },
      clear: () => mem.clear(),
    };
    try {
      fn(mem);
    } finally {
      delete (globalThis as any).localStorage;
    }
  };

  const KEY = 'loop.lite.v1';

  test('a stored workspace at the current version is loaded, not reseeded', () => {
    withStorage((mem) => {
      mem.set(KEY, JSON.stringify({ ...buildSeed(NOW), currentMemberId: 'm_meera' }));
      expect(store.load({ now: NOW }).currentMemberId).toBe('m_meera');
    });
  });

  test('a schema-version mismatch reseeds rather than half-migrating', () => {
    withStorage((mem) => {
      const stale = { ...buildSeed(NOW), version: SCHEMA_VERSION + 1, currentMemberId: 'm_meera', posts: [] };
      mem.set(KEY, JSON.stringify(stale));

      const loaded = store.load({ now: NOW });

      expect(loaded.version).toBe(SCHEMA_VERSION);
      expect(loaded.currentMemberId).toBe('m_ananya');
      expect(loaded.posts.length).toBeGreaterThan(0);
      // The fresh seed is written back, so the stale payload is gone for good.
      expect(JSON.parse(mem.get(KEY)!).version).toBe(SCHEMA_VERSION);
    });
  });

  test('unreadable storage falls back to a fresh seed rather than throwing', () => {
    withStorage((mem) => {
      mem.set(KEY, 'not json at all');
      expect(store.load({ now: NOW }).members.length).toBeGreaterThan(0);
    });
  });
});
