import { describe, expect, test } from 'vitest';
import { notificationBody, unreadCount } from '../src/core/notifications.ts';
import type { Notification } from '../src/data/schema.ts';

const n = (over: Partial<Notification> = {}): Notification => ({
  id: 'n1', memberId: 'm1', kind: 'you_were_verified', body: '', link: '/',
  readAt: null, pushedAt: null, emailedAt: null, at: 0, ...over,
});

describe('the three events (§5)', () => {
  test('someone applied to your post names them and the role', () => {
    expect(notificationBody('applied_to_your_post', { actorName: 'Ananya', roleTitle: 'Head of Ops' }))
      .toBe('Ananya applied to Head of Ops.');
  });

  test('you were verified', () => {
    expect(notificationBody('you_were_verified', {})).toBe("You're verified — welcome in.");
  });

  test('a post you applied to was filled', () => {
    expect(notificationBody('post_filled', { roleTitle: 'Head of Ops' }))
      .toBe('Head of Ops was marked filled.');
  });

  test('a missing name degrades rather than printing undefined', () => {
    const b = notificationBody('applied_to_your_post', { roleTitle: 'Head of Ops' });
    expect(b).not.toMatch(/undefined/);
    expect(b).toContain('Head of Ops');
  });
});

describe('unread count', () => {
  test('counts only unread', () => {
    expect(unreadCount([n({ id: 'a' }), n({ id: 'b', readAt: 5 }), n({ id: 'c' })])).toBe(2);
  });

  test('zero for an empty list', () => {
    expect(unreadCount([])).toBe(0);
  });
});
