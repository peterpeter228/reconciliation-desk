# Native QBO profile: actual-browser acceptance

## Environment and scope

2026-10-21, OpenAI cloud Chrome (real Chromium), private QA app tab 5:
https://reconciliation-desk-private-qa.blueboot64.chatgpt.site/

Initial refreshed deployment: source `01ad1850f0ca1c6e9dc7791266c5efe1865ff11e`, deployment `appgdep_6ad8ad9cef94819182cd4edfe79f7584`, browser-verified asset `index-TJ-GHt7j.js`. Tested about 12:21–12:28 UTC. The display-only follow-up passed refreshed-deployment verification below. Existing signed-in session used; no new account, permission grant, bypass, QuickBooks write, or real books used. QBO tab 6 was untouched.

## Passed in real browser

- Manual column mapping is default on fresh Import. Native profile must be explicitly selected. Native selection is unavailable for QuickBooks Desktop; returning to Online resets to manual.
- Native profile visibly explains transaction-only evidence, no clearing/month-end coverage, CSV primary, original XLSX formulas blocked, no stripping, and group identity separate from Num.
- Uploaded the **unchanged** official public-demo `target-transaction-journal-145.csv`, alongside the tiny synthetic ST/bank fixtures saved here. No transaction IDs were manually supplied.
- Missing independently reviewed company name blocks validation/reconciliation even though the local company label is filled. Exact expected printed company `Craig's Design and Landscaping Services` permits validation: 1 ST, 2 QB, 1 bank normalized rows.
- Changing expected company immediately clears Validation passed and disables reconciliation. `Different company` rejects with report-company mismatch. Correcting it permits revalidation.
- Explicit header row 6 remains row 6 and fails the native row-5 requirement. Deliberately setting row 5 recovers. A profile change invalidates the accepted result and keeps existing physical header selection. Native mapping controls are disabled, not silently remapped.
- Original native `target-transaction-journal-145.xlsx` rejects: “Formula cells and defined names are not accepted, even when a cached value exists.” No formulas were stripped. The last successfully chosen CSV remains named in the file card; the rejected XLSX is not accepted and reconciliation is disabled until explicit revalidation of that CSV.
- Native CSV reconciliation completes. Downloaded real-browser evidence contains source SHA-256 matching the unchanged CSV; 2 posting lines, transaction ID `145`, journal Num `RDCE641C900E`, group physical row 6, detail rows 7/8, group total 9, grand total 10, timestamp footer 14. Debit and credit are both 90000 cents.
- QBO manifest and overall result have `coverage_confirmed:false`; both account controls are `ACTIVITY_ONLY`, with no opening/closing balances. Conservation true, no accepted allocations or fee eligibility. The UI says Scope unconfirmed / Activity only, not a verified close.
- Fresh manual CSV import still validates 1 ST / 1 QB / 1 bank rows without native company input or native profile selection.

## Browser-found display defect and narrow correction

Initial deployed native validation showed disabled fixed mappings as “Not mapped” after a blocked preview followed by successful validation. The form's stale bindings were used rather than the validated native mapping. It also labeled 11 non-posting lines “summaries excluded,” alongside 6 “source rows,” implying incorrect compatible counts.

Source correction, with no parser/control changes:
- `src/pages/import.tsx`: show the eight authoritative fixed posting-column bindings; group identity is explained separately. Native counts read “6 nonempty records after header,” “2 normalized,” and “11 non-posting rows (includes preamble/blanks).” Show debit/credit controls and exact per-physical-row exclusion classifications.
- `src/pages/desk.tsx`: native manifest exclusions use the same non-posting description; generic/manual wording unchanged.
- `tests/ui/qbo-journal-profile.test.ts`: two regression cases exercise the exact blocked-preview/company-change path and rendered Desk labels with real parser/engine outputs. Focused suite: 15/15 across 2 files; typecheck and format pass (`ui-display-*`). These are source UI tests, not the browser evidence above.

Physical accounting: after header, the six nonempty records are 6,7,8,9,10,14. Non-posting rows are 1,2,3,4,6,9,10,11,12,13,14. Header 5 + detail 7/8 + eleven non-posting rows = fourteen physical rows. No excluded preamble, blank, identity, control, or footer is promoted to posting activity.

## Evidence and caveats

- `browser-native-evidence.json`: unchanged actual browser download, not a fabricated replay. `browser-evidence-check.py` asserts hashes, IDs, totals, physical provenance and conservative scope. Run output saved in `browser-evidence-check.txt`.
- `browser-observations.json`: actual returned browser text states. `browser-01` through `browser-09` JPGs capture company gate, native validation, mismatch, formula refusal, conservative Desk, and manual regression.
- Companion ST fixture deliberately contains no successful-payment status. Its $900 remains in conserved atoms with `UNSUCCESSFUL_PAYMENT_EXCLUDED`; eligible ST gross is $0. This is not a missing parsed row. The companion bank is $900. Neither fixture proves a match to this fee journal.
- Evidence field `synthetic:false` is the existing app's manual-import-versus-built-in-demo flag, not proof of real customer data. All data used here is synthetic/public sample data.
- A bounded console inspection captured extension-origin errors, not an app error. It is not network-egress instrumentation and cannot prove no egress.
- This check establishes narrowly supported native transaction report ingestion and honest scoped results. It does not establish full-period coverage, live-customer compatibility, general QBO report support, or successful acceptance of the original formula-bearing workbook. Prior PDF/mobile/full-flow results are not expanded by this phase.

## Refreshed display verification

PASSED 2026-10-21 about 12:31–12:32 UTC, after reload verified `/assets/index-Fhbk5JSD.js`. Site source `eeefde5fef8e7d57d9b076204bd1ba287ebba7a1`, deployment `appgdep_6ad8b075ebb4819193536f284933b267`.

Repeated the same native CSV upload with company initially absent, then independently entered company and explicit semantic confirmation. Validation produced 2 QB lines. Expanded card showed all eight disabled fixed bindings accurately: Transaction date, Transaction type, Num, Name, Description, Account Name, Debit, Credit. Displayed 6 nonempty after-header records, 2 normalized lines, 11 non-posting physical rows, and $900 debit/$900 credit. Expanded exclusion classification retained group/control/footer distinctions. Screenshots `browser-07-fixed-native-mapping.jpg` and `browser-08-physical-classifications.jpg`.

Reconciliation completed. Expanded Desk manifest showed “2 rows · 11 non-posting rows (includes preamble/blanks),” Scope unconfirmed, and both account controls Activity only. Generic ST/bank labels remained unchanged. Screenshot `browser-09-fixed-desk-manifest.jpg`. Downloaded `browser-native-evidence-final.json`; the same assertion script passes. Final run `6fb24236-6778-428a-a044-e3620e04ff72`. Initial and final evidence are byte-for-byte equivalent after removing only `run_id`, confirming no accounting data/control change from the display correction.

Source suite reported by parent after the final patch: 529/529 in 19 files; full typecheck, format, build, artifact checks passed. Our directly executed focused suite remains 15/15, plus typecheck/owned-source format. Browser work did not rely on jsdom for these final observations. CUA released back to parent; tab 5 retained, tab 6 untouched.
