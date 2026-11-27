/**
 * Paste-to-parse (D12).
 *
 * PRD §9 assigns the hard judgements to an LLM behind a JSON schema. There is
 * no model here (spec DL5), so this is the deterministic layer §9 requires
 * first, built behind an interface a model can satisfy later.
 *
 * The governing rule is §9's: the parser never publishes. It pre-fills a form a
 * human confirms, and **a low-confidence field renders empty rather than
 * guessed** — a wrong value a hurried poster accepts is worse than a blank one.
 * That is why every field carries a confidence and why `parseField` nulls the
 * value below the threshold rather than leaving the caller to remember.
 *
 * What it does NOT do any more is classify where the CV lands. v1.3's
 * `inferDestination` guessed "external recruiter" vs "company ATS" from a
 * domain, which was always a slur risk on a genuine hiring manager's own post;
 * Lite drops that taxonomy from the schema outright (§7), so the guess has no
 * field to land in and no consumer. The parser fills exactly what Lite's
 * composer pre-fills: title, company, location, experience, compensation,
 * apply method, apply value, JD link.
 */
import type { ApplyMethod } from '../data/schema.ts';

export const MIN_CONFIDENCE = 0.5;

export interface ParsedField<T> {
  value: T | null;
  confidence: number;
  /** The slice of the paste this came from, so the composer can highlight it. */
  source: string | null;
}

export interface ParsedPost {
  title: ParsedField<string>;
  company: ParsedField<string>;
  locations: ParsedField<string[]>;
  experience: ParsedField<{ min: number; max: number }>;
  compensation: ParsedField<string>;
  applyMethod: ParsedField<ApplyMethod>;
  applyValue: ParsedField<string>;
  jdUrl: ParsedField<string>;
  raw: string;
  overallConfidence: number;
}

const none = <T>(): ParsedField<T> => ({ value: null, confidence: 0, source: null });

/** Single choke point for §9's rule: below the threshold, the value is gone. */
function field<T>(value: T | null, confidence: number, source: string | null): ParsedField<T> {
  if (value === null || confidence < MIN_CONFIDENCE) return { value: null, confidence, source };
  return { value, confidence, source };
}

const URL_RE = /https?:\/\/[^\s<>()]+/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE_RE = /(?:\+91[\s-]?)?(?:\d[\s-]?){10}/g;
const RANGE_RE = /(\d{1,2})\s*[-–—]\s*(\d{1,2})\s*(?:\+)?\s*(?:yrs?|years?)/i;
const SINGLE_YEARS_RE = /~?\s*(\d{1,2})\s*\+?\s*(?:yrs?|years?)/i;

const CITIES = [
  'Bangalore', 'Bengaluru', 'Mumbai', 'Delhi', 'Gurgaon', 'Gurugram', 'Noida', 'Manesar',
  'Pune', 'Hyderabad', 'Chennai', 'Kolkata', 'Ahmedabad', 'Jaipur', 'Indore', 'Kochi', 'Chandigarh',
];
const REGIONS: [RegExp, string][] = [
  [/\bpan[-\s]?india\b/i, 'Pan-India'],
  [/\bremote\b/i, 'Remote'],
  [/\bhybrid\b/i, 'Hybrid'],
  [/\bmiddle east\b/i, 'Middle East'],
  [/\bUK\b/, 'UK'],
  [/\bUS\b|\bUSA\b/, 'US'],
];

/** Seniority words map to a band only when no explicit range is given (§5.1). */
const SENIORITY: [RegExp, { min: number; max: number }][] = [
  [/\bchief\b|\bCXO\b|\bCBO\b|\bCEO\b|\bhead of\b|\bVP\b|\bvice president\b/i, { min: 15, max: 25 }],
  [/\bdirector\b|\bAD\b|\bassociate director\b|\bprincipal\b/i, { min: 12, max: 20 }],
  [/\bsenior\b|\blead\b|\bmanager\b/i, { min: 6, max: 12 }],
  [/\bassociate\b|\banalyst\b|\bexecutive\b/i, { min: 0, max: 3 }],
];

