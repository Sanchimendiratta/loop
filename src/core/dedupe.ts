/**
 * Duplicate detection across posters (§5.1).
 *
 * The same JD arriving from four alumni is normal, and §5.1 is explicit that it
 * should read as corroboration rather than clutter — several independent
 * posters raise a role's credibility. So duplicates merge into one card that
 * names the others, instead of being suppressed or listed four times.
 *
 * The key is the apply route plus the role title: the route is what actually
 * identifies a role across four differently-worded forwards.
 */

const TITLE_SYNONYMS: [RegExp, string][] = [
  [/\bsr\.?\b/gi, 'senior'],
  [/\bjr\.?\b/gi, 'junior'],
  [/\bmgr\.?\b/gi, 'manager'],
  [/\bassoc\.?\b/gi, 'associate'],
  [/\bvp\b/gi, 'vice president'],
];

export function normaliseRoute(v: string): string {
  const raw = String(v ?? '').trim();
  if (!raw) return '';

  if (raw.includes('@') && !raw.startsWith('http')) return raw.toLowerCase();

  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw);
      const host = u.host.toLowerCase().replace(/^www\./, '');
      const path = u.pathname.replace(/\/+$/, '');
      return `${host}${path}`;
    } catch {
      return raw.toLowerCase();
    }
  }

  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 10) return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return raw.toLowerCase();
}

export function normaliseTitle(t: string): string {
  let out = String(t ?? '').toLowerCase();
  for (const [re, to] of TITLE_SYNONYMS) out = out.replace(re, to);
  return out.replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** A stable, readable key. Not cryptographic — collisions here are cheap. */
export function dedupeHash(applyValue: string, title: string): string {
  return `${normaliseRoute(applyValue)}::${normaliseTitle(title)}`;
}

export function sharerSummary(names: string[]): string {
  const list = names.filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return `Also shared by ${list[0]}`;
  if (list.length === 2) return `Also shared by ${list[0]} and ${list[1]}`;
  return `Also shared by ${list[0]}, ${list[1]} +${list.length - 2}`;
}
