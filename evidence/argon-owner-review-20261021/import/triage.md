# Argon 1.1 / 1.2 independent verification

## Outcome

- Confirmed shared CSV API provenance defect: manual and synthetic profiles accepted parsed text with unrelated or changed originalBytes. Current UI derives both from the same File, so this is an API/integrity boundary defect rather than a demonstrated UI exploit. Fixed for every profile before parsing/hashing.
- Confirmed low-risk UX defect: changing import settings during arrayBuffer, workbook inspection, or parse correctly invalidated the operation, but silently discarded the chosen file. Added an immediate actionable cancellation notice, kept controls editable, preserved existing token rejection, and avoided launching a parser after invalidated byte read/inspection. A newer upload still wins when the old parser resolves.
- Rejected workspace-overflow scenario: 3 source slots × 10 MiB each is at most 30 MiB; replacement does not add a fourth slot. 9.5 × 3 is 28.5, not >30. Global parse token also prevents concurrent stale operations from committing. Added existingTotalBytes to both worker parser paths as defense in depth; totals exclude the file being parsed/replaced.
- Rejected BOM-hash allegation: byte-for-byte identity intentionally includes BOM bytes. Optional leading BOM normalization preserves equal parsed content, while source hashes differ for different physical files. This is not semantic deduplication and no canonical hash was introduced.

## Compatibility

ParseOptions.encoding is now optional ('utf-8' default, explicit 'utf-16le' or 'utf-16be'). UTF-16 callers supplying originalBytes must explicitly declare the same encoding passed to decodeCsv. There is no encoding guess or auto-conversion. Unsupported runtime encoding fails closed. Native QBO Transaction Journal remains UTF-8-only; UI still advertises/supports UTF-8 only. Legitimate BOM normalization and original raw-byte hashes are retained.

## Files owned/changed

- src/ingestion/csv.ts
- src/ingestion/types.ts (parent explicitly extended ownership)
- src/pages/import.tsx
- tests/import-export/source-byte-binding.test.ts (new, 17 tests)
- tests/ui/qbo-journal-profile.test.ts (16 tests, five new plus strengthened existing stale-result test)

## Before-fix reproduction (actual output excerpts; not full log files)

1. npm test -- tests/import-export/source-byte-binding.test.ts
   Test Files 1 failed (1); Tests 9 failed | 2 passed (11).
   Eight manual/synthetic ST/QBO/QBD/BANK stale-byte cases failed with `expected true to be false` at mismatched.ok. The malformed UTF-8 bytes case was also incorrectly accepted. Both legitimate BOM cases already passed.
2. npm test -- tests/ui/qbo-journal-profile.test.ts
   Test Files 1 failed (1); Tests 4 failed | 10 passed (14).
   Three tests could not find the cancellation notice. Budget test received [undefined, undefined, undefined], expected [0, 60, 165]. Existing stale-token behavior was preserved, not treated as a bug.

## After-fix validation

- Installed local Vitest runner: 4 files passed, 114 tests passed (source-byte binding, QBO UI, ingestion, native adversarial parser).
- Installed local TypeScript compiler: --noEmit passed.
- Installed local Prettier: write/check of the five owned files passed.
- Final focused-test raw output: green-targeted.log.
- Before-fix observed failure excerpts: red-observed-excerpts.log (not a complete raw console log).
- Full suite/build and remote integration remain parent-owned; this worker did not run browser, deploy, or external API calls. Artifact-only fresh compiler and format check outputs are in typecheck.log and format-check.log.

An intermediate combined edit/npm-test command was denied because npm attempted registry.npmjs.org. Inspection established that the edits had already executed. No blind retry was made; parent approved the safer installed-binary/offline checks. They passed. The final shell command's exit 1 came from intentional diff output, after all format/type/test checks had passed.
