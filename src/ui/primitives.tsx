import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { useEffect, useRef } from 'react';

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ');

/**
 * The single source of visual truth for status colouring in this build.
 *
 * `owed` marks a rejection (Admin's decided list, and every inline error
 * banner across the app — `text-[var(--color-owed)]` traces back to the same
 * variable this table's `owed.chip` uses); `ok` marks an approval; `neutral`
 * is the default for a status or connection chip with no urgency of its own;
 * `stale` is for a row that has gone quiet without anyone having acted on it
 * — a stale post on the board, or an application `MyApplications.tsx`'s
 * `StaleDot` has not seen an update on in 14 days. Every tone resolves
 * through this one table so a chip and a dot for the same state cannot drift
 * apart.
 */
export const TONE = {
  owed: {
    chip: 'bg-[var(--color-owed-soft)] text-[var(--color-owed)] ring-1 ring-[var(--color-owed)]/25',
    dot: 'bg-[var(--color-owed)]',
  },
  stale: {
    chip: 'bg-amber-50 text-amber-800 ring-1 ring-amber-500/30',
    dot: 'bg-[var(--color-stale)]',
  },
  ok: {
    chip: 'bg-brand-50 text-brand-700 ring-1 ring-brand-500/25',
    dot: 'bg-brand-500',
  },
  neutral: {
    chip: 'bg-stone-100 text-stone-600 ring-1 ring-stone-200',
    dot: 'bg-stone-300',
  },
} as const;

export type Tone = keyof typeof TONE;

export function Chip({ tone = 'neutral', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        TONE[tone].chip,
        className,
      )}
    >
      {children}
    </span>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
};

export function Button({ variant = 'secondary', size = 'md', className, ...rest }: ButtonProps) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500';
  const sizes = { sm: 'px-2.5 py-1 text-xs', md: 'px-3.5 py-2 text-sm' };
  const variants = {
    primary: 'bg-brand-600 text-white hover:bg-brand-700 shadow-sm',
    secondary: 'bg-white text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50 shadow-sm',
    ghost: 'text-stone-600 hover:bg-stone-100',
    danger: 'bg-white text-[var(--color-owed)] ring-1 ring-[var(--color-owed)]/30 hover:bg-[var(--color-owed-soft)]',
  };
  return <button className={cx(base, sizes[size], variants[variant], className)} {...rest} />;
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
  // Deterministic hue per person: stable across renders and reloads without
  // storing a colour on the record.
  const hue = [...name].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 360, 7);
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `oklch(0.6 0.13 ${hue})`,
      }}
      title={name}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  width?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const FOCUSABLE =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key !== 'Tab') return;
      const nodes = Array.from(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      const active = document.activeElement;
      // Wrap at both ends so focus cannot leave the dialog.
      if (e.shiftKey && (active === first || !panel.current?.contains(active))) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    // Prefer the first real input over the close button — form dialogs open ready to type.
    const fields = panel.current?.querySelectorAll<HTMLElement>('input, textarea, select');
    (fields?.[0] ?? panel.current?.querySelector<HTMLElement>(FOCUSABLE))?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-stone-900/40 p-4 backdrop-blur-sm sm:p-8">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx('relative w-full rounded-2xl bg-white shadow-2xl ring-1 ring-stone-900/10', width)}
      >
        <header className="flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-stone-900">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-sm text-stone-500">{subtitle}</p> : null}
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
            ✕
          </Button>
        </header>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline gap-1.5 text-sm font-medium text-stone-700">
        {label}
        {required ? <span className="text-[var(--color-owed)]">required</span> : null}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-xs text-stone-500">{hint}</span> : null}
    </label>
  );
}

const control =
  'w-full rounded-lg border-0 bg-white px-3 py-2 text-sm text-stone-900 ring-1 ring-stone-300 placeholder:text-stone-400 focus:ring-2 focus:ring-brand-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-stone-50 disabled:text-stone-400';

export const Input = ({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) => (
  <input className={cx(control, className)} {...p} />
);

export const Textarea = ({ className, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea className={cx(control, 'min-h-20 resize-y', className)} {...p} />
);

export const Select = ({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cx(control, 'pr-8', className)} {...p} />
);

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-xl bg-white shadow-sm ring-1 ring-stone-900/5', className)}>{children}</div>;
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-stone-300 px-6 py-10 text-center">
      <p className="text-sm font-medium text-stone-700">{title}</p>
      {body ? <p className="mx-auto mt-1 max-w-sm text-sm text-stone-500">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export interface TabItem {
  id: string;
  label: string;
}

export function Tabs({
  items,
  active,
  onChange,
}: {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div role="tablist" className="inline-flex items-center gap-1 rounded-lg bg-stone-100 p-1">
      {items.map((item) => {
        const isActive = item.id === active;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(item.id)}
            className={cx(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              isActive ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
