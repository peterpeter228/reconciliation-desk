# Argon P2-2: independent XLSX triage

Verified on 2026-10-21 with the local production importer and installed SheetJS
0.20.3. All fixtures are generated synthetic workbooks. The URL in the fixtures
uses the reserved `example.invalid` domain; the tests examine in-memory results,
not network behavior.

## Finding and severity

Confirmed P2 import-profile / parser-differential gap. The guard originally read
canonical attribute keys, whereas SheetJS also aliases prefixes and underscore
suffixes. Unsupported package metadata could therefore pass the pre-parser
values-only gate. This is **not evidence of an external request, data exfiltration,
formula execution, or remote-code execution**. No such exploit was established.

The initial local reproduction, before this patch, found:

- The report's exact `r:Relationship` element with `r:Type`, `r:Target`, and
  `r:TargetMode` was accepted by `inspectXlsx` as an unused relationship. SheetJS
  ignores namespace-prefixed Relationship element names in its relationship
  reader; it did not establish that target as the requested relationship.
- An unprefixed `Relationship` with prefixed or underscore-suffixed attributes
  was accepted when unused. SheetJS does interpret those attribute aliases.
- A lowercase `relationship` element was accepted but ignored by SheetJS.
- A `Relationship` whose relevant attributes were all lowercase failed with
  `XLSX_PARSE`, rather than producing a successful end-to-end bypass.
- Connecting an aliased external relationship to a worksheet hyperlink made
  SheetJS produce cell hyperlink metadata, but the existing post-read hyperlink
  guard already rejected the workbook with `XLSX_EXTERNAL_LINK`.

These distinctions narrow the static report's broad “bypass risk” claim. They do
not justify treating the import boundary as comprehensively secure.

## Patch scope

- Enforce canonical case-sensitive names and unprefixed attribute names only
  for Relationship, Override, and Default metadata. Reject unsupported aliases
  before SheetJS sees the workbook, including the library's underscore aliases.
- Preserve ordinary worksheet `r:id`, namespace declarations, canonical
  namespace-prefixed content-type elements, shared strings, and the existing
  allowance for unused binary default declarations with no binary ZIP part.
- Retain existing duplicate/alias-collision rejection. This patch does not add a
  complete OPC schema validator or reject all prefixed XML attributes globally.
- Increase provenance parser version to `xlsx-local-1.1/sheetjs-0.20.3`.

## Executed checks

- `npx vitest run tests/argon-xlsx tests/xlsx`: 105 tests passed, 2 files.
- `npm run typecheck`: passed.
- Targeted Prettier formatting and validation: passed.

The new test file includes direct SheetJS parse assertions to distinguish
recognized attribute aliases from ignored prefixed Relationship elements. The
existing workbook suite remains part of the focused run. These are local unit
and importer checks, not a full browser, real-customer, or security certification.
