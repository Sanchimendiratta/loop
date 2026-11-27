/**
 * The connection field, and the one line it produces (Lite §4 field 7).
 *
 * v1.3 composed this from rung × destination across twenty combinations. Lite
 * drops `destination_type` entirely, so the sentence collapses to the rung
 * alone — four lines, written out. The `forwarded` line stays blunt on purpose:
 * it is what lets a candidate decide in two seconds whether to spend an hour.
 */
import type { Connection } from '../data/schema.ts';

export const CONNECTION_RANK: Record<Connection, number> = {
  hiring: 1,
  works_here: 2,
  knows_contact: 3,
  forwarded: 4,
};

const BADGE: Record<Connection, string> = {
  hiring: "I'm hiring",
  works_here: 'Works here',
  knows_contact: 'Knows the contact',
  forwarded: 'Just passing it on',
};

export function connectionBadge(c: Connection): string {
  return BADGE[c];
}

export function connectionLine(c: Connection, posterName: string, contactName: string | null): string {
  switch (c) {
    case 'hiring':
      return `${posterName} is hiring for this role.`;
    case 'works_here':
      return `${posterName} works here and can refer you.`;
    case 'knows_contact':
      return contactName
        ? `${posterName} doesn't work here but knows ${contactName}, the hiring contact.`
        : `${posterName} doesn't work here but knows the hiring contact.`;
    case 'forwarded':
      return `${posterName} has no connection — this is a cold application.`;
  }
}
