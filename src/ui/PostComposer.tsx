import type { ClipboardEvent, FormEvent, ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { RuleViolation, getCurrentMember, publishPost } from '../data/store.ts';
import type { PostDraft } from '../data/store.ts';
import { APPLY_METHODS, CONNECTIONS, FUNCTIONS } from '../data/schema.ts';
import type { ApplyMethod, Connection, FunctionArea, JobPost } from '../data/schema.ts';
import { MIN_CONFIDENCE, parsePost } from '../core/parse.ts';
import { connectionBadge, connectionLine } from '../core/disclosure.ts';
import { useNow } from './useStore.ts';
import { Button, Field, Input, Modal, Select, Textarea } from './primitives.tsx';

export interface PostComposerProps {
  open: boolean;
  onClose: () => void;
  onPublished: (post: JobPost) => void;
}

const APPLY_METHOD_LABEL: Record<ApplyMethod, string> = {
  link: 'Link',
  email: 'Email',
  phone: 'Phone',
  through_me: 'Through me',
};

const APPLY_METHOD_PLACEHOLDER: Record<ApplyMethod, string> = {
  link: 'https://…',
  email: 'name@company.com',
  phone: '98765 43210',
  through_me: 'e.g. "DM me on LinkedIn"',
};

const APPLY_METHOD_INPUT_TYPE: Record<ApplyMethod, string> = {
  link: 'url',
  email: 'email',
  phone: 'tel',
  through_me: 'text',
};

/**
 * Store error codes this screen knows how to point at a specific control.
 * `missing_connection` is deliberately absent — it gets its own copy, not the
 * store's default message. See `handleSubmit`.
 */
const FIELD_FOR_CODE: Record<string, string> = {
  missing_title: 'title',
  missing_route: 'applyValue',
  missing_descriptor: 'confidentialDescriptor',
};

interface FormState {
  pasteText: string;
  rawPaste: string | null;
  overallConfidence: number | null;
  title: string;
  titleSource: string | null;
  companyName: string;
  companySource: string | null;
  isConfidential: boolean;
  confidentialDescriptor: string;
  fn: FunctionArea | '';
  location: string;
  locationSource: string | null;
  isRemote: boolean;
  expMin: string;
  expMax: string;
  expSource: string | null;
  compText: string;
  compSource: string | null;
  applyMethod: ApplyMethod;
  applyValue: string;
  applyValueSource: string | null;
  jdUrl: string;
  jdUrlSource: string | null;
  note: string;
  connection: Connection | '';
  contactName: string;
}

const EMPTY_FORM: FormState = {
  pasteText: '',
  rawPaste: null,
  overallConfidence: null,
  title: '',
  titleSource: null,
  companyName: '',
  companySource: null,
  isConfidential: false,
  confidentialDescriptor: '',
  fn: '',
  location: '',
  locationSource: null,
  isRemote: false,
  expMin: '',
  expMax: '',
  expSource: null,
  compText: '',
  compSource: null,
  applyMethod: 'link',
  applyValue: '',
  applyValueSource: null,
  jdUrl: '',
  jdUrlSource: null,
  note: '',
  connection: '',
  contactName: '',
};

function sourceHint(source: string): string {
  return `From the paste: "${source}"`;
}

function ErrorText({ children }: { children: ReactNode }) {
  return <p className="-mt-2 text-sm font-medium text-[var(--color-owed)]">{children}</p>;
}

/**
 * Screen 5: the composer.
 *
 * Paste-to-fill sits on top because it is the thing that beats forwarding a
 * WhatsApp message into a group, but every field underneath works fully
 * typed — six short fields plus the connection tap is not a lot to ask, and
 * paste is an accelerator, never the only way in.
 *
 * Three rules survive from v1.3's composer unchanged, all enforced by
 * `core/parse.ts` and respected here rather than re-implemented:
 *
 *   - a field whose confidence fell below `MIN_CONFIDENCE` renders empty —
 *     `parsePost` already nulls the value before this component ever sees
 *     it, so there is no rejected guess left anywhere to show as a
 *     placeholder;
 *   - a field `parsePost` DID fill shows its source line underneath, dimmed,
 *     so a poster can see nothing was invented;
 *   - every value that publishes is visible and editable here, including
 *     compensation and the JD link — nothing this form fills is hidden from
 *     the person publishing it.
 *
 * `function` and `connection` are never parsed, on purpose. `function` is new
 * in Lite and has no reliable signal in a WhatsApp forward to key off.
 * `connection` — "your connection to this role" — is the field the whole
 * board ranks on (Lite §4 field 7, `core/disclosure.ts`), so it starts empty
 * every time and a blocked publish for a missing one gets its own copy
 * ("Choose your connection to this role"), not the store's default
 * `RuleViolation` text.
 *
 * No destination taxonomy survives from v1.3 — no consent tick, no
 * destination radio group — because Lite's schema has nowhere for either to
 * land.
 */
export function PostComposer({ open, onClose, onPublished }: PostComposerProps) {
  const now = useNow();
  const viewer = getCurrentMember();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // A fresh form every time the composer opens, so a cancelled draft never
  // resurfaces on the next open.
  useEffect(() => {
    if (open) {
      setForm(EMPTY_FORM);
      setErrors({});
    }
  }, [open]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /**
   * The single choke point for accepting a parse: only fields `parsePost`
   * actually filled are written into the form, so an earlier manual edit — or
   * an earlier, better paste — is never silently clobbered by a paste that
   * found less.
   */
  function runParse(text: string): void {
    const parsed = parsePost(text);
    setForm((f) => {
      const next: FormState = { ...f, pasteText: text, rawPaste: text, overallConfidence: parsed.overallConfidence };
      if (parsed.title.value) {
        next.title = parsed.title.value;
        next.titleSource = parsed.title.source;
      }
      if (parsed.company.value) {
        next.companyName = parsed.company.value;
        next.companySource = parsed.company.source;
      }
      if (parsed.locations.value?.length) {
        const remote = parsed.locations.value.includes('Remote');
        const rest = parsed.locations.value.filter((l) => l !== 'Remote');
        next.location = rest.join(', ');
        next.isRemote = remote || f.isRemote;
        next.locationSource = parsed.locations.source;
      }
      if (parsed.experience.value) {
        next.expMin = String(parsed.experience.value.min);
        next.expMax = String(parsed.experience.value.max);
        next.expSource = parsed.experience.source;
      }
      if (parsed.compensation.value) {
        next.compText = parsed.compensation.value;
        next.compSource = parsed.compensation.source;
      }
      if (parsed.applyMethod.value) next.applyMethod = parsed.applyMethod.value;
      if (parsed.applyValue.value) {
        next.applyValue = parsed.applyValue.value;
        next.applyValueSource = parsed.applyValue.source;
      }
      if (parsed.jdUrl.value) {
        next.jdUrl = parsed.jdUrl.value;
        next.jdUrlSource = parsed.jdUrl.source;
      }
      return next;
    });
  }

  /** Fills the form the moment the paste lands — no extra click for the common case. */
  function handlePasteEvent(e: ClipboardEvent<HTMLTextAreaElement>): void {
    const text = e.clipboardData.getData('text');
    if (text) runParse(text);
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>): void {
    e.preventDefault();

    // Two fields the store cannot check for us: `function` has no store rule
    // at all (Lite never rejects a post for it), and `connection` needs its
    // own copy rather than the store's default message.
    const clientErrors: Record<string, string> = {};
    if (!form.fn) clientErrors.function = 'Choose a function for this role.';
    if (!form.connection) clientErrors.connection = 'Choose your connection to this role.';
    if (Object.keys(clientErrors).length) {
      setErrors(clientErrors);
      return;
    }

    const draft: PostDraft = {
      title: form.title,
      companyName: form.isConfidential ? null : form.companyName.trim() || null,
      isConfidential: form.isConfidential,
      confidentialDescriptor: form.isConfidential ? form.confidentialDescriptor : null,
      function: form.fn as FunctionArea,
      location: form.location,
      isRemote: form.isRemote,
      expMin: Number(form.expMin) || 0,
      expMax: Number(form.expMax) || 0,
      compText: form.compText.trim() || null,
      applyMethod: form.applyMethod,
      applyValue: form.applyValue,
      jdUrl: form.jdUrl.trim() || null,
      note: form.note.trim() || null,
      connection: form.connection as Connection,
      contactName: form.connection === 'knows_contact' ? form.contactName.trim() || null : null,
      rawPaste: form.rawPaste,
    };

    try {
      const post = publishPost(draft, now);
      setErrors({});
      onPublished(post);
      onClose();
    } catch (err) {
      if (err instanceof RuleViolation) {
        if (err.code === 'missing_connection') {
          setErrors({ connection: 'Choose your connection to this role.' });
          return;
        }
        const field = FIELD_FOR_CODE[err.code] ?? 'form';
        setErrors({ [field]: err.message });
      } else {
        setErrors({ form: 'Something went wrong. Try again.' });
      }
    }
  }

  if (!open) return null;

  const preview = form.connection
    ? connectionLine(form.connection, viewer?.name ?? 'You', form.contactName.trim() || null)
    : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Post a job"
      subtitle="Six short fields, or paste the forward and check what it found."
    >
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <Field
          label="Paste a WhatsApp forward (optional)"
          hint="Paste to fill the fields below, then check every one — a wrong guess is never shown, but a right one is always yours to edit."
        >
          <Textarea
            value={form.pasteText}
            onChange={(e) => set('pasteText', e.currentTarget.value)}
            onPaste={handlePasteEvent}
            rows={4}
            placeholder="Paste the forwarded message here…"
          />
        </Field>
        {form.pasteText ? (
          <div className="-mt-2 flex flex-wrap items-center gap-3">
            <Button type="button" size="sm" variant="secondary" onClick={() => runParse(form.pasteText)}>
              Fill fields from paste
            </Button>
            {form.overallConfidence !== null && form.overallConfidence < MIN_CONFIDENCE ? (
              <span className="text-xs text-stone-500">This message parsed with low confidence — check every field.</span>
            ) : null}
          </div>
        ) : null}

        <div>
          <Field label="Role title" required hint={form.titleSource ? sourceHint(form.titleSource) : undefined}>
            <Input
              value={form.title}
              onChange={(e) => set('title', e.currentTarget.value)}
              placeholder="e.g. Senior Manager – Strategy"
            />
          </Field>
          {errors.title ? <ErrorText>{errors.title}</ErrorText> : null}
        </div>

        <label className="flex items-center gap-2 text-sm text-stone-700">
          <input
            type="checkbox"
            checked={form.isConfidential}
            onChange={(e) => set('isConfidential', e.currentTarget.checked)}
            className="size-4 rounded border-stone-300"
          />
          Keep the company confidential
        </label>

        {form.isConfidential ? (
          <div>
            <Field label="One-line descriptor (no company name)" required>
              <Input
                value={form.confidentialDescriptor}
                onChange={(e) => set('confidentialDescriptor', e.currentTarget.value)}
                placeholder="e.g. Leading impact-tech startup, Series C"
              />
            </Field>
            {errors.confidentialDescriptor ? <ErrorText>{errors.confidentialDescriptor}</ErrorText> : null}
          </div>
        ) : (
          <Field label="Company" hint={form.companySource ? sourceHint(form.companySource) : undefined}>
            <Input
              value={form.companyName}
              onChange={(e) => set('companyName', e.currentTarget.value)}
              placeholder="e.g. Acme Corp"
            />
          </Field>
        )}

        <div>
          <Field label="Function" required>
            <Select value={form.fn} onChange={(e) => set('fn', e.currentTarget.value as FunctionArea | '')}>
              <option value="">Choose a function…</option>
              {FUNCTIONS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </Select>
          </Field>
          {errors.function ? <ErrorText>{errors.function}</ErrorText> : null}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
          <Field label="Location" hint={form.locationSource ? sourceHint(form.locationSource) : undefined}>
            <Input
              value={form.location}
              onChange={(e) => set('location', e.currentTarget.value)}
              placeholder="e.g. Bangalore"
            />
          </Field>
          <label className="flex items-center gap-2 self-end pb-2.5 text-sm text-stone-700">
            <input
              type="checkbox"
              checked={form.isRemote}
              onChange={(e) => set('isRemote', e.currentTarget.checked)}
              className="size-4 rounded border-stone-300"
            />
            Remote
          </label>
        </div>

        <Field label="Experience (years)" hint={form.expSource ? sourceHint(form.expSource) : undefined}>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs text-stone-500">Min</span>
              <Input
                type="number"
                min={0}
                value={form.expMin}
                onChange={(e) => set('expMin', e.currentTarget.value)}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-stone-500">Max</span>
              <Input
                type="number"
                min={0}
                value={form.expMax}
                onChange={(e) => set('expMax', e.currentTarget.value)}
              />
            </label>
          </div>
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="How to apply">
            <Select
              value={form.applyMethod}
              onChange={(e) => set('applyMethod', e.currentTarget.value as ApplyMethod)}
            >
              {APPLY_METHODS.map((m) => (
                <option key={m} value={m}>
                  {APPLY_METHOD_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
          <div>
            <Field
              label={APPLY_METHOD_LABEL[form.applyMethod]}
              required
              hint={
                form.applyValueSource
                  ? sourceHint(form.applyValueSource)
                  : form.applyMethod === 'link'
                    ? 'Stored as text. Loop never opens, fetches or previews it.'
                    : undefined
              }
            >
              <Input
                type={APPLY_METHOD_INPUT_TYPE[form.applyMethod]}
                value={form.applyValue}
                onChange={(e) => set('applyValue', e.currentTarget.value)}
                placeholder={APPLY_METHOD_PLACEHOLDER[form.applyMethod]}
              />
            </Field>
            {errors.applyValue ? <ErrorText>{errors.applyValue}</ErrorText> : null}
          </div>
        </div>

        <Field label="Compensation (optional)" hint={form.compSource ? sourceHint(form.compSource) : undefined}>
          <Input
            value={form.compText}
            onChange={(e) => set('compText', e.currentTarget.value)}
            placeholder="e.g. ₹30–40L"
          />
        </Field>

        <Field
          label="JD link (optional)"
          hint={form.jdUrlSource ? sourceHint(form.jdUrlSource) : 'Stored as text. Loop never opens, fetches or previews it.'}
        >
          <Input value={form.jdUrl} onChange={(e) => set('jdUrl', e.currentTarget.value)} placeholder="https://…" />
        </Field>

        <Field label="Anything else? (optional)">
          <Textarea value={form.note} onChange={(e) => set('note', e.currentTarget.value)} rows={2} />
        </Field>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 flex items-baseline gap-1.5 text-sm font-medium text-stone-700">
            Your connection to this role
            <span className="text-[var(--color-owed)]">required</span>
          </legend>
          <div className="flex flex-col gap-1.5">
            {CONNECTIONS.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm text-stone-700">
                <input
                  type="radio"
                  name="connection"
                  value={c}
                  checked={form.connection === c}
                  onChange={() => set('connection', c)}
                  className="size-4 border-stone-300"
                />
                {connectionBadge(c)}
              </label>
            ))}
          </div>
          {errors.connection ? <ErrorText>{errors.connection}</ErrorText> : null}
        </fieldset>

        {form.connection === 'knows_contact' ? (
          <Field label="Contact's name">
            <Input
              value={form.contactName}
              onChange={(e) => set('contactName', e.currentTarget.value)}
              placeholder="e.g. Priya Sharma"
            />
          </Field>
        ) : null}

        {preview ? (
          <div className="rounded-lg bg-stone-50 p-3 ring-1 ring-stone-200">
            <p className="text-xs font-semibold text-stone-500">This is what candidates will see.</p>
            <p className="mt-1 text-sm font-medium text-stone-800">{preview}</p>
          </div>
        ) : null}

        {errors.form ? <ErrorText>{errors.form}</ErrorText> : null}

        <div className="mt-1 flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            Post job
          </Button>
        </div>
      </form>
    </Modal>
  );
}