const lineContaining = (text: string, needle: string): string | null =>
  text.split('\n').find((l) => l.includes(needle))?.trim() ?? null;

function parseTitle(text: string): ParsedField<string> {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return none();

  // A labelled line is the strongest signal.
  for (const line of lines) {
    const m = /^(?:role|position|title|hiring(?: for)?|opening(?: for)?)\s*[:\-]\s*(.+)$/i.exec(line);
    if (m) return field(m[1].trim(), 0.9, line);
  }
  // "X is hiring a Y" / "X is looking for a Y"
  for (const line of lines) {
    const m = /\b(?:is\s+)?(?:hiring|looking for|seeking)\s+(?:a|an)\s+(.+?)[.!]?$/i.exec(line);
    if (m) return field(m[1].trim(), 0.8, line);
  }
  // Otherwise the first line, minus decoration. Weaker, but §5.0 shows the
  // title is almost always the opener.
  const first = lines[0].replace(/^[^\p{L}]+/u, '').replace(/[:!]+$/, '').trim();
  const cleaned = /^(?:hiring|urgent|open(?:ing)?)\s*[:\-]?\s*/i.test(first)
    ? first.replace(/^(?:hiring|urgent|open(?:ing)?)\s*[:\-]?\s*/i, '').trim()
    : first;
  return field(cleaned || null, cleaned.length > 2 ? 0.6 : 0, lines[0]);
}

/**
 * Company extraction — deliberately conservative.
 *
 * Three of §5.0's five messages withhold the name on purpose. Producing a guess
 * for those ("impact-tech startup" is not a company) would be worse than
 * leaving it blank, so only two high-precision shapes are accepted.
 */
function parseCompany(text: string): ParsedField<string> {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);

  for (const line of lines) {
    const labelled = /^(?:company|organisation|organization|client)\s*[:\-]\s*(.+)$/i.exec(line);
    // "Our client is a …" is a withheld name, not a company name.
    if (labelled && !/^(?:a|an|our client)\b/i.test(labelled[1].trim())) {
      return field(labelled[1].trim(), 0.85, line);
    }
    const subject = /^([A-Z][\w&.'-]*(?:\s[A-Z][\w&.'-]*)?)\s+(?:is hiring|is looking for|is seeking|are hiring)/.exec(line);
    if (subject) return field(subject[1].trim(), 0.8, line);
  }
  return none();
}

function parseLocations(text: string): ParsedField<string[]> {
  const found: string[] = [];
  let source: string | null = null;

  for (const city of CITIES) {
    const re = new RegExp(`\\b${city}\\b`, 'i');
    if (re.test(text) && !found.includes(city)) {
      found.push(city);
      source ??= lineContaining(text, city);
    }
  }
  for (const [re, label] of REGIONS) {
    if (re.test(text) && !found.includes(label)) {
      found.push(label);
      source ??= text.split('\n').find((l) => re.test(l))?.trim() ?? null;
    }
  }
  if (!found.length) return none();
  return field(found, 0.85, source);
}

function parseExperience(text: string): ParsedField<{ min: number; max: number }> {
  const range = RANGE_RE.exec(text);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[2]);
    if (min <= max) return field({ min, max }, 0.9, lineContaining(text, range[0]) ?? range[0]);
  }
  const single = SINGLE_YEARS_RE.exec(text);
  if (single) {
    const min = Number(single[1]);
    return field({ min, max: min + 3 }, 0.7, lineContaining(text, single[0]) ?? single[0]);
  }
  for (const [re, band] of SENIORITY) {
    const m = re.exec(text);
    if (m) return field(band, 0.55, lineContaining(text, m[0]) ?? m[0]);
  }
  return none();
}

