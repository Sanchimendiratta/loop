import { useMemo, useState } from 'react';
import { listPosts, posterName } from '../data/store.ts';
import type { Connection, FunctionArea } from '../data/schema.ts';
import { connectionBadge, connectionLine } from '../core/disclosure.ts';
import { postAge } from '../core/freshness.ts';
import { Button, EmptyState, Field, Select, Tabs, cx } from './primitives.tsx';
import { PostComposer } from './PostComposer.tsx';

export interface BoardProps {
  now: number;
  onOpenPost: (postId: string) => void;
}

const ALL = 'all';

const CONNECTION_FILTERS: Connection[] = ['hiring', 'works_here', 'knows_contact', 'forwarded'];

type SortMode = 'connection' | 'recent';

/**
 * The job board (Lite §6 sheet 3). Reduced from v1.3's card grid to the parts
 * that still typecheck against Lite's schema — a later task rewrites it as the
 * expanding table §6 specifies, with the apply flow and the report link.
 *
 * Ordering is `listPosts`'s, not this component's: connection rung then newest,
 * labelled so the ranking is legible rather than mysterious. Nothing is
 * filtered off the board — a stale post greys and sinks, it never disappears.
 */
export function Board({ now, onOpenPost }: BoardProps) {
  const [sort, setSort] = useState<SortMode>('connection');
  const [fn, setFn] = useState<string>(ALL);
  const [connection, setConnection] = useState<Connection | typeof ALL>(ALL);
  const [composerOpen, setComposerOpen] = useState(false);

  const posts = listPosts(now, sort);

  const functions = useMemo(
    () => Array.from(new Set(posts.map((p) => p.function))).sort() as FunctionArea[],
    [posts],
  );

  const filtered = posts.filter((p) => {
    if (fn !== ALL && p.function !== fn) return false;
    if (connection !== ALL && p.connection !== connection) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-stone-900/5">
        <Field label="Function">
          <Select value={fn} onChange={(e) => setFn(e.currentTarget.value)} className="w-52">
            <option value={ALL}>All functions</option>
            {functions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Connection">
          <Select
            value={connection}
            onChange={(e) => setConnection(e.currentTarget.value as Connection | typeof ALL)}
            className="w-48"
          >
            <option value={ALL}>Any connection</option>
            {CONNECTION_FILTERS.map((c) => (
              <option key={c} value={c}>
                {connectionBadge(c)}
              </option>
            ))}
          </Select>
        </Field>

        <div className="ml-auto flex items-center gap-3">
          <Tabs
            items={[
              { id: 'connection', label: 'Connection first (default)' },
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
          {filtered.map((post) => {
            const age = postAge(post, now);
            const who = posterName(post.posterId);
            return (
              <button
                key={post.id}
                type="button"
                onClick={() => onOpenPost(post.id)}
                className={cx(
                  'flex flex-col gap-1 rounded-xl bg-white p-4 text-left shadow-sm ring-1 ring-stone-900/5',
                  age.stale && 'opacity-60',
                )}
              >
                <h3 className="text-base font-semibold text-stone-900">{post.title}</h3>
                <p className="text-sm text-stone-600">
                  {post.companyName ?? post.confidentialDescriptor ?? 'Company withheld'}
                </p>
                <p className="text-sm text-stone-600">{post.location || 'Location not specified'}</p>
                <p className="text-sm text-stone-500">{connectionLine(post.connection, who, post.contactName)}</p>
                <p className="text-xs text-stone-400">
                  {connectionBadge(post.connection)} · {age.label}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
