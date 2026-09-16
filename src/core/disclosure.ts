/**
 * The two disclosure fields, and the sentence they combine into (D13).
 *
 * §5.1 calls the *Forwarded · External recruiter* line the single most useful
 * sentence on the platform: it lets a candidate decide in two seconds whether
 * to spend an hour, and it is exactly what a WhatsApp forward destroys. So it
 * is composed here, once, and no card writes its own.
 *
 * Composed rather than looked up: the rung supplies what the poster can do, the
 * destination supplies where the CV lands. Twenty hand-written strings would
 * drift the moment one rung's wording changed.
 */
import { RELATIONSHIP_RANK } from '../data/schema.ts';
import type { DestinationType, PosterRelationship } from '../data/schema.ts';

export interface DisclosureContext {
  posterName: string;
  companyName: string | null;
  contactName: string | null;
}

export interface DisclosureInput extends DisclosureContext {
  relationship: PosterRelationship;
  destination: DestinationType;
}

const BADGE_LABEL: Record<PosterRelationship, string> = {
  hiring_manager: 'Hiring manager',
  internal_can_refer: 'Internal · can refer',
  knows_contact: 'Connected · knows the contact',
  forwarded: 'Forwarded',
};

export function relationshipBadge(r: PosterRelationship): { label: string; rank: number } {
  return { label: BADGE_LABEL[r], rank: RELATIONSHIP_RANK[r] };
}

export function destinationLabel(d: DestinationType, ctx: DisclosureContext): string {
  switch (d) {
    case 'company_ats':
      return 'Company application';
    case 'external_recruiter':
      return 'External recruiter';
    case 'third_party_platform':
      return 'Third-party platform';
    case 'via_poster':
      return `Through ${ctx.posterName}`;
    case 'named_person': {
      const who = ctx.contactName ?? 'a named contact';
      return ctx.companyName ? `Direct to ${who} at ${ctx.companyName}` : `Direct to ${who}`;
    }
  }
}

/** Where the CV actually lands, as a clause. */
function destinationClause(d: DestinationType, ctx: DisclosureContext): string {
  switch (d) {
    case 'company_ats':
      return 'Your application goes into the company’s own hiring process.';
    case 'external_recruiter':
      return 'Your CV goes to an external search firm, which may retain it for other roles.';
    case 'third_party_platform':
      return 'Your application goes through a third-party jobs platform.';
    case 'via_poster':
      return `${ctx.posterName} will pass your profile on directly.`;
    case 'named_person':
      return ctx.contactName
        ? `Your CV goes straight to ${ctx.contactName}.`
        : 'Your CV goes straight to a named contact at the company.';
  }
}

export function disclosureSentence(input: DisclosureInput): string {
  const { relationship, destination, posterName, contactName } = input;

  // The four rungs the PRD works through by example keep their exact wording;
  // every other pair composes from the same two halves.
  if (relationship === 'hiring_manager') {
    return `${posterName} is hiring for their own team. Applying puts you in front of the decision-maker.`;
  }

  if (relationship === 'internal_can_refer') {
    return destination === 'via_poster'
      ? `${posterName} works here and will submit you as an internal referral.`
      : `${posterName} works here and can refer you. ${destinationClause(destination, input)}`;
  }

  if (relationship === 'knows_contact') {
    const who = contactName ?? 'the hiring contact';
    return destination === 'named_person'
      ? `${posterName} doesn't work here, but knows ${who}, who is hiring. Your CV goes straight to them — and ${posterName} can follow up for you.`
      : `${posterName} doesn't work here, but knows ${who}. ${destinationClause(destination, input)} ${posterName} can follow up for you.`;
  }

  return `${posterName} has no connection to this company. ${destinationClause(destination, input)} Nobody here can push your profile.`;
}
