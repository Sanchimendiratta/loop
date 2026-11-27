/**
 * Final fix round, finding 2.
 *
 * `VerificationGate.tsx`'s `GetVerifiedForm.handleSubmit` now wraps
 * `submitVerification` in a try/catch (it didn't before — a whitespace-only
 * name passes the browser's own `required` check, which only tests for
 * length zero, trims to `''`, and used to throw uncaught out of the submit
 * handler, which no React error boundary catches: a dead button and a
 * console exception, no feedback at all).
 *
 * This repo has no DOM-testing harness for `src/ui/`, so `handleSubmit`
 * itself is not exercised here — that is covered by a real-browser check
 * (submit the Get-verified form with a whitespace-only name, confirm an
 * inline error appears next to the name field instead of nothing happening).
 * What this test CAN pin without a DOM is the wiring `handleSubmit` depends
 * on: that `submitVerification` actually refuses a whitespace-only name and
 * a whitespace-only LinkedIn URL with the two specific codes this form
 * knows how to route (`test/store.test.ts` already pins the refusal itself),
 * and that `FIELD_FOR_CODE` — exported from `VerificationGate.tsx` for
 * exactly this reason — points each of those codes at the control that
 * failed, not at a generic form-level banner.
 */
import { beforeEach, describe, expect, test } from 'vitest';
import { FIELD_FOR_CODE } from '../src/ui/VerificationGate.tsx';
import * as store from '../src/data/store.ts';

const NOW = Date.UTC(2026, 8, 17);

beforeEach(() => { store.reset(NOW); });

function violationCode(fn: () => unknown): string | undefined {
  try {
    fn();
    return undefined;
  } catch (err) {
    return err instanceof store.RuleViolation ? err.code : undefined;
  }
}

describe('VerificationGate — GetVerifiedForm error-to-field wiring', () => {
  test('missing_name (a whitespace-only name, trimmed) routes to the name field', () => {
    const code = violationCode(() =>
      store.submitVerification(
        {
          googleSub: 'g_wire_name',
          email: 'wire.name@astra.xlri.ac.in',
          name: '   '.trim(),
          batch: 2020,
          programme: 'BM',
          linkedinUrl: 'https://linkedin.com/in/x',
          knownBy: null,
        },
        NOW,
      ),
    );
    expect(code).toBe('missing_name');
    expect(FIELD_FOR_CODE[code!]).toBe('name');
  });

  test('missing_linkedin (a whitespace-only LinkedIn URL, trimmed) routes to the linkedinUrl field', () => {
    const code = violationCode(() =>
      store.submitVerification(
        {
          googleSub: 'g_wire_li',
          email: 'wire.li@astra.xlri.ac.in',
          name: 'Someone',
          batch: 2020,
          programme: 'BM',
          linkedinUrl: '   '.trim(),
          knownBy: null,
        },
        NOW,
      ),
    );
    expect(code).toBe('missing_linkedin');
    expect(FIELD_FOR_CODE[code!]).toBe('linkedinUrl');
  });

  test('an unmapped code would fall through to the form-level fallback, not a control', () => {
    expect(FIELD_FOR_CODE['unknown_member']).toBeUndefined();
  });
});
