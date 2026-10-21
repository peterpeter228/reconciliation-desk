# QBO XLSX namespace compatibility: local technical triage

Verified 2026-10-21 against the production importer and installed SheetJS 0.20.3.
This fixes a false epoch conflict. It does **not** make the captured native QBO
XLSX acceptable: its control rows contain formulas, which remain rejected.

## Independent before-patch reproduction

Observed before editing `src/ingestion/xlsx.ts`:

1. A newly generated, values-only two-row workbook with a standard `workbookPr`
   inspected successfully, with `date1904: false`.
2. Adding only the observed x15 chart-tracking extension made that same workbook
   fail with `XLSX_DATE: Workbook date epoch is invalid or ambiguous.`
3. The untouched QBO file also failed with `XLSX_DATE`.
4. A diagnostic **in-memory copy**, removing only its x15 property element, then
   failed with `XLSX_FORMULA`. No original file was changed or accepted, and no
   formulas were removed.

The guard stripped namespaces before counting `workbookPr`; it mistook the
standard date properties and non-date x15 metadata for duplicate epoch nodes.
A second independent test establishes why simply ignoring all x15 properties
would be unsafe: SheetJS strips prefixes too and accepts an x15 `date1904="1"`
as an override. The production guard rejects that shape.

## Narrow patch

- Track scoped element namespace URIs, including inherited/default namespaces,
  rebinding and sibling restoration. Reject reserved/invalid namespace bindings.
- Require standard workbook properties to be the sole direct child of a matching
  standard workbook root (OOXML transitional or strict namespace). Duplicate,
  misplaced, illegal, encoded or aliased epoch declarations remain blocked.
- Recognize only the observed empty x15 chart-tracking properties node under
  standard `workbook/extLst/ext`, extension GUID
  `{140A7094-0E35-4892-8432-C4D2E57EDEB5}` and namespace
  `http://schemas.microsoft.com/office/spreadsheetml/2010/11/main`.
  The only non-namespace attribute permitted is canonical
  `chartTrackingRefBase` with an XML boolean value. Unknown attributes, date
  overrides, child elements and non-whitespace text are rejected.
- Keep formula, active-content, relationship/hyperlink, XML structure/entity,
  ZIP integrity and allocation-budget rejection. This is not a general extension
  allowlist, schema validator or complete OOXML namespace validator.
- Bump provenance to `xlsx-local-1.2/sheetjs-0.20.3`. The preexisting Argon test's
  exact parser-version expectation was updated; its security assertions remain.

## Original-file and row evidence

Captured file:
`evidence/quickbooks-acceptance-20261021/target-transaction-journal-145.xlsx`

- 8,880 bytes; SHA-256
  `ac1b896b3377199496c67132968e8e61949f388eaa7a13c43ed52fcace95e033`.
  Hash checked before and after; original untouched.
- Standard `workbookPr` has no `date1904`, so the epoch defaults to 1900.
  B7 and B8 are shared strings `09/30/2026`, not date serials.
- Formula cells: H9=`H7+H8`, I9=`I7+I8`, H10=`H9`, I10=`I9`.
- After patch, production `inspectXlsx` rejects the original as `XLSX_FORMULA`.
  It does not emit a production matrix or normalized posting lines.

The separate fixture
`evidence/qbo-xlsx-namespace-20261021/SYNTHETIC_DERIVED_VALUES_ONLY_NOT_NATIVE.xlsx`
is independently generated from the companion public-demo CSV with numeric
amount cells and newly added inert x15 metadata. It is **not** a repaired native
XLSX and is not evidence of native-XLSX round-trip acceptance. Its matrix retains:

- Sheet1, A1:I14, 14 physical rows and 9 columns; epoch false.
- Rows 1–3 preamble, row 4 blank, row 5 headers, row 6 group 145.
- Rows 7–8 posting lines, row 9 group total, row 10 overall total.
- Rows 11–13 blank; row 14 exact report timestamp text.
- Original generated-fixture byte hash, sheet name and source physical row.
  Raw row encoding preserves cell addresses/types/values/number formats.
  It neither creates a per-line transaction ID nor claims group normalization.

The dedicated suite also tests numeric date cells at both epochs, yielding
`2026-09-30` without timezone conversion. Its direct SheetJS calls demonstrate
parser behavior only: they do not execute formulas or make network requests.

## Executed checks

- `npx vitest run tests/qbo-xlsx tests/xlsx tests/argon-xlsx`:
  **163 passed**, 3 files, including 58 new namespace/native/derived-matrix tests.
- `npm run typecheck`: **passed on the final 58-test code**. Earlier runs were
  temporarily blocked by concurrent unrelated edits: first a not-yet-created
  QBO profile module, later `tests/ui/qbo-journal-profile.test.ts:185` CoreRow type
  mismatch. Both were resolved by the corresponding work before the final pass.
- Targeted Prettier check of production XLSX, new test and changed Argon version
  assertion: passed.
- `node --import tsx evidence/qbo-xlsx-namespace-20261021/check-namespace.mjs`:
  passed; original still rejected, original hash unchanged, independent derived
  matrix generated. Machine-readable evidence is `namespace-result.json`.

No CUA/browser actions, external model calls, credentials, external writes,
accounting-system mutation, publishing or deployment occurred in this task.
Full native XLSX, real-customer, other QBO locale/version and complete-account
coverage acceptance remain unestablished. Prefer the untouched native CSV with a
separately verified explicit profile, not silent formula removal from this XLSX.
