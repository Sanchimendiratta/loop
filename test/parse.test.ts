import { describe, expect, test } from 'vitest';
import { MIN_CONFIDENCE, parsePost } from '../src/core/parse.ts';
import {
  ALL_MESSAGES, MSG_1_CONFIDENTIAL_STARTUP, MSG_2_PHONE_ROUTE,
  MSG_3_SEARCH_FIRM, MSG_4_NAMED_COMPANY, MSG_5_CAREERS_EMAIL,
} from './fixtures/messages.ts';

describe('the four fields present in every real message (§5.0)', () => {
  test('every message yields a title, a location, an experience band and an apply route', () => {
    for (const msg of ALL_MESSAGES) {
      const p = parsePost(msg);
      expect(p.title.value, `title for: ${msg.slice(0, 30)}`).toBeTruthy();
      expect(p.locations.value?.length, `location for: ${msg.slice(0, 30)}`).toBeGreaterThan(0);
      expect(p.experience.value, `experience for: ${msg.slice(0, 30)}`).not.toBeNull();
      expect(p.applyValue.value, `route for: ${msg.slice(0, 30)}`).toBeTruthy();
    }
  });
});

describe('apply routes', () => {
  test('a link route is extracted with its URL', () => {
    const p = parsePost(MSG_1_CONFIDENTIAL_STARTUP);
    expect(p.applyMethod.value).toBe('link');
    expect(p.applyValue.value).toBe('https://jobs.lever.co/impactco/ad-people-culture');
  });

  test('a bare phone number is extracted and normalised', () => {
    const p = parsePost(MSG_2_PHONE_ROUTE);
    expect(p.applyMethod.value).toBe('phone');
    expect(p.applyValue.value).toBe('8800029599');
  });

  test('an email route wins over a JD link', () => {
    const p = parsePost(MSG_4_NAMED_COMPANY);
    expect(p.applyMethod.value).toBe('email');
    expect(p.applyValue.value).toBe('meera.iyer@foodhak.com');
    expect(p.jdUrl.value).toBe('https://docs.google.com/document/d/1a2b3c/edit');
  });

  test('a careers address is an email route', () => {
    const p = parsePost(MSG_5_CAREERS_EMAIL);
    expect(p.applyValue.value).toBe('careers@anveshan.farm');
  });
});

describe('experience bands', () => {
  test('a year range is read directly', () => {
    expect(parsePost(MSG_3_SEARCH_FIRM).experience.value).toEqual({ min: 18, max: 22 });
    expect(parsePost(MSG_4_NAMED_COMPANY).experience.value).toEqual({ min: 3, max: 6 });
    expect(parsePost(MSG_5_CAREERS_EMAIL).experience.value).toEqual({ min: 10, max: 15 });
  });

  test('"MBA + ~2 yrs" yields a band starting at 2', () => {
    expect(parsePost(MSG_2_PHONE_ROUTE).experience.value?.min).toBe(2);
  });

  test('a seniority word maps to a band when no range is given', () => {
    expect(parsePost(MSG_1_CONFIDENTIAL_STARTUP).experience.value).toEqual({ min: 12, max: 20 });
  });
});

describe('compensation', () => {
  test('a rupee lakh range is captured verbatim', () => {
    expect(parsePost(MSG_1_CONFIDENTIAL_STARTUP).compensation.value).toContain('30-40L');
  });

  test('a non-numeric compensation line is still captured', () => {
    expect(parsePost(MSG_3_SEARCH_FIRM).compensation.value).toContain('Competitive');
  });

  test('absent compensation is null, not an empty string', () => {
    expect(parsePost(MSG_5_CAREERS_EMAIL).compensation.value).toBeNull();
  });
});

describe('locations', () => {
  test('an Indian city is recognised', () => {
    expect(parsePost(MSG_5_CAREERS_EMAIL).locations.value).toContain('Manesar');
  });

  test('multiple international locations are all captured', () => {
    const locs = parsePost(MSG_4_NAMED_COMPANY).locations.value ?? [];
    expect(locs).toEqual(expect.arrayContaining(['UK', 'US', 'Middle East']));
  });

  test('Pan-India is a location in its own right', () => {
    expect(parsePost(MSG_3_SEARCH_FIRM).locations.value).toContain('Pan-India');
  });
});

describe('company — the weak field, per spec §5', () => {
  test('a named company is extracted', () => {
    expect(parsePost(MSG_4_NAMED_COMPANY).company.value).toBe('FOODHAK');
    expect(parsePost(MSG_5_CAREERS_EMAIL).company.value).toBe('Anveshan');
  });

  test('a withheld company yields null rather than a guess', () => {
    for (const msg of [MSG_1_CONFIDENTIAL_STARTUP, MSG_2_PHONE_ROUTE, MSG_3_SEARCH_FIRM]) {
      const p = parsePost(msg);
      expect(p.company.value, `should not guess a company from: ${msg.slice(0, 30)}`).toBeNull();
    }
  });

  test('a field below MIN_CONFIDENCE always reports a null value', () => {
    for (const msg of ALL_MESSAGES) {
      const p = parsePost(msg);
      for (const f of [p.title, p.company, p.locations, p.experience, p.compensation, p.applyValue]) {
        if (f.confidence < MIN_CONFIDENCE) expect(f.value).toBeNull();
      }
    }
  });
});

describe('source spans and the raw message', () => {
  test('a parsed field reports the text it came from', () => {
    const p = parsePost(MSG_5_CAREERS_EMAIL);
    expect(p.locations.source).toContain('Manesar');
  });

  test('the original message is preserved verbatim (§5.1)', () => {
    expect(parsePost(MSG_2_PHONE_ROUTE).raw).toBe(MSG_2_PHONE_ROUTE);
  });

  test('an empty paste parses to all-null rather than throwing', () => {
    const p = parsePost('');
    expect(p.title.value).toBeNull();
    expect(p.applyValue.value).toBeNull();
    expect(p.overallConfidence).toBe(0);
  });
});
