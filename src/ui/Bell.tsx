/**
 * The bell (§5, §9). Three events, read once as `myNotifications()`, and one
 * honest line about the thing this build cannot do.
 *
 * `Notification.body` is already computed by `store.notify()` through
 * `core/notifications.ts`'s `notificationBody()` at the moment each event is
 * written — this component reads that stored text rather than recomputing
 * it, the same way `MyApplications.tsx` reads `application.status` rather
 * than re-deriving it. Recomputing here from `n.kind` alone would need the
 * actor name and role title back, and those are not carried on the
 * `Notification` row — only the sentence they already produced is.
 *
 * Permission timing (§5, §9): a prompt on first load trains people to click
 * Block, so nothing here asks until the viewer's own action count — their
 * applications or their posts — has actually gone up once, tracked per
 * viewer id (see `actionCountsByViewer` below — the persona switcher can
 * swap the signed-in member without unmounting this component). A viewer's
 * first render this session only ever records a baseline; the ask fires on
 * the transition after that, wherever they are in the app, because this
 * component is mounted in `Shell` on every authenticated screen.
 *
 * In-session delivery (§9's honest limit): this component fires a native
 * `Notification` for anything that appears in `myNotifications()` after it
 * is already watching. That is genuinely all Web Push can do without a
 * server to hand a subscription to — nothing here pretends a message was
 * delivered while the member was away, because nothing was.
 *
 * `computeBellTransition` below is exported and DOM-free for the same reason
 * `PostComposer.tsx` exports `editField`/`mergeParsedIntoForm`: it is the one
 * piece of this file with a bug already found in it once (a global, non-keyed
 * baseline let switching personas replay an existing backlog as if it had
 * just arrived), and `scripts/smoke.mjs`'s SSR render asserts nothing about
 * behaviour like this — only `test/bell.test.ts`, calling this function
 * directly, does.
 */
import { useEffect, useRef, useState } from 'react';
import {
  getCurrentMember,
  markNotificationsRead,
  myApplications,
  myNotifications,
  myPosts,
  savePushSubscription,
} from '../data/store.ts';
import { unreadCount } from '../core/notifications.ts';
import { daysBetween } from '../core/time.ts';
import { EmptyState, Modal, cx } from './primitives.tsx';

export interface BellProps {
  now: number;
}

/**
 * A syntactically valid uncompressed P-256 public point (0x04 + 64 bytes),
 * base64url-encoded — the shape `PushManager.subscribe` requires for
 * `applicationServerKey`. It is not tied to any real push server, because
 * this build has none; it exists only so the subscribe call below can
 * produce a real, correctly-shaped `PushSubscription` locally. See the
 * module docblock and this task's report for what that subscription can and
 * cannot be used for.
 */
const DEMO_APPLICATION_SERVER_KEY =
  'BAqfSV7e6IgA8UdWFEmUNM2vwuGTwG84ZGUTK2vhF29927BmvrRDdhBnf9xpIfyXb6VSxVZivXOEnoGQpj71VyM';

/** Best-effort only. Nothing downstream of this ever assumes it succeeded. */
async function subscribeForPush(now: number): Promise<void> {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: DEMO_APPLICATION_SERVER_KEY,
      }));
    const keys = subscription.toJSON().keys ?? {};
    savePushSubscription(subscription.endpoint, JSON.stringify(keys), now);
  } catch {
    // No backend to hand this to regardless (§9) — a failed subscribe
    // (unsupported browser, no reachable push service from this
    // environment) is not a regression worth surfacing to the member.
  }
}

/** Only ever called after a successful apply or publish — never on landing. */
async function requestPermissionAndSubscribe(now: number): Promise<void> {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'granted') {
    void subscribeForPush(now);
    return;
  }
  if (Notification.permission !== 'default') return; // already denied — do not ask again
  try {
    const result = await Notification.requestPermission();
    if (result === 'granted') void subscribeForPush(now);
  } catch {
    // A browser or embedder that rejects the call outright leaves the
    // member exactly where they already were: in-app notifications still
    // work regardless of this.
  }
}

function timeLabel(at: number, now: number): string {
  const d = daysBetween(at, now);
  return d === 0 ? 'today' : `${d}d ago`;
}

// ---------------------------------------------------------------------------
// Pure, DOM-free: the per-viewer transition. See test/bell.test.ts.
// ---------------------------------------------------------------------------

/** The only shape the transition needs from a `Notification` row. */
export interface BellNotification {
  id: string;
  body: string;
}

export interface BellActionCounts {
  applications: number;
  posts: number;
}

interface ViewerBellState {
  seenIds: ReadonlySet<string>;
  actionCounts: BellActionCounts;
}

/** Keyed by viewer id. One entry per member this session has looked at through this `Bell` instance. */
export type BellState = ReadonlyMap<string, ViewerBellState>;

export const EMPTY_BELL_STATE: BellState = new Map();

