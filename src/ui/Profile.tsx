import type { ChangeEvent } from 'react';
import { useState } from 'react';
import {
  getCurrentMember,
  listCompanies,
  listMembers,
  myResume,
  RuleViolation,
  setPrivacy,
  setProfile,
  uploadResume,
} from '../data/store.ts';
import type { Member, PrivacySettings } from '../data/schema.ts';
import { Avatar, Button, Card, Chip, Field, Input, Select } from './primitives.tsx';

interface ProfileFormState {
  name: string;
  batch: number;
  programme: string;
  companyId: string; // '' stands for "no company"
  title: string;
  function: string;
  location: string;
  linkedinUrl: string;
  openToReferring: boolean;
}

function toFormState(m: Member): ProfileFormState {
  return {
    name: m.name,
    batch: m.batch,
    programme: m.programme,
    companyId: m.companyId ?? '',
    title: m.title ?? '',
    function: m.function ?? '',
    location: m.location ?? '',
    linkedinUrl: m.linkedinUrl ?? '',
    openToReferring: m.openToReferring,
  };
}

/**
 * Filename only, never the file. The browser hands this handler a `File`
 * object on selection; nothing here reads it, and the value plucked off is
 * `.name` — the one field `uploadResume` (store) will accept.
 */
function ResumeUpload() {
  const resume = myResume();
  const [error, setError] = useState<string | null>(null);

  function handleChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.currentTarget.files?.[0] ?? null;
    e.currentTarget.value = ''; // lets the same file be re-selected later
    if (!file) return;
    try {
      uploadResume(file.name);
      setError(null);
    } catch (err) {
      if (err instanceof RuleViolation) {
        setError(err.message);
      } else {
        throw err;
      }
    }
  }

  return (
    <Field label="Resume" hint="Only the filename is kept here — Loop never reads or transmits the file itself.">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-stone-700">{resume ? resume.filename : 'No resume on file'}</span>
        <label className="cursor-pointer">
          <span className="inline-flex items-center rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50">
            {resume ? 'Replace' : 'Upload'}
          </span>
          <input type="file" className="hidden" onChange={handleChange} />
        </label>
      </div>
      {error ? <p className="mt-1 text-xs font-medium text-[var(--color-owed)]">{error}</p> : null}
    </Field>
  );
}

/**
 * Name, batch, programme, current company, title, function, location,
 * LinkedIn URL, resume and the open-to-referring toggle (§7.1).
 *
 * `member` is always the viewer's own — `App.tsx` only ever mounts `Profile`
 * behind `VerificationGate`, and `Profile` itself reads `getCurrentMember()`,
 * never `getMember(id)` for someone else's.
 */
