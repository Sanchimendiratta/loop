/**
 * Task 9 fix round 1, finding 2.
 *
 * The two pure reducers behind `PostComposer`'s paste-to-fill form —
 * `editField` and `mergeParsedIntoForm` — are exported from the component
 * file specifically so this can pin their contract without a DOM: this repo's
 * only `src/ui/` coverage otherwise is `scripts/smoke.mjs`'s SSR render,
 * which asserts nothing about interaction.
 *
 * The bug this closes: `*Source` was written by a parse and never cleared by
 * anything, so (a) a poster who typed over a pre-filled field still saw a
 * dimmed "From the paste" hint quoting text for a value that was no longer in
 * the field, and (b) a weaker second paste left the first paste's values and
 * source hints in place instead of clearing what it no longer found.
 */
import { describe, expect, test } from 'vitest';
import {
  EMPTY_FORM,
  editField,
  mergeParsedIntoForm,
} from '../src/ui/PostComposer.tsx';
import { parsePost } from '../src/core/parse.ts';
import { MSG_1_CONFIDENTIAL_STARTUP, MSG_4_NAMED_COMPANY } from './fixtures/messages.ts';

describe('editField — typing over a field clears its source', () => {
  test('a directly-typed field nulls its matching *Source', () => {
    const withSource = { ...EMPTY_FORM, title: 'AD/Director - People & Culture', titleSource: 'Hiring: AD/Director' };
    const edited = editField(withSource, 'title', 'A title the poster typed');
    expect(edited.title).toBe('A title the poster typed');
    expect(edited.titleSource).toBeNull();
  });

  test('expMin and expMax share one source, and editing either clears it', () => {
    const withSource = { ...EMPTY_FORM, expMin: '12', expMax: '20', expSource: 'AD/Director - People & Culture' };
    expect(editField(withSource, 'expMin', '13').expSource).toBeNull();
    expect(editField(withSource, 'expMax', '21').expSource).toBeNull();
  });

  test('a field with no rendered source hint (e.g. a free-text note) is untouched', () => {
    const edited = editField(EMPTY_FORM, 'note', 'a note');
    expect(edited.note).toBe('a note');
    // Nothing else on the form changes.
    expect({ ...edited, note: EMPTY_FORM.note }).toEqual(EMPTY_FORM);
  });

  test('editing one field never clears an unrelated field\'s source', () => {
    const withSources = {
      ...EMPTY_FORM,
      title: 'AD/Director', titleSource: 'line A',
      companyName: 'Acme', companySource: 'line B',
    };
    const edited = editField(withSources, 'title', 'Something else');
    expect(edited.titleSource).toBeNull();
    expect(edited.companySource).toBe('line B');
  });
});

describe('mergeParsedIntoForm — accepting a parse', () => {
  test('a field the new parse finds is filled, with its source', () => {
    const parsed = parsePost(MSG_1_CONFIDENTIAL_STARTUP);
    const next = mergeParsedIntoForm(EMPTY_FORM, MSG_1_CONFIDENTIAL_STARTUP, parsed);
    expect(next.title).toBe(parsed.title.value);
    expect(next.titleSource).toBe(parsed.title.source);
    // MSG_1 withholds the company name on purpose — parsePost finds none.
    expect(next.companyName).toBe('');
    expect(next.companySource).toBeNull();
  });

  test('a weaker re-paste clears a field the earlier, stronger paste had filled', () => {
    const firstParse = parsePost(MSG_4_NAMED_COMPANY); // finds a company: FOODHAK
    const afterFirst = mergeParsedIntoForm(EMPTY_FORM, MSG_4_NAMED_COMPANY, firstParse);
    expect(afterFirst.companyName).toBe('FOODHAK');
    expect(afterFirst.companySource).not.toBeNull();

    const secondParse = parsePost(MSG_1_CONFIDENTIAL_STARTUP); // finds no company
    const afterSecond = mergeParsedIntoForm(afterFirst, MSG_1_CONFIDENTIAL_STARTUP, secondParse);
    expect(afterSecond.companyName).toBe('');
    expect(afterSecond.companySource).toBeNull();
    // Title, which the second message DOES have, is replaced rather than stale.
    expect(afterSecond.title).toBe(secondParse.title.value);
  });

  test('a field the poster typed by hand survives a re-paste untouched', () => {
    const afterFirst = mergeParsedIntoForm(EMPTY_FORM, MSG_4_NAMED_COMPANY, parsePost(MSG_4_NAMED_COMPANY));
    expect(afterFirst.companyName).toBe('FOODHAK');

    // The poster overrides the parsed company by hand — editField nulls its source.
    const handEdited = editField(afterFirst, 'companyName', 'A Company The Poster Typed');
    expect(handEdited.companySource).toBeNull();

    // A second, weaker paste (no company found) must not touch a hand-typed value,
    // because its source is already null — mergeParsedIntoForm cannot tell it apart
    // from a value that was never paste-derived at all, which is exactly the point.
    const afterSecond = mergeParsedIntoForm(handEdited, MSG_1_CONFIDENTIAL_STARTUP, parsePost(MSG_1_CONFIDENTIAL_STARTUP));
    expect(afterSecond.companyName).toBe('A Company The Poster Typed');
    expect(afterSecond.companySource).toBeNull();
  });

  test('a better re-paste is allowed to overwrite a still-paste-sourced value', () => {
    const afterWeak = mergeParsedIntoForm(EMPTY_FORM, MSG_1_CONFIDENTIAL_STARTUP, parsePost(MSG_1_CONFIDENTIAL_STARTUP));
    expect(afterWeak.companyName).toBe(''); // MSG_1 has no company

    const afterStronger = mergeParsedIntoForm(afterWeak, MSG_4_NAMED_COMPANY, parsePost(MSG_4_NAMED_COMPANY));
    expect(afterStronger.companyName).toBe('FOODHAK');
    expect(afterStronger.companySource).not.toBeNull();
  });
});

