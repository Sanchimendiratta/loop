import { useMemo, useState } from 'react';
import { getCurrentMember, listCompanies, listMembers, referralAvailabilityFor, reportTarget, RuleViolation } from '../data/store.ts';
import { Avatar, Button, Card, Chip, EmptyState, Field, Input, Modal, Select, Textarea } from './primitives.tsx';
import { availabilityMessage } from './RequestComposer.tsx';
import type { ReferralAsk } from './RequestComposer.tsx';

/**
 * §7.1 Must / §8: reporting a member, reachable from their directory row. A
 * member cannot report themselves — the caller below only ever renders this
 * for `!isSelf`, and `reportTarget` in the store refuses a self-report too.
 */
function ReportMemberModal({
  memberId,
  memberName,
  onClose,
}: {
  memberId: string;
  memberName: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function submit() {
    try {
      reportTarget('member', memberId, reason);
      setError(null);
      setDone(true);
    } catch (e) {
      if (e instanceof RuleViolation) {
        setError(e.message);
      } else {
        throw e;
      }
    }
  }

  if (done) {
    return (
      <Modal open onClose={onClose} title="Reported">
        <p className="text-sm text-stone-600">
          Thanks — an admin will review this report. Nothing changes for {memberName} unless it's upheld.
        </p>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={`Report ${memberName}`} subtitle="Tell us what's wrong.">
      <div className="flex flex-col gap-3">
        <Field label="Reason" required>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            placeholder="What happened?"
          />
        </Field>
        <p className="text-xs text-stone-500">
          A report does not change anything on its own — an admin reviews it before any action is taken.
        </p>
        {error ? <p className="text-xs font-medium text-[var(--color-owed)]">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" size="sm" onClick={submit}>
            Submit report
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export interface DirectoryProps {
  onOpenCompany: (companyId: string) => void;
  onRequestReferral: (req: ReferralAsk) => void;
  now?: number;
}

const ALL = 'all';

/**
 * The alumni directory (§7.1 Must): search plus filters on company, function,
 * location, batch and open-to-referring.
 *
 * `listMembers()` is already viewer-scoped — it is where Karan's blocked-
 * employer rule (§4/D6) is enforced. If a member is missing from this list
 * for the current viewer, that is the privacy filter working; nothing in
 * this component re-checks who can see whom.
 */
export function Directory({ onOpenCompany, onRequestReferral, now = Date.now() }: DirectoryProps) {
  const members = listMembers();
  const companies = listCompanies();
  const viewer = getCurrentMember();

  const [search, setSearch] = useState('');
  const [companyId, setCompanyId] = useState<string>(ALL);
  const [fn, setFn] = useState<string>(ALL);
  const [location, setLocation] = useState<string>(ALL);
  const [batch, setBatch] = useState<string>(ALL);
  const [openOnly, setOpenOnly] = useState(false);
  const [reporting, setReporting] = useState<{ id: string; name: string } | null>(null);

  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c.name])), [companies]);

  // Filter option lists are derived from the full (viewer-scoped) roster, not
  // from the already-filtered list — picking "Consulting" should not make
  // "Bangalore" vanish from the location dropdown.
  const companyOptions = useMemo(() => {
    const present = new Set(members.map((m) => m.companyId).filter((id): id is string => Boolean(id)));
    return companies.filter((c) => present.has(c.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [members, companies]);

  const functionOptions = useMemo(
    () => Array.from(new Set(members.map((m) => m.function).filter((f): f is string => Boolean(f)))).sort(),
    [members],
  );
  const locationOptions = useMemo(
    () => Array.from(new Set(members.map((m) => m.location).filter((l): l is string => Boolean(l)))).sort(),
    [members],
  );
  const batchOptions = useMemo(
    () => Array.from(new Set(members.map((m) => m.batch))).sort((a, b) => b - a),
    [members],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return members.filter((m) => {
      if (companyId !== ALL && m.companyId !== companyId) return false;
      if (fn !== ALL && m.function !== fn) return false;
      if (location !== ALL && m.location !== location) return false;
      if (batch !== ALL && String(m.batch) !== batch) return false;
      if (openOnly && !m.openToReferring) return false;
      if (q) {
        const companyName = m.companyId ? companyById.get(m.companyId) ?? '' : '';
        const haystack = [m.name, m.title, m.function, m.location, companyName]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }, [members, search, companyId, fn, location, batch, openOnly, companyById]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-end gap-3 rounded-xl bg-white p-4 shadow-sm ring-1 ring-stone-900/5">
        <Field label="Search">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder="Name, title, company…"
            className="w-56"
          />
        </Field>

        <Field label="Company">
          <Select value={companyId} onChange={(e) => setCompanyId(e.currentTarget.value)} className="w-44">
            <option value={ALL}>All companies</option>
            {companyOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Function">
          <Select value={fn} onChange={(e) => setFn(e.currentTarget.value)} className="w-40">
            <option value={ALL}>All functions</option>
            {functionOptions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Location">
          <Select value={location} onChange={(e) => setLocation(e.currentTarget.value)} className="w-40">
            <option value={ALL}>All locations</option>
            {locationOptions.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Batch">
          <Select value={batch} onChange={(e) => setBatch(e.currentTarget.value)} className="w-28">
            <option value={ALL}>All batches</option>
            {batchOptions.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
        </Field>

        <label className="flex items-center gap-2 pb-2 text-sm font-medium text-stone-700">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.currentTarget.checked)}
            className="size-4 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
          />
          Open to referring only
        </label>

        <p className="ml-auto pb-2 text-xs text-stone-500">
          {filtered.length} of {members.length} alumni
        </p>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No alumni match those filters." />
      ) : (
        <Card className="divide-y divide-stone-200">
          {filtered.map((m) => {
            const companyName = m.companyId ? (companyById.get(m.companyId) ?? null) : null;
            // DL1: this checks only the REFERRER's own intake state — nothing
            // here is a limit on how many people the viewer may approach.
            const availability = m.openToReferring ? referralAvailabilityFor(m.id, now) : null;
            const isSelf = viewer !== null && viewer.id === m.id;

            return (
              <div key={m.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar name={m.name} size={32} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-stone-900">{m.name}</p>
                  <p className="truncate text-xs text-stone-500">
                    {m.programme} · {m.batch}
                    {m.title ? ` · ${m.title}` : ''}
                  </p>
                  <div className="flex flex-wrap gap-x-2 text-xs text-stone-400">
                    {companyName && m.companyId ? (
                      <button
                        type="button"
                        onClick={() => onOpenCompany(m.companyId as string)}
                        className="underline decoration-dotted hover:text-brand-700"
                      >
                        {companyName}
                      </button>
                    ) : null}
                    {m.function ? <span>{m.function}</span> : null}
                    {m.location ? <span>{m.location}</span> : null}
                  </div>
                </div>

                <Chip tone={m.openToReferring ? 'ok' : 'neutral'}>
                  {m.openToReferring ? 'Open to referring' : 'Not open to referring'}
                </Chip>

                {!isSelf ? (
                  <Button variant="ghost" size="sm" onClick={() => setReporting({ id: m.id, name: m.name })}>
                    Report
                  </Button>
                ) : null}

                {m.openToReferring && m.companyId && !isSelf && availability ? (
                  availability.accepting ? (
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() =>
                        onRequestReferral({
                          referrerId: m.id,
                          companyId: m.companyId as string,
                          roleTitle: '',
                          jobPostId: null,
                          roleUrl: null,
                        })
                      }
                    >
                      Request a referral
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" disabled>
                      {availabilityMessage(availability)}
                    </Button>
                  )
                ) : null}
              </div>
            );
          })}
        </Card>
      )}

      {reporting ? (
        <ReportMemberModal
          memberId={reporting.id}
          memberName={reporting.name}
          onClose={() => setReporting(null)}
        />
      ) : null}
    </div>
  );
}
