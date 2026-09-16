/**
 * The three events that generate a bell item (§5).
 *
 * Exactly three, deliberately: someone applied to your post, you were verified,
 * a post you applied to was marked filled. Every one is something that happened
 * to the member rather than something the product wants from them.
 */
import type { Notification, NotificationKind } from '../data/schema.ts';

export function notificationBody(
  kind: NotificationKind,
  ctx: { actorName?: string; roleTitle?: string },
): string {
  const role = ctx.roleTitle ?? 'your post';
  switch (kind) {
    case 'applied_to_your_post':
      return ctx.actorName ? `${ctx.actorName} applied to ${role}.` : `Someone applied to ${role}.`;
    case 'you_were_verified':
      return "You're verified — welcome in.";
    case 'post_filled':
      return `${role} was marked filled.`;
  }
}

export function unreadCount(ns: Notification[]): number {
  return ns.filter((n) => n.readAt === null).length;
}
