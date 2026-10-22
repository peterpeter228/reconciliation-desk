# Real-browser workflow QA — 2026-10-22

Scope: real cloud Chromium, current local source served on localhost through a native Terminal. Synthetic inputs only. No QuickBooks writes, external deployment or real customer/account data. These results do not establish production readiness or customer demand.

## Passed

1. Opened `synthetic-current-case.review.json` using the actual file chooser. The app recalculated and displayed gross $10,000, bank $9,100 and supported fee $900.
2. Downloaded the human-judgment workpaper through the UI; actual JSON retained beside this report.
3. Built the supported fee-only draft, explicitly approved exact accounts/date/amounts, downloaded actual CSV. It contains exactly fee expense debit $900 and ordinary asset clearing credit $900, no second bank debit, and a synthetic DO NOT IMPORT warning.
4. Export changed prior-import state to UNKNOWN and disabled repeat download. Saved the actual review project, cleared the in-memory workspace through the confirmation dialog, reopened the downloaded project. Stable case `case-23476b271213de4e32f764fb`, facts, evidence and export history persisted; prior approval became DRAFT and download remained disabled.
5. Opened malformed schema-999 project. Validation rejected it and preserved existing source rows, facts and UNKNOWN export history. Initial error presentation was raw schema JSON; subsequent UI-only polish requires separate smoke verification.
6. Downloaded actual UF worksheet with ST-only references. JSON status CANDIDATE, importEligible false, missing actual QB Payment IDs, explicit no-select/no-create instructions; negativeFeeCents -90000. This is not verified deposit execution.
7. Imported unmodified `target-transaction-journal-145.xlsx` using native QBO Transaction Journal profile, complete-journal scope, exact independently inspected printed sample-company name and explicit posted-ledger confirmation. Full Validate with synthetic companion CSVs yielded READY, two usable QB posting rows and debit/credit totals $900 each.
8. UI showed all four source formulas preserved, not evaluated: Sheet1!H9 H7+H8, I9 I7+I8, H10 H9, I10 I9; each stored value 900, independently derived 90000 cents, CONSISTENT. The report remained transaction-scope-only, not full month coverage.
9. Reconciled these synthetic files and downloaded saved project. Its normalized QB rows preserve transaction ID 145 derived from group row 6 and posting physical rows 7 and 8. See `native-import.review.json`.
10. App-URL-filtered console error query returned no entries. Browser extension metadata errors occurred and were not attributed to the app.

## Observations and limitations

- The initial synthetic project picker tool timed out. After verifying an unchanged empty workspace and receiving approval, one retry succeeded. No duplicate accounting operation resulted.
- One transient reset to the empty landing page occurred during the first native workbook selection after completed positive/export tests. No app exception was captured, parent confirmed source was unchanged, and the reset did not recur on the subsequent complete native import flow. Cause remains unverified; do not claim it fixed or classify it as confirmed application data loss.
- Native profile explanatory text initially incorrectly said all XLSX formulas were blocked; parent is applying UI-only correction. Header preview is deliberately insufficient for native profile until full semantic validation; this can be confusing but full Validate succeeded.
- Full-page screenshot capture timed out; bounded viewport captures and DOM evidence were saved instead. `native-journal-controls.png` captures READY2-row validation; exact formula detail is additionally preserved in downloaded project metadata.
- Browser UF reviewed-payment positive instructions, every quarantine permutation, mobile/responsive regression, and import into real QuickBooks were not exercised here. Automated domain tests are separate evidence, not substitutes for these untested browser/account-system paths.

## Artifacts

Actual downloads: `approved-synthetic-qbo.csv`, `human-judgment-workpaper.json`, `uf-candidate-worksheet.json`, `saved-after-export.review.json`, `native-import.review.json`.
Screenshots: `native-journal-controls.png`, `restored-export-guard.png`.
DOM snapshot: `restored-dom.txt`.

## Final UI-only smoke (07:33 UTC)

After explicit browser refresh, reopened the actual saved-after-export project and then the malformed fixture. New visible error: “Review project validation failed (schemaVersion, savedAt, workspace). Use a supported schema version 1 project. The current workspace was not replaced.” DOM confirms the same stable case and Prior import UNKNOWN remain. Captured `invalid-project-retains-workspace.png`.

The native-profile notice now states native CSV and guarded XLSX are supported; recognized report-control formulas are preserved and independently checked, never evaluated; posting formulas, macros and external links remain blocked. Both wording fixes verified in the real browser.
