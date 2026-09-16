import { useState } from 'react';
import type { ReactNode } from 'react';
import { MIN_CONFIDENCE, inferDestination, parsePost } from '../core/parse.ts';
import type { ParsedPost } from '../core/parse.ts';
import { disclosureSentence, destinationLabel, relationshipBadge } from '../core/disclosure.ts';
import { getCurrentMember, listCompanies, publishPost, RuleViolation } from '../data/store.ts';
import type { PostDraft } from '../data/store.ts';
import type { ApplyMethod, Company, DestinationType, JobPost, PosterRelationship } from '../data/schema.ts';
import { Button, Chip, Field, Input, Modal, Select, Textarea } from './primitives.tsx';

export interface PostComposerProps {
  open: boolean;
  onClose: () => void;
  onPublished: (post: JobPost) => void;
}

const RELATIONSHIP_OPTIONS: PosterRelationship[] = [
  'hiring_manager',
  'internal_can_refer',
  'knows_contact',
  'forwarded',
];

const DESTINATION_OPTIONS: DestinationType[] = [
  'company_ats',
  'named_person',
  'external_recruiter',
  'third_party_platform',
  'via_poster',
];

const CONSENT_DESTINATIONS: DestinationType[] = ['named_person', 'external_recruiter'];

const APPLY_METHODS: { id: ApplyMethod; label: string }[] = [
  { id: 'email', label: 'Email' },
  { id: 'link', label: 'Link' },
  { id: 'phone', label: 'Phone' },
  { id: 'via_loop', label: 'Through Loop' },
];

function matchCompany(companies: Company[], name: string | null): Company | null {
  if (!name) return null;
  const norm = name.trim().toLowerCase();
  return companies.find((c) => c.name.trim().toLowerCase() === norm) ?? null;
}

/** Beneath a pre-filled field only — §rule 2: an empty field shows nothing here. */
function sourceHint(value: unknown, source: string | null): ReactNode | undefined {
  const present = Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined && value !== '';
  if (!present || !source) return undefined;
  return (
    <>
      from: <em>{source}</em>
    </>
  );
}

interface FormState {
  title: string;
  confidential: boolean;
  companyId: string | null;
  confidentialDescriptor: string;
  locations: string[];
  expMin: number | null;
  expMax: number | null;
  compText: string;
  applyMethod: ApplyMethod;
  applyValue: string;
  jdUrl: string;
  relationship: PosterRelationship | null;
  destinationType: DestinationType | null;
  hiringContactName: string;
  consent: boolean;
}

function initialForm(parsed: ParsedPost, companies: Company[]): FormState {
  const matched = matchCompany(companies, parsed.company.value);
  // D13 ruling: a false-positive "external recruiter" read on a real hiring
  // manager's own post is a meaningful slur, so this one destination never
  // starts pre-selected — every other inferred destination is fine to keep.
  const inferredDestination = parsed.destination.value === 'external_recruiter' ? null : parsed.destination.value;
  return {
    title: parsed.title.value ?? '',
    confidential: !matched,
    companyId: matched?.id ?? null,
    confidentialDescriptor: matched ? '' : (parsed.company.value ?? ''),
    locations: parsed.locations.value ? [...parsed.locations.value] : [],
    expMin: parsed.experience.value?.min ?? null,
    expMax: parsed.experience.value?.max ?? null,
    compText: parsed.compensation.value ?? '',
    applyMethod: parsed.applyMethod.value ?? 'email',
    applyValue: parsed.applyValue.value ?? '',
    jdUrl: parsed.jdUrl.value ?? '',
    // D13: the one field the parser cannot fill — empty by default, always.
    relationship: null,
    destinationType: inferredDestination,
    hiringContactName: '',
    consent: false,
  };
}

/**
 * The paste-to-parse composer (D12).
 *
 * Step one is a single textarea — no blank multi-field form exists anywhere in
 * this flow, because that is precisely the friction that keeps an alum on
 * WhatsApp instead. Step two is `parsePost`'s output, confirmed by a human:
 * every pre-filled field carries the source line it came from, every field
 * below `MIN_CONFIDENCE` renders empty rather than as a guess, and the one
 * field no parser can answer — how the poster relates to the role — starts
 * unselected every time.
 */
