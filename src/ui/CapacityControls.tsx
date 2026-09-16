import { useState } from 'react';
import { getCurrentMember, listRequests, RuleViolation, setCaps } from '../data/store.ts';
import { openRequestsFor, referralsThisMonth } from '../core/capacity.ts';
import type { Member } from '../data/schema.ts';
import { Button, Field, Input, Meter, Textarea } from './primitives.tsx';

type Caps = Member['caps'];

/**
 * The referrer's own intake settings (DL1's only surviving volume control).
 *
 * Everything here edits the VIEWER's own caps — `getCurrentMember()` is used
 * rather than `getMember()` deliberately: `PublicMember` strips `caps`
 * entirely (it is private intake data, not something anyone else may read),
 * and the one exception the whole store makes is that your own full `Member`
 * is always yours.
 *
 * Every hint below is worded as the referrer's own protection, never as a
 * platform restriction — seekers are uncapped everywhere else in the
 * product; this is the one place volume is controlled at all, and it is
 * controlled at the receiving end.
 */
export function CapacityControls() {
  const member = getCurrentMember();
  const [form, setForm] = useState<Caps | null>(member?.caps ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!member || !form) return null;

  const now = Date.now();
  const myRequestsAsReferrer = listRequests().filter((r) => r.referrerId === member.id);
  const openCount = openRequestsFor(member.id, myRequestsAsReferrer).length;
  const monthCount = referralsThisMonth(member.id, myRequestsAsReferrer, now);

  function set<K extends keyof Caps>(key: K, value: Caps[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setSaved(false);
  }

  function handleSave() {
    if (!form) return;
    try {
      setCaps({ ...form });
      setError(null);
      setSaved(true);
    } catch (e) {
      if (e instanceof RuleViolation) {
        setError(e.message);
      } else {
        throw e;
      }
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl bg-white p-4 shadow-sm ring-1 ring-stone-900/5">
      <div>
        <h3 className="text-sm font-semibold text-stone-900">Your capacity</h3>
        <p className="text-xs text-stone-500">
          This is the only volume control on Loop — alumni can ask as many people as they like. What you set here
          protects your own time; it is not a platform limit.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Maximum open requests"
          hint="Once you're holding this many open requests at once, you'll stop receiving new asks until one closes."
        >
          <Input
            type="number"
            min={0}
            value={form.maxOpen}
            onChange={(e) => set('maxOpen', Math.max(0, Number(e.currentTarget.value)))}
          />
          <div className="mt-2">
            <Meter
              value={form.maxOpen > 0 ? (openCount / form.maxOpen) * 100 : 0}
              tone={form.maxOpen > 0 && openCount >= form.maxOpen ? 'stale' : 'ok'}
            />
            <p className="mt-1 text-xs text-stone-500">
              {openCount} of {form.maxOpen} open right now
            </p>
          </div>
        </Field>

        <Field
          label="Maximum per month"
          hint="You'll stop receiving new asks once you've helped this many people in the last 30 days."
        >
          <Input
            type="number"
            min={0}
            value={form.maxPerMonth}
            onChange={(e) => set('maxPerMonth', Math.max(0, Number(e.currentTarget.value)))}
          />
          <div className="mt-2">
            <Meter
              value={form.maxPerMonth > 0 ? (monthCount / form.maxPerMonth) * 100 : 0}
              tone={form.maxPerMonth > 0 && monthCount >= form.maxPerMonth ? 'stale' : 'ok'}
            />
            <p className="mt-1 text-xs text-stone-500">
              {monthCount} of {form.maxPerMonth} in the last 30 days
            </p>
          </div>
        </Field>
      </div>

      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={form.paused}
          onChange={(e) => set('paused', e.currentTarget.checked)}
          className="size-4 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
        />
        Pause — you'll stop receiving new asks entirely, until you turn this back off.
      </label>

      <Field
        label="Message shown to people who ask while you're unavailable"
        hint="A graceful no is better than a silent one."
      >
        <Textarea
          value={form.autoDeclineMessage}
          onChange={(e) => set('autoDeclineMessage', e.currentTarget.value)}
          placeholder="e.g. Swamped this quarter — try me in January."
        />
      </Field>

      {error ? (
        <p className="rounded-lg bg-[var(--color-owed-soft)] px-3 py-2 text-sm font-medium text-[var(--color-owed)]">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={handleSave}>
          Save
        </Button>
        {saved ? <span className="text-xs text-stone-500">Saved.</span> : null}
      </div>
    </div>
  );
}