function parseCompensation(text: string): ParsedField<string> {
  const lines = text.split('\n');
  // A labelled line ("Comp:", "Compensation:", "CTC:") is unambiguous and
  // must win over an incidental currency mention elsewhere (e.g. company
  // revenue in a "leading impact-tech startup (₹300Cr revenue)" line).
  const line =
    lines.find((l) => /^(?:comp(?:ensation)?|ctc|salary)\s*[:\-]/i.test(l.trim())) ??
    lines.find((l) => /(?:₹|rs\.?|inr)\s*[\d.]|(?:\d+\s*[-–]\s*\d+\s*L\b)|\bLPA\b|\bESOP/i.test(l));
  if (!line) return none();
  const stripped = line.replace(/^(?:comp(?:ensation)?|ctc|salary)\s*[:\-]\s*/i, '').trim();
  return field(stripped || null, 0.8, line.trim());
}

/** A route is required to publish, so email and phone beat a bare JD link. */
function parseRoute(text: string): { method: ParsedField<ApplyMethod>; value: ParsedField<string>; jd: ParsedField<string> } {
  const urls = text.match(URL_RE) ?? [];
  const emails = text.match(EMAIL_RE) ?? [];
  const phones = (text.match(PHONE_RE) ?? [])
    .map((p) => p.replace(/\D/g, ''))
    .map((d) => (d.length === 12 && d.startsWith('91') ? d.slice(2) : d))
    .filter((d) => d.length === 10);

  const jdUrl = urls.find((u) => /docs\.google|notion\.|\.pdf$|drive\.google/i.test(u)) ?? null;
  const applyUrl = urls.find((u) => u !== jdUrl) ?? null;

  const chosenEmail = emails[0];
  if (chosenEmail) {
    return {
      method: field<ApplyMethod>('email', 0.95, lineContaining(text, chosenEmail)),
      value: field(chosenEmail, 0.95, lineContaining(text, chosenEmail)),
      jd: jdUrl ? field(jdUrl, 0.9, lineContaining(text, jdUrl)) : none(),
    };
  }
  if (applyUrl) {
    return {
      method: field<ApplyMethod>('link', 0.9, lineContaining(text, applyUrl)),
      value: field(applyUrl, 0.9, lineContaining(text, applyUrl)),
      jd: jdUrl ? field(jdUrl, 0.9, lineContaining(text, jdUrl)) : none(),
    };
  }
  const chosenPhone = phones[0];
  if (chosenPhone) {
    const raw = (text.match(PHONE_RE) ?? [])[0] ?? '';
    return {
      method: field<ApplyMethod>('phone', 0.85, lineContaining(text, raw)),
      value: field(chosenPhone, 0.85, lineContaining(text, raw)),
      jd: jdUrl ? field(jdUrl, 0.9, lineContaining(text, jdUrl)) : none(),
    };
  }
  return { method: none(), value: none(), jd: jdUrl ? field(jdUrl, 0.9, null) : none() };
}

export function parsePost(text: string): ParsedPost {
  const raw = String(text ?? '');
  if (!raw.trim()) {
    return {
      title: none(), company: none(), locations: none(), experience: none(),
      compensation: none(), applyMethod: none(), applyValue: none(), jdUrl: none(),
      raw, overallConfidence: 0,
    };
  }

  const { method, value, jd } = parseRoute(raw);

  const parsed: ParsedPost = {
    title: parseTitle(raw),
    company: parseCompany(raw),
    locations: parseLocations(raw),
    experience: parseExperience(raw),
    compensation: parseCompensation(raw),
    applyMethod: method,
    applyValue: value,
    jdUrl: jd,
    raw,
    overallConfidence: 0,
  };

  const scored = [parsed.title, parsed.locations, parsed.experience, parsed.applyValue];
  parsed.overallConfidence =
    Math.round((scored.reduce((sum, f) => sum + f.confidence, 0) / scored.length) * 100) / 100;

  return parsed;
}