export function PostComposer({ open, onClose, onPublished }: PostComposerProps) {
  const [step, setStep] = useState<'paste' | 'review'>('paste');
  const [raw, setRaw] = useState('');
  const [parsed, setParsed] = useState<ParsedPost | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ post: JobPost; merged: boolean } | null>(null);

  const member = getCurrentMember();
  const companies = listCompanies();

  function reset() {
    setStep('paste');
    setRaw('');
    setParsed(null);
    setForm(null);
    setError(null);
    setResult(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleContinue() {
    if (!raw.trim()) return;
    const p = parsePost(raw);
    setParsed(p);
    setForm(initialForm(p, companies));
    setError(null);
    setStep('review');
  }

  function handleBack() {
    setStep('paste');
    setError(null);
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
  }

  function removeLocation(loc: string) {
    setForm((f) => (f ? { ...f, locations: f.locations.filter((l) => l !== loc) } : f));
  }

  const [newLocation, setNewLocation] = useState('');
  function addLocation() {
    const v = newLocation.trim();
    if (v && form && !form.locations.includes(v)) {
      set('locations', [...form.locations, v]);
    }
    setNewLocation('');
  }

  function validateClient(f: FormState): string | null {
    if (!f.confidential && !f.companyId) {
      return 'Add the company, or mark this role confidential with a one-line descriptor.';
    }
    if (f.confidential && !f.confidentialDescriptor.trim()) {
      return 'Add a one-line descriptor for the confidential employer.';
    }
    if (f.locations.length === 0) return 'Add at least one location.';
    if (f.expMin === null || f.expMax === null) return 'Add an experience range.';
    if (!f.relationship) return 'Choose your relationship to this role.';
    if (!f.destinationType) return 'Confirm where the application goes.';
    return null;
  }

  function handlePublish() {
    if (!form) return;
    const clientError = validateClient(form);
    if (clientError) {
      setError(clientError);
      return;
    }
    const needsConsent = CONSENT_DESTINATIONS.includes(form.destinationType as DestinationType);
    const draft: PostDraft = {
      rawText: raw,
      title: form.title.trim(),
      companyId: form.confidential ? null : form.companyId,
      confidentialDescriptor: form.confidential ? form.confidentialDescriptor.trim() : null,
      locations: form.locations,
      expMin: form.expMin,
      expMax: form.expMax,
      compText: form.compText.trim() || null,
      function: null,
      applyMethod: form.applyMethod,
      applyValue: form.applyValue.trim(),
      jdUrl: form.jdUrl.trim() || null,
      posterRelationship: form.relationship as PosterRelationship,
      destinationType: form.destinationType as DestinationType,
      hiringContactName: form.hiringContactName.trim() || null,
      hiringContactValue: needsConsent ? form.applyValue.trim() || null : null,
      contactConsentConfirmed: form.consent,
      parseConfidence: parsed?.overallConfidence ?? 0,
    };

    const before = Date.now();
    try {
      const post = publishPost(draft);
      // §5.1: a dedupeHash collision returns the EXISTING post instead of a
      // new one — its postedAt predates this call, which is how the merge is
      // told apart from a genuinely new card without touching store internals.
      setResult({ post, merged: post.postedAt < before });
      setError(null);
    } catch (e) {
      if (e instanceof RuleViolation) {
        setError(e.message);
      } else {
        throw e;
      }
    }
  }

  function handleDone() {
    if (result) onPublished(result.post);
    reset();
    onClose();
  }

  if (!open) return null;

  if (!member) {
    return (
      <Modal open={open} onClose={handleClose} title="Post a job">
        <p className="text-sm text-stone-600">You need to be a verified member to post a role.</p>
      </Modal>
    );
  }

  if (result) {
    return (
      <Modal open={open} onClose={handleDone} title="Posted">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-stone-700">
            {result.merged
              ? "This role was already on the board — we've added your name as another source instead of creating a duplicate card."
              : 'Your role is live on the board.'}
          </p>
          <div>
            <Button variant="primary" onClick={handleDone}>
              Done
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  if (step === 'paste' || !form) {
    return (
      <Modal open={open} onClose={handleClose} title="Post a job">
        <div className="flex flex-col gap-3">
          <Textarea
            autoFocus
            value={raw}
            onChange={(e) => setRaw(e.currentTarget.value)}
            placeholder="Paste the message you were about to forward."
            className="min-h-48"
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleContinue} disabled={!raw.trim()}>
              Continue
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  const matchedCompany = form.companyId ? (companies.find((c) => c.id === form.companyId) ?? null) : null;
  const companyName = form.confidential ? form.confidentialDescriptor.trim() || null : (matchedCompany?.name ?? null);
  const needsConsent = form.destinationType ? CONSENT_DESTINATIONS.includes(form.destinationType) : false;
  const destCtx = { posterName: member.name, companyName, contactName: form.hiringContactName.trim() || null };

  // Re-suggested live as the poster edits the apply route in review — e.g.
  // fixing a garbled parse. Never auto-applied: adopting it, like the initial
  // pre-fill, is always an explicit tap (D13 external_recruiter ruling).
  const liveSuggestion =
    form.applyValue.trim() && form.applyMethod ? inferDestination(form.applyMethod, form.applyValue.trim()) : null;

  const disclosurePreview =
    form.relationship && form.destinationType
      ? disclosureSentence({ ...destCtx, relationship: form.relationship, destination: form.destinationType })
      : null;

  return (
    <Modal open={open} onClose={handleClose} title="Review before you post" subtitle="Six required fields — five are pre-filled." width="max-w-2xl">
      <div className="flex flex-col gap-5">
        {parsed && parsed.overallConfidence < MIN_CONFIDENCE ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-500/30">
            This message parsed with low confidence — check every field before publishing.
          </p>
        ) : null}

        <Field label="Role title" required hint={sourceHint(parsed?.title.value ?? null, parsed?.title.source ?? null)}>
          <Input value={form.title} onChange={(e) => set('title', e.currentTarget.value)} />
        </Field>

        <Field label="Company" required hint={sourceHint(parsed?.company.value ?? null, parsed?.company.source ?? null)}>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={form.confidential}
                onChange={(e) => set('confidential', e.currentTarget.checked)}
              />
              Confidential — hide the company name
            </label>
            {form.confidential ? (
              <Input
                value={form.confidentialDescriptor}
                onChange={(e) => set('confidentialDescriptor', e.currentTarget.value)}
                placeholder="One-line descriptor, e.g. Leading impact-tech startup"
              />
            ) : (
              <Select value={form.companyId ?? ''} onChange={(e) => set('companyId', e.currentTarget.value || null)}>
                <option value="">Select a company…</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
        </Field>

        <Field label="Location" required hint={sourceHint(parsed?.locations.value ?? null, parsed?.locations.source ?? null)}>
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
              {form.locations.map((loc) => (
                <Chip key={loc} tone="neutral">
                  {loc}
                  <button
                    type="button"
                    onClick={() => removeLocation(loc)}
                    aria-label={`Remove ${loc}`}
                    className="ml-1 text-stone-400 hover:text-stone-700"
                  >
                    ✕
                  </button>
                </Chip>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={newLocation}
                onChange={(e) => setNewLocation(e.currentTarget.value)}
                placeholder="Add a location"
                className="w-48"
              />
              <Button type="button" size="sm" onClick={addLocation}>
                Add
              </Button>
            </div>
          </div>
        </Field>

        <Field
          label="Experience band"
          required
          hint={sourceHint(parsed?.experience.value ?? null, parsed?.experience.source ?? null)}
        >
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={0}
              value={form.expMin ?? ''}
              onChange={(e) => set('expMin', e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
              placeholder="Min yrs"
              className="w-28"
            />
            <span className="text-sm text-stone-400">to</span>
            <Input
              type="number"
              min={0}
              value={form.expMax ?? ''}
              onChange={(e) => set('expMax', e.currentTarget.value === '' ? null : Number(e.currentTarget.value))}
              placeholder="Max yrs"
              className="w-28"
            />
          </div>
        </Field>

        <Field label="How to apply" required hint={sourceHint(parsed?.applyValue.value ?? null, parsed?.applyValue.source ?? null)}>
          <div className="flex gap-2">
            <Select
              value={form.applyMethod}
              onChange={(e) => set('applyMethod', e.currentTarget.value as ApplyMethod)}
              className="w-36"
            >
              {APPLY_METHODS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </Select>
            <Input
              value={form.applyValue}
              onChange={(e) => set('applyValue', e.currentTarget.value)}
              placeholder="Email, link or phone number"
              className="flex-1"
            />
          </div>
        </Field>

        <Field label="Your relationship to this role" required>
          <div className="flex flex-col gap-1.5">
            {RELATIONSHIP_OPTIONS.map((r) => (
              <label key={r} className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="radio"
                  name="relationship"
                  checked={form.relationship === r}
                  onChange={() => set('relationship', r)}
                />
                {relationshipBadge(r).label}
              </label>
            ))}
          </div>
        </Field>

        <Field label="Where does the application go?" required>
          <div className="flex flex-col gap-1.5">
            {DESTINATION_OPTIONS.map((d) => (
              <label key={d} className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="radio"
                  name="destination"
                  checked={form.destinationType === d}
                  onChange={() => set('destinationType', d)}
                />
                {destinationLabel(d, destCtx)}
              </label>
            ))}
            {liveSuggestion && liveSuggestion.value !== form.destinationType ? (
              <p className="text-xs text-stone-500">
                Suggested: {destinationLabel(liveSuggestion.value, destCtx)}{' '}
                <button
                  type="button"
                  className="text-brand-600 underline"
                  onClick={() => set('destinationType', liveSuggestion.value)}
                >
                  Use this
                </button>
              </p>
            ) : null}
          </div>
        </Field>

        {needsConsent ? (
          <Field label="Contact name (optional)">
            <Input
              value={form.hiringContactName}
              onChange={(e) => set('hiringContactName', e.currentTarget.value)}
              placeholder="Who the CV goes to"
            />
          </Field>
        ) : null}

        {needsConsent ? (
          <label className="flex items-start gap-2 text-sm text-stone-700">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={form.consent}
              onChange={(e) => set('consent', e.currentTarget.checked)}
            />
            I confirm this contact was shared for circulation.
          </label>
        ) : null}

        {disclosurePreview ? (
          <div>
            <p className="mb-1 text-xs font-medium text-stone-500">This is what candidates will see.</p>
            <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm font-semibold leading-snug text-stone-900 ring-1 ring-stone-200">
              {disclosurePreview}
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="rounded-lg bg-[var(--color-owed-soft)] px-3 py-2 text-sm font-medium text-[var(--color-owed)]">
            {error}
          </p>
        ) : null}

        <div className="flex justify-between gap-2">
          <Button variant="ghost" onClick={handleBack}>
            Back
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={handleClose}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handlePublish}>
              Publish
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
