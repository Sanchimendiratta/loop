import type { ReactNode } from 'react';
import { cx } from './primitives.tsx';

export interface NavItem {
  id: string;
  label: string;
  /** Omitted or 0 renders no badge. */
  badge?: number;
}

export interface ShellProps {
  nav: NavItem[];
  active: string;
  onNavigate: (id: string) => void;
  children: ReactNode;
}

/**
 * The authenticated app's chrome: nav with badge counts, a search entry, and
 * a footer. Deliberately dumb — it renders whatever `nav` it is given and has
 * no opinion on verification. `App` mounts this only inside
 * `VerificationGate`'s children, which is what keeps it (and the badge counts
 * it renders) off the screen for anyone the gate is blocking; the persona
 * switcher lives in `App`, above the gate, precisely so it stays reachable
 * when this does not.
 */
export function Shell({ nav, active, onNavigate, children }: ShellProps) {
  return (
    <div className="flex h-full flex-col">
      <header className="z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-stone-200 bg-white px-6 py-3 shadow-sm">
        <nav className="flex items-center gap-1" aria-label="Main">
          {nav.map((item) => {
            const isActive = item.id === active;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={cx(
                  'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                  isActive ? 'bg-stone-900 text-white' : 'text-stone-600 hover:bg-stone-100',
                )}
              >
                {item.label}
                {item.badge ? (
                  <span
                    className={cx(
                      'rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
                      isActive ? 'bg-white/20 text-white' : 'bg-stone-200 text-stone-600',
                    )}
                  >
                    {item.badge}
                  </span>
                ) : null}
              </button>
            );
          })}
        </nav>

        {/* Directory owns real search (a later task); this is a reachable,
            inert placeholder until then. */}
        <div className="ml-auto">
          <input
            type="search"
            disabled
            placeholder="Search alumni, companies, roles…"
            aria-label="Search"
            className="w-56 rounded-lg bg-stone-100 px-3 py-1.5 text-sm text-stone-400 placeholder:text-stone-400 disabled:cursor-not-allowed"
          />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>

      <footer className="border-t border-stone-200 bg-white px-6 py-2 text-[11px] text-stone-500">
        Loop — XLRI Jamshedpur alumni network
      </footer>
    </div>
  );
}
