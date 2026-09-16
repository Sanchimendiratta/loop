import { Card } from './primitives.tsx';

/**
 * Placeholder, on purpose.
 *
 * The v1.3 admin screen was built on `VerificationCase` — a table Lite folds
 * into `member` (§7: a separate case row only earns its keep once appeals
 * exist, and Lite has no appeals). Its queue, its SLA meter and its
 * appeal-vs-original diff all typed against that table, so none of it survives
 * the schema change; rewriting it here would be writing a screen a later task
 * owns, against a read surface (`pendingCases`, `listReports`,
 * `decideVerification`, `deletePost`) that only just landed.
 *
 * Reduced the same way `Board.tsx` was in the previous task: a heading and a
 * note, so the tree builds and the route stays reachable.
 */
export function Admin(_props: { now?: number }) {
  return (
    <div className="p-6">
      <Card className="max-w-xl p-6">
        <h1 className="text-base font-semibold text-stone-900">Admin</h1>
        <p className="mt-2 text-sm text-stone-600">
          The verification queue and the report list are rebuilt in a later task, against the store's new
          <code className="mx-1 rounded bg-stone-100 px-1 py-0.5 text-xs">pendingCases()</code>
          and
          <code className="mx-1 rounded bg-stone-100 px-1 py-0.5 text-xs">listReports()</code>
          reads.
        </p>
      </Card>
    </div>
  );
}
