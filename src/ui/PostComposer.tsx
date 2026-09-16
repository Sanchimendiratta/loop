import { Modal } from './primitives.tsx';
import type { JobPost } from '../data/schema.ts';

export interface PostComposerProps {
  open: boolean;
  onClose: () => void;
  onPublished: (post: JobPost) => void;
}

/**
 * Placeholder, on purpose.
 *
 * The v1.3 composer was a two-step paste-to-parse form over fields Lite no
 * longer has: a `company` table to match against, a `destination_type` second
 * disclosure field, a contact-consent checkbox, and a `locations` array where
 * Lite stores one `location` string. It also carried a comment describing the
 * `dedupeHash` merge — Lite has no duplicate merge at all (§1 drops it below a
 * few hundred posts, and §7's `job_post` has no such column), so that comment
 * has gone with the rest of the file rather than being left to mislead.
 *
 * Rebuilding it against `PostDraft` is a later task's job; this keeps the
 * route and the props contract intact in the meantime.
 */
export function PostComposer({ open, onClose }: PostComposerProps) {
  if (!open) return null;
  return (
    <Modal open={open} onClose={onClose} title="Post a job">
      <p className="text-sm text-stone-600">
        The paste-to-parse composer is rebuilt in a later task, against the store's
        <code className="mx-1 rounded bg-stone-100 px-1 py-0.5 text-xs">publishPost(draft)</code>
        and Lite's single connection field.
      </p>
    </Modal>
  );
}