function ProfileForm({ member }: { member: Member }) {
  const companies = listCompanies();
  const [form, setForm] = useState<ProfileFormState>(() => toFormState(member));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function set<K extends keyof ProfileFormState>(key: K, value: ProfileFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  function handleSave() {
    try {
      setProfile({
        name: form.name,
        batch: form.batch,
        programme: form.programme,
        companyId: form.companyId || null,
        title: form.title || null,
        function: form.function || null,
        location: form.location || null,
        linkedinUrl: form.linkedinUrl || null,
        openToReferring: form.openToReferring,
      });
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
    <Card className="flex flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <Avatar name={member.name} size={40} />
        <div>
          <h2 className="text-sm font-semibold text-stone-900">Your profile</h2>
          <p className="text-xs text-stone-500">What other verified alumni see about you across Loop.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Name" required>
          <Input value={form.name} onChange={(e) => set('name', e.currentTarget.value)} />
        </Field>
        <Field label="Batch" required>
          <Input type="number" value={form.batch} onChange={(e) => set('batch', Number(e.currentTarget.value))} />
        </Field>
        <Field label="Programme" required>
          <Input value={form.programme} onChange={(e) => set('programme', e.currentTarget.value)} />
        </Field>
        <Field label="Current company">
          <Select value={form.companyId} onChange={(e) => set('companyId', e.currentTarget.value)}>
            <option value="">No company listed</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title">
          <Input value={form.title} onChange={(e) => set('title', e.currentTarget.value)} />
        </Field>
        <Field label="Function">
          <Input value={form.function} onChange={(e) => set('function', e.currentTarget.value)} />
        </Field>
        <Field label="Location">
          <Input value={form.location} onChange={(e) => set('location', e.currentTarget.value)} />
        </Field>
        {/* §7.4: the trust pitch, said out loud right where the URL is typed
            in — this product does not do what a LinkedIn scraper does. */}
        <Field label="LinkedIn URL" hint="Stored as text. Loop never visits or reads it.">
          <Input
            type="url"
            value={form.linkedinUrl}
            onChange={(e) => set('linkedinUrl', e.currentTarget.value)}
            placeholder="https://www.linkedin.com/in/…"
          />
        </Field>
      </div>

      <ResumeUpload />

      <label className="flex items-center gap-2 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={form.openToReferring}
          onChange={(e) => set('openToReferring', e.currentTarget.checked)}
          className="size-4 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
        />
        Open to referring others
      </label>

      {error ? (
        <p className="rounded-lg bg-[var(--color-owed-soft)] px-3 py-2 text-sm font-medium text-[var(--color-owed)]">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button variant="primary" onClick={handleSave}>
          Save profile
        </Button>
        {saved ? <span className="text-xs text-stone-500">Saved.</span> : null}
      </div>
    </Card>
  );
}

/**
 * The D6 privacy panel: confidential search, plus the two block lists (§8).
 *
 * Reads `member.privacy` straight off the full `Member` handed in by
 * `Profile` below — never `getMember()`, whose `PublicMember` has no
 * `privacy` field to read at all.
 *
 * Blocked companies is the more prominent control on purpose: §4's Karan is
 * an employed seeker hiding a search from his own employer, and that is the
 * exact case this control exists to serve. Blocked individuals is the
 * finer-grained, secondary tool underneath it.
 */
function PrivacyPanel({ member }: { member: Member }) {
  const allCompanies = listCompanies();
  const allMembers = listMembers().filter((m) => m.id !== member.id);
  const [privacy, setLocalPrivacy] = useState<PrivacySettings>(() => ({
    confidentialSearch: member.privacy.confidentialSearch,
    blockedCompanyIds: [...member.privacy.blockedCompanyIds],
    blockedMemberIds: [...member.privacy.blockedMemberIds],
  }));
  const [addCompanyId, setAddCompanyId] = useState('');
  const [addMemberId, setAddMemberId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const companyById = new Map(allCompanies.map((c) => [c.id, c.name]));
  const memberById = new Map(allMembers.map((m) => [m.id, m.name]));

  function commit(next: PrivacySettings) {
    try {
      setPrivacy(next);
      setLocalPrivacy(next);
      setError(null);
    } catch (e) {
      if (e instanceof RuleViolation) {
        setError(e.message);
      } else {
        throw e;
      }
    }
  }

  function addBlockedCompany() {
    if (!addCompanyId || privacy.blockedCompanyIds.includes(addCompanyId)) {
      setAddCompanyId('');
      return;
    }
    commit({ ...privacy, blockedCompanyIds: [...privacy.blockedCompanyIds, addCompanyId] });
    setAddCompanyId('');
  }

  function addBlockedMember() {
    if (!addMemberId || privacy.blockedMemberIds.includes(addMemberId)) {
      setAddMemberId('');
      return;
    }
    commit({ ...privacy, blockedMemberIds: [...privacy.blockedMemberIds, addMemberId] });
    setAddMemberId('');
  }

  const companyOptions = allCompanies.filter((c) => !privacy.blockedCompanyIds.includes(c.id));
  const memberOptions = allMembers.filter((m) => !privacy.blockedMemberIds.includes(m.id));

  return (
    <Card className="flex flex-col gap-5 p-4">
      <div>
        <h2 className="text-sm font-semibold text-stone-900">Privacy</h2>
        <p className="text-xs text-stone-500">Controls over who can find you while you look.</p>
      </div>

      <label className="flex items-start gap-3 rounded-lg bg-brand-50 p-3 ring-1 ring-brand-500/20">
        <input
          type="checkbox"
          checked={privacy.confidentialSearch}
          onChange={(e) => commit({ ...privacy, confidentialSearch: e.currentTarget.checked })}
          className="mt-0.5 size-4 rounded border-stone-300 text-brand-600 focus:ring-brand-500"
        />
        <span>
          <span className="block text-sm font-medium text-stone-900">Confidential search</span>
          <span className="block text-xs text-stone-600">
            Nothing about your search is visible to the network. There is no open-to-work wall here.
          </span>
        </span>
      </label>

      {/* The prominent control: a heavier border, a heading one size up from
          the panel below it, and listed first. */}
      <div className="rounded-xl border-2 border-stone-300 p-4">
        <h3 className="text-sm font-semibold text-stone-900">Companies you're hidden from</h3>
        <p className="mt-0.5 text-xs text-stone-500">
          Nobody whose own profile lists a company on this list can find you in the directory, or see you on a post
          you've shared. This is the control for searching while still employed there.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {privacy.blockedCompanyIds.length === 0 ? (
            <span className="text-xs text-stone-400">No companies blocked.</span>
          ) : (
            privacy.blockedCompanyIds.map((id) => (
              <Chip key={id} tone="stale">
                {companyById.get(id) ?? id}
                <button
                  type="button"
                  onClick={() => commit({ ...privacy, blockedCompanyIds: privacy.blockedCompanyIds.filter((c) => c !== id) })}
                  aria-label={`Unblock ${companyById.get(id) ?? id}`}
                  className="text-stone-500 hover:text-stone-800"
                >
                  ✕
                </button>
              </Chip>
            ))
          )}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select value={addCompanyId} onChange={(e) => setAddCompanyId(e.currentTarget.value)} className="w-56">
            <option value="">Add a company…</option>
            {companyOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Button variant="secondary" size="sm" onClick={addBlockedCompany} disabled={!addCompanyId}>
            Block
          </Button>
        </div>
      </div>

      {/* The secondary control: same shape, smaller and plainer. */}
      <div className="rounded-lg bg-stone-50 p-3">
        <h3 className="text-xs font-semibold text-stone-700">Individuals you're hidden from</h3>
        <p className="mt-0.5 text-xs text-stone-500">
          Hide yourself from one specific person, without blocking their whole company.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {privacy.blockedMemberIds.length === 0 ? (
            <span className="text-xs text-stone-400">No individuals blocked.</span>
          ) : (
            privacy.blockedMemberIds.map((id) => (
              <Chip key={id} tone="neutral">
                {memberById.get(id) ?? id}
                <button
                  type="button"
                  onClick={() => commit({ ...privacy, blockedMemberIds: privacy.blockedMemberIds.filter((m) => m !== id) })}
                  aria-label={`Unblock ${memberById.get(id) ?? id}`}
                  className="text-stone-500 hover:text-stone-800"
                >
                  ✕
                </button>
              </Chip>
            ))
          )}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select
            value={addMemberId}
            onChange={(e) => setAddMemberId(e.currentTarget.value)}
            className="w-56 !py-1 text-xs"
          >
            <option value="">Add a person…</option>
            {memberOptions.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Button variant="ghost" size="sm" onClick={addBlockedMember} disabled={!addMemberId}>
            Block
          </Button>
        </div>
      </div>

      {error ? <p className="text-xs font-medium text-[var(--color-owed)]">{error}</p> : null}
    </Card>
  );
}

/**
 * Profile + privacy settings (Task 24, §7.1/§7.4/D6).
 *
 * The two panels below carry distinct key prefixes rather than sharing
 * `member.id` outright — React keys two static JSX siblings by their own
 * value, and an identical key on both would collide. Keying on the member id
 * at all is still the point: it forces a remount, and a fresh local form
 * state, whenever the persona switcher changes who is signed in — without
 * it, switching identities while this tab is open would go on showing the
 * previous member's half-typed form.
 */
export function Profile() {
  const member = getCurrentMember();
  if (!member) return null;
  return (
    <div className="flex max-w-3xl flex-col gap-4 p-6">
      <ProfileForm key={`profile-${member.id}`} member={member} />
      <PrivacyPanel key={`privacy-${member.id}`} member={member} />
    </div>
  );
}
