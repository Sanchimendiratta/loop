/**
 * Task 13 fix round 1, finding: the per-viewer keying behind `Bell`'s
 * in-session notifications and permission timing had no test of its own —
 * only a one-off Playwright script, since deleted, ever exercised it. That
 * is the same gap `test/postComposerForm.test.ts` closed for
 * `PostComposer.tsx`: `computeBellTransition` is exported, pure and DOM-free
 * specifically so the bug that was already found once here (see
 * `src/ui/Bell.tsx`'s docblock) can be pinned by calling it directly.
 *
 * The bug: a single shared (non-keyed) baseline cannot distinguish "this
 * viewer just did something" from "this is the first time I've looked at
 * this viewer, and they already had things" — so switching personas (the
 * app has no other way to change viewer mid-session) could replay an
 * existing unread backlog as freshly arrived, and could spuriously retrigger
 * the permission ask from an unrelated count jump.
 */
import { describe, expect, test } from 'vitest';
import { EMPTY_BELL_STATE, computeBellTransition } from '../src/ui/Bell.tsx';
import type { BellNotification } from '../src/ui/Bell.tsx';

const n = (id: string, body = `body-${id}`): BellNotification => ({ id, body });

describe('computeBellTransition — a viewer\'s first sighting', () => {
  test('seeds a baseline and fires nothing, even with an existing unread backlog', () => {
    const backlog = [n('n1'), n('n2')];
    const result = computeBellTransition(EMPTY_BELL_STATE, 'viewer-a', backlog, { applications: 3, posts: 1 });

    expect(result.notificationsToFire).toEqual([]);
    expect(result.shouldRequestPermission).toBe(false);
  });

  test('records the baseline so the transition immediately after does not refire it', () => {
    const seeded = computeBellTransition(EMPTY_BELL_STATE, 'viewer-a', [n('n1')], { applications: 0, posts: 0 });
    const again = computeBellTransition(seeded.state, 'viewer-a', [n('n1')], { applications: 0, posts: 0 });

    expect(again.notificationsToFire).toEqual([]);
    expect(again.shouldRequestPermission).toBe(false);
  });
});

describe('computeBellTransition — a genuine new event for the current viewer', () => {
  test('a new notification id fires', () => {
    const seeded = computeBellTransition(EMPTY_BELL_STATE, 'viewer-a', [n('n1')], { applications: 0, posts: 0 });
    const next = computeBellTransition(seeded.state, 'viewer-a', [n('n1'), n('n2')], { applications: 0, posts: 0 });

    expect(next.notificationsToFire).toEqual([n('n2')]);
  });

  test('a rise in application count requests permission', () => {
    const seeded = computeBellTransition(EMPTY_BELL_STATE, 'viewer-a', [], { applications: 0, posts: 0 });
    const next = computeBellTransition(seeded.state, 'viewer-a', [], { applications: 1, posts: 0 });

    expect(next.shouldRequestPermission).toBe(true);
  });

  test('a rise in post count also requests permission', () => {
    const seeded = computeBellTransition(EMPTY_BELL_STATE, 'viewer-a', [], { applications: 0, posts: 0 });
    const next = computeBellTransition(seeded.state, 'viewer-a', [], { applications: 0, posts: 1 });

    expect(next.shouldRequestPermission).toBe(true);
  });

  test('an unchanged count does not request permission', () => {
    const seeded = computeBellTransition(EMPTY_BELL_STATE, 'viewer-a', [], { applications: 2, posts: 1 });
    const next = computeBellTransition(seeded.state, 'viewer-a', [], { applications: 2, posts: 1 });

    expect(next.shouldRequestPermission).toBe(false);
  });
});

describe('computeBellTransition — the exact regression: switching to another viewer', () => {
  test('a different viewer with a pre-existing unread backlog fires nothing on first sighting', () => {
    // viewer-a has already been seen this session (e.g. the default persona at load).
    const afterA = computeBellTransition(EMPTY_BELL_STATE, 'viewer-a', [n('a1')], { applications: 0, posts: 0 });

    // Switching to viewer-b, who already has two unread notifications and a
    // non-zero application count neither of which happened "just now" — this
    // is the poster-with-a-backlog scenario the bug fired a popup for.
    const firstLookAtB = computeBellTransition(
      afterA.state,
      'viewer-b',
      [n('b1'), n('b2')],
      { applications: 5, posts: 2 },
    );

    expect(firstLookAtB.notificationsToFire).toEqual([]);
    expect(firstLookAtB.shouldRequestPermission).toBe(false);
  });

  test('switching away and back does not re-fire what viewer-b had already been shown', () => {
    const afterA = computeBellTransition(EMPTY_BELL_STATE, 'viewer-a', [n('a1')], { applications: 0, posts: 0 });
    const firstLookAtB = computeBellTransition(afterA.state, 'viewer-b', [n('b1')], { applications: 0, posts: 0 });

    // Back to viewer-a, nothing new for them either.
    const backToA = computeBellTransition(firstLookAtB.state, 'viewer-a', [n('a1')], { applications: 0, posts: 0 });
    expect(backToA.notificationsToFire).toEqual([]);
    expect(backToA.shouldRequestPermission).toBe(false);

    // And back to viewer-b, with the same single notification b1 as before —
    // still not new, and their counts have not moved.
    const backToB = computeBellTransition(backToA.state, 'viewer-b', [n('b1')], { applications: 0, posts: 0 });
    expect(backToB.notificationsToFire).toEqual([]);
    expect(backToB.shouldRequestPermission).toBe(false);
  });

  /**
   * GUARD, not a detector of the cross-viewer bug — mutation-checked by
   * collapsing `computeBellTransition` to a single shared key (the original
   * bug): this test still passed. Under that mutation the intermediate
   * `firstLookAtB` step is already wrong (it incorrectly treats viewer-a's
   * baseline as viewer-b's prior state and fires for `b1`), but this test
   * only asserts on the FINAL step, whose arithmetic happens to come out the
   * same either way for this particular sequence. It stays because it pins
   * real, separate behaviour (a genuine action fires after a viewer has
   * already been seen once) — it just is not the test that would catch this
   * bug coming back. The two tests above it are.
   */
  test('viewer-b acting for real, after being seen once, still fires correctly', () => {
    const afterA = computeBellTransition(EMPTY_BELL_STATE, 'viewer-a', [], { applications: 0, posts: 0 });
    const firstLookAtB = computeBellTransition(afterA.state, 'viewer-b', [n('b1')], { applications: 3, posts: 0 });

    // viewer-b applies to something for real: a new notification arrives for
    // them and their application count rises above THEIR OWN baseline (3).
    const bActs = computeBellTransition(firstLookAtB.state, 'viewer-b', [n('b1'), n('b2')], {
      applications: 4,
      posts: 0,
    });

    expect(bActs.notificationsToFire).toEqual([n('b2')]);
    expect(bActs.shouldRequestPermission).toBe(true);
  });
});
