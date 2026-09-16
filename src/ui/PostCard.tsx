import { getMember, listCompanies, posterStatsFor, sharersFor } from '../data/store.ts';
import type { JobPost } from '../data/schema.ts';
import { disclosureSentence, relationshipBadge } from '../core/disclosure.ts';
import { freshnessFor } from '../core/freshness.ts';
import { sharerSummary } from '../core/dedupe.ts';
import { Avatar, Button, Card, Chip } from './primitives.tsx';

export interface PostCardProps {
  post: JobPost;
  now: number;
  onOpen: (postId: string) => void;
}

function expLabel(min: number | null, max: number | null): string | null {
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return min === max ? `${min} yrs` : `${min}–${max} yrs`;
  if (min !== null) return `${min}+ yrs`;
  return `Up to ${max} yrs`;
}

/**
 * The standard job card (§5.1): every post — however messy its source
 * message was — renders through this one layout, so a candidate can tell in
 * seconds whether the role is still open, who the poster is to it, and where
 * their CV actually lands.
 */
export function PostCard({ post, now, onOpen }: PostCardProps) {
  const company = post.companyId ? (listCompanies().find((c) => c.id === post.companyId) ?? null) : null;
  const poster = getMember(post.posterId);
  const posterName = poster?.name ?? 'A member';
  const badge = relationshipBadge(post.posterRelationship);

  // D13: composed once, here, from the shared module — never written locally.
  const sentence = disclosureSentence({
    posterName,
    companyName: company?.name ?? null,
    contactName: post.hiringContactName,
    relationship: post.posterRelationship,
    destination: post.destinationType,
  });

  const fresh = freshnessFor(post, now);
  const sharers = sharerSummary(sharersFor(post.id));
  const stats = posterStatsFor(post.id);
  const statsText = stats.outcomesUnknown
    ? `${stats.applied} applied · outcomes unknown`
    : `${stats.applied} alumni applied · ${stats.heardBack} heard back · ${stats.interviewing} interviewing`;

  const exp = expLabel(post.expMin, post.expMax);
  const locations = post.locations.join(', ');

  return (
    <Card className="flex flex-col gap-3 p-4">
      {/* 1. Role + company, or an explicit "withheld" — never a silent gap. */}
      <div>
        <h3 className="text-base font-semibold text-stone-900">{post.title}</h3>
        {company ? (
          <p className="text-sm text-stone-600">{company.name}</p>
        ) : (
          <p className="text-sm text-stone-600">
            {post.confidentialDescriptor ?? 'Details withheld'}
            <span className="text-stone-500"> — Company withheld by the poster</span>
          </p>
        )}
      </div>

      {/* 2. Location, experience band, compensation. */}
      {locations || exp || post.compText ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
          {locations ? <span>{locations}</span> : null}
          {exp ? <span>{exp}</span> : null}
          {post.compText ? <span>{post.compText}</span> : null}
        </div>
      ) : null}

      {/* 3. Poster and their relationship rung. */}
      <div className="flex items-center gap-2">
        <Avatar name={posterName} size={24} />
        <span className="text-sm text-stone-700">{posterName}</span>
        <Chip tone="neutral">{badge.label}</Chip>
      </div>

      {/* 4. The disclosure sentence — the single most useful sentence on the
          platform. Full prominence: no muted grey, no smaller type, no
          toggle. */}
      <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm font-semibold leading-snug text-stone-900 ring-1 ring-stone-200">
        {sentence}
      </p>

      {/* 5. Freshness, plus the D14 "poster couldn't confirm" case — an
          unknown answer must never read like a confirmed-open post. */}
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={fresh.state !== 'fresh' ? 'stale' : 'neutral'}>{fresh.label}</Chip>
        {post.confirmState === 'unknown' ? <Chip tone="stale">Poster couldn't confirm</Chip> : null}
      </div>

      {/* 6. Corroboration from other sharers, when there is any. */}
      {sharers ? <p className="text-xs text-stone-500">{sharers}</p> : null}

      {/* 7. Outcome stats — honest absence over a fabricated zero. */}
      <p className="text-xs text-stone-500">{statsText}</p>

      {/* 8. One primary CTA, and nothing else. */}
      <div className="mt-1">
        <Button variant="primary" onClick={() => onOpen(post.id)}>
          View details
        </Button>
      </div>
    </Card>
  );
}
