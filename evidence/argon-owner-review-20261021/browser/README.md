# Post-review bounded real-browser regression

## Result

**PASS for the exercised import/reconciliation/export flows. Cancellation-notice timing remains INCONCLUSIVE in this browser.** No source changes were made during this QA phase.

Real OpenAI cloud Chrome, app tab 5, 2026-10-21 13:26–13:30 UTC. Owner-private URL:
https://reconciliation-desk-private-qa.blueboot64.chatgpt.site/

Refreshed and verified actual script `index-JQp6rQcO.js`. Parent deployment: source `29a2aa8413ca452793829006139c743071e2bcf4`, deployment `appgdep_6ad8bd7195c881919c712e5333125219`, successful 13:26:19 UTC. Parent reported 639/639 source tests in 22 files plus type/format/build/artifact checks; those checks are separate from this browser evidence.

## Actual browser observations

1. **Manual CSV:** fresh Import retained manual default. The three saved tiny synthetic files validated 1 ST / 1 QB / 1 bank rows, reconciled and produced `manual-evidence.json`. Source hashes match. No native profile metadata appeared. No month-end balance verification appeared.
2. **Unchanged native QBO CSV:** explicitly selected native profile, entered `Craig's Design and Landscaping Services`, and supplied the original `target-transaction-journal-145.csv` without manually adding IDs. Validated two QB posting lines. Eight disabled fixed column selectors showed the actual columns, not an unmapped placeholder. The card showed header 5, 6 nonempty records after header, 2 normalized lines, 11 non-posting rows and $900 debit/$900 credit. Expanded physical classifications retained preamble 1–4, group identity 6, group total 9, grand total 10, blanks 11–13 and timestamp footer 14.
3. **Settings invalidation:** after native validation, changed expected company to `Wrong synthetic company`. Validation passed disappeared, Reconcile disabled and REPORT_SETTINGS_CHANGED appeared. Correct company plus renewed semantic confirmation/revalidation recovered. No stale result was used.
4. **Original native XLSX:** selecting unchanged `target-transaction-journal-145.xlsx` refused formulas/defined names even with cached values. Previous accepted CSV remained named, but confirmation and validation were invalidated and reconciliation disabled. No formulas were stripped, no original workbook rewritten, and no successful native-XLSX claim is made.
5. **Native CSV run/export:** revalidated the retained CSV explicitly, reconciled and downloaded `native-csv-evidence.json`. It preserves source hash, transaction ID 145 distinct from Num RDCE641C900E, detail physical rows 7/8, all eleven exclusions, $900 debit/$900 credit, `coverage_confirmed:false` in QBO manifest and overall controls, `conservation_ok:true`, zero accepted allocations. Desk says Scope unconfirmed and both accounts Activity only.
6. **Separate values-only XLSX:** uploaded `SYNTHETIC_DERIVED_VALUES_ONLY_NOT_NATIVE.xlsx`, a prior separately generated fixture from the companion public-demo CSV, not a sanitized original workbook. It has the standard SpreadsheetML namespace, standard workbookPr and inert x15 workbookPr metadata, no formulas. Sheet1 validated two rows with correct bindings/counts, then reconciled and downloaded `values-only-xlsx-evidence.json`. Transaction identity, physical row classifications, $900 totals and false coverage match the CSV semantics. Its file/row hashes differ correctly because it is a different physical file.

Screenshots: `01-manual-validation.jpg`, `03-native-bindings.jpg`, `04-original-xlsx-formula-refusal.jpg`, `05-values-only-xlsx-bindings.jpg`, `06-values-only-scoped-controls.jpg`. Raw returned text states: `browser-observations.json`.

## Bounded cancellation attempt: INCONCLUSIVE

One attempt used an 8,160,949-byte / 12,000-row temporary synthetic ST CSV, then immediately selected the native profile. Subsequent DOM and screenshot showed no retained uploaded file, no pending reading UI, disabled reconciliation, and **no explanatory cancellation notice**. There was no intervening observation establishing that the read was actually pending before the settings change, so this is not proof that the notice failed during a pending read. No worker delays, application-state mutation, event interception or repeated timing probes were used. Source inspection did not establish a concrete notice-clearing defect. No patch was made and no real-browser race/notice pass is claimed. Deterministic source tests cover those pending-read branches separately.

`02-cancellation-attempt.jpg` records the actual outcome; `cancellation-fixture-description.json` records fixture hash/shape. The large temporary CSV was neither reconciled nor copied into the evidence package.

## Reproducible artifact assertions and limitations

Run `python3 evidence/argon-owner-review-20261021/browser/check-browser-evidence.py`. `evidence-check.json` records passed assertions for all three actual downloads, exact source hashes, native IDs/counts/control totals/exclusions, conservative coverage and the unchanged original workbook hash. Downloads are unedited browser outputs.

The companion ST fixture intentionally has no successful-payment status: its $900 is retained with UNSUCCESSFUL_PAYMENT_EXCLUDED, not eligible gross receipts. The bank companion is $900. These files do not prove a match to the fee journal. The manual-import evidence flag `synthetic:false` means “not the built-in demo,” not real customer data; all data used here is synthetic/public sample data.

A bounded console sample had 169 extension-origin messages and zero non-extension errors/warnings. This is not network-egress instrumentation. This phase does not independently exercise adversarial CSV text/originalBytes API mismatches or forged journal-proof objects through UI, and does not replace source tests for those boundaries.

No new QuickBooks writes, accounts, external review calls or credentials occurred. QBO tab 6 was untouched; app tab 5 retained and browser ownership released to parent. No mobile/PDF or broad unrelated flows were added.
