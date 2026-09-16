/**
 * The five messages from PRD §5.0, as they arrive from a WhatsApp forward.
 *
 * The corpus itself lives in `src/data/messages.ts` — it is production input
 * data (the seed parses it for real), not test-only fixture data. This file
 * re-exports it so `test/parse.test.ts` has one source to assert against,
 * rather than a second copy that could drift.
 */
export * from '../../src/data/messages.ts';
