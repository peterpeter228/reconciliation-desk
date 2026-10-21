# Argon issue 1.3: namespace/profile hardening

Verified locally on 2026-10-21 against the assigned reviewed source
(`44b996e74aa718d7276b325157204cf624af7f12` reference) and installed SheetJS 0.20.3.

## Finding and severity

**Confirmed low-risk accepted-input/profile gap, not a newly established
parser-differential exploit.** Both the original guard and SheetJS accepted the
reported foreign-prefixed `c`/`v` shape, a foreign-prefixed `sheet`, and foreign
namespaces on `Relationship`, `Override`, and `Default`. They produced the same
synthetic value, 900. Inert package metadata placed in a worksheet was ignored
by SheetJS and previously accepted by the guard.

A foreign `[Content_Types].xml` root was already rejected by SheetJS and therefore
by the importer as `XLSX_PARSE`; the patch rejects it earlier with
`XLSX_XML_UNSUPPORTED`. This is not a previously successful end-to-end bypass.

`reproduction.json` records 13 source-hashed before/SheetJS/after observations.
The baseline is an untouched copy of `src/ingestion/xlsx.ts` preserved before
editing, with SHA-256
`ffb8677372030b07261d09845dfc6ca43ed4b1831e9a41b7702d930527925351`.
It is loaded with the same installed dependencies and current local shared
helpers; no dependency is fetched. The final production file hash is
`65843cbb68de889596733799a1f9872a6812fcc74a82b8ffde369d4c3748debf`.

No formula execution, exfiltration, external request exploit, epoch bypass, or
allocation-budget bypass was established. Existing local-name formula and
active-content guards remain intentionally conservative and were not weakened.

## Narrow patch

- Spreadsheet data elements must resolve to the existing transitional or strict
  SpreadsheetML namespace in a workbook, worksheet, shared-string, or consumed
  data-container context. Prefix spelling is not trusted.
- SheetJS also reads `sheetData` under unrelated roots. Applicable ancestor
  containers are therefore checked, without allowing the outer root's role to
  override an inner data container's role.
- Cell/shared-string `v` and `t` namespace checks are scoped to their aggregates,
  not imposed globally on unrelated DrawingML `a:t` or chart `c:v` elements.
- OPC relationship parts must occupy the standard `_rels/.rels` or
  `.../_rels/<part>.rels` locations and have a `Relationships` root in the OPC
  relationships namespace. `Relationship` must be its direct child in that
  namespace.
- Content-type metadata must be in the exact root `[Content_Types].xml` part,
  with a standard `Types` root and direct `Default`/`Override` children in the
  OPC content-types namespace. OPC namespaces remain the 2006 package namespaces
  for the tested strict SpreadsheetML variants.
- The prior workbookPr/x15 policy and its specific invalid-epoch diagnostic are
  retained. Unknown or conflicting epoch extensions are not newly allowed.
- Provenance changes to `xlsx-local-1.3/sheetjs-0.20.3` because the accepted input
  boundary changed. Only the exact parser-version expectations were updated in
  the existing QBO and Argon package-metadata tests.

This is **not a complete OOXML/OPC schema validator**. It does not resolve and
validate every relationship target or validate every extension, style, drawing,
required element, and document schema. It does not claim general strict-OOXML,
Excel-version, or real-customer compatibility.

## Regression preservation and honest intermediate results

The first patch run had **162/163 passing**: the preexisting 500,080-cell budget
fixture omitted `xmlns` on its synthetic worksheet root. The new earlier
namespace gate correctly rejected it before its expected cell-budget failure.
With explicit parent authorization, only the standard namespace was added to
that fixture. Its 500,080-cell construction and exact `XLSX_CELL_LIMIT` assertion
are unchanged. Separate new tests explicitly reject missing namespaces.

A subsequent draft used root-first context selection. Review found that a
`workbook` wrapper could mask a consumed `sheetData` context. Before finalizing,
that precedence was corrected and prefix-only cases were added so descendants
retain valid namespaces and cannot conceal a missing parent check.
`context-matrix.json` crosses six wrapper roots with foreign-prefixed
`sheetData`, `row`, `c`, and `v`: SheetJS reads 900 in all **24** cases; the final
guard rejects all 24 with `XLSX_XML_UNSUPPORTED`.

The 66 new tests also preserve both supported SpreadsheetML namespace URIs,
both date epochs, custom number formats, shared strings, inline/rich-text
strings, standard `xml:space`, and a linked DrawingML text shape. Existing tests
continue to cover namespace-prefixed content-type metadata, standard sheet
`r:id`, unused binary default declarations, and observed x15 chart metadata.

## Final executed evidence

All commands use installed local executables:

```sh
node node_modules/vitest/vitest.mjs run tests/qbo-xlsx tests/xlsx tests/argon-xlsx
node node_modules/typescript/bin/tsc --noEmit
node node_modules/prettier/bin/prettier.cjs --check src/ingestion/xlsx.ts tests/qbo-xlsx/workbook-properties.test.ts tests/xlsx/xlsx.test.ts tests/argon-xlsx/package-metadata.test.ts tests/argon-xlsx/namespace-scope.test.ts
node --import tsx evidence/argon-owner-review-20261021/namespace/reproduce.mjs /path/to/untouched-reviewed-xlsx.ts
```

- **229 tests passed**, four files: original 58 QBO + 65 Argon package-metadata +
  40 XLSX tests, and 66 new namespace-scope tests (`targeted-tests.log`).
- TypeScript: **passed**, exit status 0 (`typecheck.log`).
- Targeted Prettier: **passed** (`format.log`).
- Patch of the owned production file: `xlsx.patch`.
- Untouched native QBO XLSX: 8,880 bytes; SHA-256
  `ac1b896b3377199496c67132968e8e61949f388eaa7a13c43ed52fcace95e033`;
  still rejected as **XLSX_FORMULA**. No formulas were stripped or cached values
  trusted; no successful native-XLSX matrix or posting acceptance is claimed.

An earlier `npx` attempt triggered a denied npm-registry tooling request. It was
not retried; final verification used the installed executables directly. No
browser, remote model, key/credential, accounting write, or deployment was used
in this scoped investigation. Aggregate project validation is owned separately
by the parent; these focused results do not claim a full-project or browser pass.