/**
 * Task 9 fix round 2 (controller-applied).
 *
 * `isRemote` was the one field the round-1 fix missed, because it is the only
 * parsed value with no `*Source` of its own. `next.isRemote = remote ||
 * f.isRemote` could turn the tick ON but never OFF, so a Remote role followed
 * by an onsite one published the onsite role marked Remote — the same residue
 * class round 1 closed everywhere else. It borrows `locationSource` as its
 * provenance, since the two are only ever written together.
 */
describe('isRemote provenance', () => {
  const REMOTE_ROLE = 'Hiring a Product Manager at Zeta. Fully Remote. 4-7 yrs. Mail careers@zeta.com';
  const ONSITE_ROLE = 'Looking for a Brand Manager in Mumbai. 3-6 years experience. Ping me on 98200 11223';

  test('a newer paste with an onsite location clears a Remote tick the previous paste set', () => {
    const afterRemote = mergeParsedIntoForm(EMPTY_FORM, REMOTE_ROLE, parsePost(REMOTE_ROLE));
    expect(afterRemote.isRemote).toBe(true);

    const afterOnsite = mergeParsedIntoForm(afterRemote, ONSITE_ROLE, parsePost(ONSITE_ROLE));
    expect(afterOnsite.location).toBe('Mumbai');
    expect(afterOnsite.isRemote).toBe(false);
  });

  /**
   * The case the first version of this test could not reach.
   *
   * It started from EMPTY_FORM, where `locationSource` is trivially null, so it
   * passed under the unsound `locationSource`-borrow too. The sequence that
   * actually breaks the borrow is paste -> hand-tick -> paste: the first paste
   * sets `locationSource`, the hand tick does NOT clear it (the checkbox writes
   * `isRemote` alone), so the second paste read the poster's own tick as a stale
   * parse and wiped it. Found in re-review of the borrow.
   */
  test('a Remote tick the POSTER set after a paste survives the NEXT paste', () => {
    const afterOnsite = mergeParsedIntoForm(EMPTY_FORM, ONSITE_ROLE, parsePost(ONSITE_ROLE));
    expect(afterOnsite.isRemote).toBe(false);
    expect(afterOnsite.locationSource).not.toBeNull(); // the borrow's trap

    // The poster knows the role is remote even though the text never said so.
    const handTicked = editField(afterOnsite, 'isRemote', true);
    expect(handTicked.isRemote).toBe(true);
    expect(handTicked.isRemoteFromPaste).toBe(false);

    // A later paste that resolves a non-remote location must not overrule them.
    const afterSecond = mergeParsedIntoForm(handTicked, ONSITE_ROLE, parsePost(ONSITE_ROLE));
    expect(afterSecond.isRemote).toBe(true);
  });

  test('a Remote tick set by hand before any paste also survives', () => {
    const handTicked = editField(EMPTY_FORM, 'isRemote', true);
    const afterPaste = mergeParsedIntoForm(handTicked, ONSITE_ROLE, parsePost(ONSITE_ROLE));
    expect(afterPaste.isRemote).toBe(true);
  });

  test('a poster who UNTICKS a parsed Remote is not overruled by a later paste', () => {
    const afterRemote = mergeParsedIntoForm(EMPTY_FORM, REMOTE_ROLE, parsePost(REMOTE_ROLE));
    expect(afterRemote.isRemoteFromPaste).toBe(true);

    const handUnticked = editField(afterRemote, 'isRemote', false);
    expect(handUnticked.isRemoteFromPaste).toBe(false);

    const afterSecond = mergeParsedIntoForm(handUnticked, REMOTE_ROLE, parsePost(REMOTE_ROLE));
    // This one SHOULD re-tick: the new paste itself says Remote, which is a
    // fresh claim rather than a stale one.
    expect(afterSecond.isRemote).toBe(true);
  });

  test('a paste that finds no location at all clears a previously parsed Remote tick', () => {
    const afterRemote = mergeParsedIntoForm(EMPTY_FORM, REMOTE_ROLE, parsePost(REMOTE_ROLE));
    expect(afterRemote.isRemote).toBe(true);

    const noLocation = mergeParsedIntoForm(afterRemote, 'Someone good for a senior role, drop me a line.', parsePost('Someone good for a senior role, drop me a line.'));
    expect(noLocation.location).toBe('');
    expect(noLocation.isRemote).toBe(false);
  });
});
