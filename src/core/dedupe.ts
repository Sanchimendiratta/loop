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

/**
 * Params that identify the forward, not the role. Everything else is kept:
 * `?utm_source=whatsapp` is noise, but `?jobId=456` is a different requisition.
 */
const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'ref', 'source', 'src',
];

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
      // Drop tracking params but KEEP the rest. Dropping the whole query string
      // makes `?jobId=123` and `?jobId=456` collide, merging two real openings
      // into one card and hiding one of them. Sorted so param order never
      // affects the key.
      for (const t of TRACKING_PARAMS) u.searchParams.delete(t);
      u.searchParams.sort();
      const query = u.searchParams.toString();
      return `${host}${path}${query ? `?${query}` : ''}`;
    } catch {
      return raw.toLowerCase();
    }
  }

  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 10) {
    // Indian mobiles arrive as 8800029599, 08800029599 and +918800029599.
    // All three are one person; failing to fold them produces duplicate cards.
    if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
    if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
    return digits;
  }
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
