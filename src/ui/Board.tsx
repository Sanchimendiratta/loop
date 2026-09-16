import { useMemo, useState } from 'react';
import { listPosts } from '../data/store.ts';
import type { JobPost, PosterRelationship } from '../data/schema.ts';
import { relationshipBadge } from '../core/disclosure.ts';
import { freshnessFor } from '../core/freshness.ts';
import type { FreshnessState } from '../core/freshness.ts';
import { Button, EmptyState, Field, Select, Tabs } from './primitives.tsx';
import { PostCard } from './PostCard.tsx';
import { PostComposer } from './PostComposer.tsx';

export interface BoardProps {
  now: number;
  onOpenPost: (postId: string) => void;
}

const ALL = 'all';

const RELATIONSHIPS: PosterRelationship[] = ['hiring_manager', 'internal_can_refer', 'knows_contact', 'forwarded'];

const FRESHNESS_FILTERS: { id: FreshnessState | typeof ALL; label: string }[] = [
  { id: ALL, label: 'Any freshness' },
  { id: 'fresh', label: 'Fresh' },
  { id: 'confirm_due', label: 'Confirm due' },
  { id: 'unconfirmed', label: 'Unconfirmed' },
];

interface ExpBand {
  id: string;
  label: string;
  min: number;
  max: number;
}

const EXP_BANDS: ExpBand[] = [
  { id: '0-2', label: '0–2 yrs', min: 0, max: 2 },
  { id: '3-5', label: '3–5 yrs', min: 3, max: 5 },
  { id: '6-10', label: '6–10 yrs', min: 6, max: 10 },
  { id: '10+', label: '10+ yrs', min: 10, max: Infinity },
];

function inBand(post: JobPost, band: ExpBand): boolean {
  if (post.expMin === null && post.expMax === null) return false;
  const postMin = post.expMin ?? post.expMax ?? 0;
  const postMax = post.expMax ?? post.expMin ?? Infinity;
  return postMin <= band.max && postMax >= band.min;
}

type SortMode = 'default' | 'recent';

/**
 * The job board (§5.1). Default order is `listPosts`'s connection-then-
 * freshness-then-recency ranking (D16) — labelled here as "Connection first
 * (default)" so that ranking is legible rather than mysterious, with "Most
 * recent" offered as the one alternative.
 */
export function Board({ now, onOpenPost }: BoardProps) {
  const posts = listPosts(now);

  const [fn, setFn] = useState<string>(ALL);
  const [location, setLocation] = useState<string>(ALL);
  const [band, setBand] = useState<string>(ALL);
  const [freshness, setFreshness] = useState<FreshnessState | typeof ALL>(ALL);
  const [relationship, setRelationship] = useState<PosterRelationship | typeof ALL>(ALL);
  const [sort, setSort] = useState<SortMode>('default');
  const [composerOpen, setComposerOpen] = useState(false);

  const functions = useMemo(
    () => Array.from(new Set(posts.map((p) => p.function).filter((f): f is string => Boolean(f)))).sort(),
    [posts],
  );
  const locations = useMemo(
    () => Array.from(new Set(posts.flatMap((p) => p.locations))).sort(),
    [posts],
  );

  const filtered = useMemo(() => {
    const bandDef = EXP_BANDS.find((b) => b.id === band) ?? null;
    let list = posts.filter((p) => {
      if (fn !== ALL && p.function !== fn) return false;
      if (location !== ALL && !p.locations.includes(location)) return false;
      if (bandDef && !inBand(p, bandDef)) return false;
      if (freshness !== ALL && freshnessFor(p, now).state !== freshness) return false;
      if (relationship !== ALL && p.posterRelationship !== relationship) return false;
      return true;
    });
    if (sort === 'recent') {
      list = [...list].sort((a, b) => b.postedAt - a.postedAt);
    }
    return list;
  }, [posts, fn, location, band, freshness, relationship, sort, now]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-stone-900/5">
        <Field label="Function">
          <Select value={fn} onChange={(e) => setFn(e.currentTarget.value)} className="w-40">
            <option value={ALL}>All functions</option>
            {functions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Location">
          <Select value={location} onChange={(e) => setLocation(e.currentTarget.value)} className="w-40">
            <option value={ALL}>All locations</option>
            {locations.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Experience">
          <Select value={band} onChange={(e) => setBand(e.currentTarget.value)} className="w-36">
            <option value={ALL}>Any experience</option>
            {EXP_BANDS.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Freshness">
          <Select
            value={freshness}
            onChange={(e) => setFreshness(e.currentTarget.value as FreshnessState | typeof ALL)}
            className="w-36"
          >
            {FRESHNESS_FILTERS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Relationship">
          <Select
            value={relationship}
            onChange={(e) => setRelationship(e.currentTarget.value as PosterRelationship | typeof ALL)}
            className="w-44"
          >
            <option value={ALL}>Any relationship</option>
            {RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>
                {relationshipBadge(r).label}
              </option>
            ))}
          </Select>
        </Field>

        <div className="ml-auto flex items-center gap-3">
          <Tabs
            items={[
              { id: 'default', label: 'Connection first (default)' },
              { id: 'recent', label: 'Most recent' },
            ]}
            active={sort}
            onChange={(id) => setSort(id as SortMode)}
          />
          <Button variant="primary" onClick={() => setComposerOpen(true)}>
            Post a job
          </Button>
        </div>
      </div>

      <PostComposer
        open={composerOpen}
        onClose={() => setComposerOpen(false)}
        onPublished={() => setComposerOpen(false)}
      />

      {filtered.length === 0 ? (
        <EmptyState title="No posts match those filters." />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((post) => (
            <PostCard key={post.id} post={post} now={now} onOpen={onOpenPost} />
          ))}
        </div>
      )}
    </div>
  );
}