export interface BellTransition {
  state: BellState;
  /** Fire a native `Notification` for each of these — empty on a viewer's first sighting. */
  notificationsToFire: BellNotification[];
  /** True only when THIS viewer's own counts rose since THIS viewer's last-seen state. */
  shouldRequestPermission: boolean;
}

/**
 * The bug this exists to prevent: the persona switcher can hand `Bell` a
 * different `viewerId` without unmounting it. A single shared baseline (one
 * `Set`, one counts object, keyed by nothing) cannot tell "this viewer just
 * did something" apart from "this is the first time I've looked at this
 * viewer, and they already had things" — so switching to a viewer with an
 * existing unread backlog would replay that backlog as freshly arrived, and
 * a viewer whose own counts happen to be higher than whatever the previous
 * viewer's were could spuriously retrigger the permission ask.
 *
 * Keying `state` by `viewerId` fixes both: a viewer's first transition (no
 * entry yet) only ever seeds a baseline — `notificationsToFire` is empty and
 * `shouldRequestPermission` is `false` unconditionally — and every later
 * transition for that SAME viewer compares only against that viewer's own
 * previous entry.
 */
export function computeBellTransition(
  state: BellState,
  viewerId: string,
  notifications: readonly BellNotification[],
  actionCounts: BellActionCounts,
): BellTransition {
  const prior = state.get(viewerId);
  const notificationsToFire: BellNotification[] = [];
  let shouldRequestPermission = false;

  if (prior) {
    for (const n of notifications) {
      if (!prior.seenIds.has(n.id)) notificationsToFire.push(n);
    }
    shouldRequestPermission =
      actionCounts.applications > prior.actionCounts.applications || actionCounts.posts > prior.actionCounts.posts;
  }

  const nextState = new Map(state);
  nextState.set(viewerId, { seenIds: new Set(notifications.map((n) => n.id)), actionCounts });

  return { state: nextState, notificationsToFire, shouldRequestPermission };
}

export function Bell({ now }: BellProps) {
  const [open, setOpen] = useState(false);
  const viewerId = getCurrentMember()?.id ?? null;
  const notifications = myNotifications();
  const unread = unreadCount(notifications);
  const applications = myApplications(now);
  const posts = myPosts();

  const bellState = useRef<BellState>(EMPTY_BELL_STATE);

  // Runs `computeBellTransition` on every change to this viewer's inputs,
  // then acts on its (already-decided) verdict: which notifications should
  // pop, and whether this is the moment to ask for permission. `Bell` itself
  // holds no logic about backlogs, baselines or "first sighting" — that all
  // lives in the pure function above, where it can be tested without a DOM.
  useEffect(() => {
    if (!viewerId) return;
    const { state, notificationsToFire, shouldRequestPermission } = computeBellTransition(
      bellState.current,
      viewerId,
      notifications,
      { applications: applications.length, posts: posts.length },
    );
    bellState.current = state;

    if (notificationsToFire.length > 0 && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      for (const n of notificationsToFire) new Notification('Loop', { body: n.body });
    }
    if (shouldRequestPermission) void requestPermissionAndSubscribe(now);
    // `notifications` is a fresh array every render (`myNotifications()` is
    // not memoised) — its length and newest id are what actually identify a
    // change, so those are what this effect keys on rather than the array
    // itself, which would otherwise fire on every unrelated re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerId, notifications.length, notifications[0]?.id, applications.length, posts.length]);

  function handleOpen(): void {
    setOpen(true);
    markNotificationsRead(now);
  }

  return (
    <div className="relative ml-auto">
      <button
        type="button"
        onClick={handleOpen}
        aria-label={`Notifications, ${unread} unread`}
        className="relative grid size-8 place-items-center rounded-lg text-base text-stone-600 hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -top-0.5 -right-0.5 grid min-w-[1.1rem] place-items-center rounded-full bg-[var(--color-owed)] px-1 text-[10px] font-semibold tabular-nums text-white"
          >
            {unread}
          </span>
        ) : null}
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Notifications" width="max-w-sm">
        <p className="mb-4 rounded-xl bg-stone-50 px-3 py-2.5 text-xs text-stone-600 ring-1 ring-stone-200">
          You'll see these the moment they happen while Loop is open on this device. Getting them when you're away
          needs Loop's hosted version — this build has no server behind it to deliver anything in the background.
        </p>

        {notifications.length === 0 ? (
          <EmptyState
            title="Nothing yet."
            body="You'll see it here the moment someone applies to your post, you're verified, or a role you applied to is marked filled."
          />
        ) : (
          <ul className="flex flex-col gap-1">
            {notifications.map((n) => (
              <li
                key={n.id}
                className={cx('rounded-lg px-3 py-2', n.readAt === null ? 'bg-brand-50' : '')}
              >
                <p className="text-sm text-stone-800">{n.body}</p>
                <p className="mt-0.5 text-xs tabular-nums text-stone-500">{timeLabel(n.at, now)}</p>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
