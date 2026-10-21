# Sanitized evidence summary for a static review

Evidence is historical execution evidence recorded by the implementation/browser workers, not tests or browser operations performed by Argon or by this packet-preparation step. The selected source and evidence records were checked against the GitHub main tree at commit 44b996e74aa718d7276b325157204cf624af7f12. A selected-file packet is not the full repository.

## Saved verification results

- final-tests.txt records npm test: 529 tests passed in 19 files after the final UI correction.
- final-typecheck.txt, final-format.txt, final-build.txt and final-artifacts.txt record successful TypeScript, formatting, production build and artifact checks. Artifact checks are static and do not establish deployed headers or absence of all data egress.
- ui-display-tests.txt records 15 focused source UI tests passed in 2 files. Those tests use jsdom and real parsers with mocked worker transport; they are not real-browser proof.
- browser-report.md separately records real cloud Chromium acceptance initially about 12:21–12:28 UTC and final display-correction acceptance about 12:31–12:32 UTC on 2026-10-21. This packet includes the summarized claims and source hashes, not screenshots or raw browser financial evidence.

## Recorded real-browser outcomes

- Manual mapping is initially selected. Native Transaction Journal profile is opt-in, unavailable under QBD, and switching back to QBO resets to manual.
- Missing independently reviewed report company name blocks validation even when the local company namespace is populated. Correct name permits 1 ST / 2 QBO / 1 bank normalized rows. Company changes invalidate success immediately; a wrong name rejects.
- Explicit header row 6 is not silently changed and fails the required row-5 schema. Explicitly correcting to row 5 recovers. Profile changes invalidate accepted results and retain the physical header selection.
- The unchanged official public Sample Company CSV is accepted under the explicit profile. Its group ID 145 remains distinct from journal Num. Detail lines retain physical rows 7 and 8, group row 6, group-total row 9, report-total row 10 and timestamp-footer row 14. Debits and credits both total 90000 cents.
- The unchanged formula-bearing native XLSX is rejected with XLSX_FORMULA. No formulas were evaluated or stripped, and the rejected workbook was not accepted. The previously selected CSV remains named, but reconciliation stays disabled until explicit revalidation. This is an intentional safety boundary, not a newly discovered namespace bug.
- Final refreshed UI displays all eight authoritative fixed column bindings, 6 nonempty records after the header, 2 normalized posting lines, 11 non-posting physical rows including preamble/blanks, 90000 debit/credit cents, and per-physical-row classifications. Desk uses the same non-posting wording. Generic ST/bank labels are unchanged.
- Final Desk says Scope unconfirmed and Activity only. Coverage remains false; opening/closing balances are null; conservation holds; no allocations or fee eligibility are asserted. A fresh manual CSV import still validates without native company input.
- The final browser evidence assertion log passes. The browser report says initial and final financial/control payloads are byte-for-byte equal after removing only run_id. The display correction did not alter the accounting result.

## Scope, trust and compatibility limits

- All financial examples referenced by tests are synthetic or the official public Sample Company teaching transaction. No real customer ledger, raw native CSV/XLSX/XLS export, screenshot, normalized raw financial download, credential, or unrelated project file is attached.
- Several tests intentionally read local evidence fixtures which are omitted from this external review packet. Their omission is not a missing-repository-file defect. Test code is provided unchanged for static inspection; this packet is not a standalone executable checkout.
- Companion browser ST input lacks a successful-payment status. Its amount is conserved but excluded from eligible cash with UNSUCCESSFUL_PAYMENT_EXCLUDED. It does not establish a fee-journal match or a successful cash reconciliation.
- The XLSX namespace fix distinguishes standard workbook properties from one narrow inert x15 chart-tracking extension. It must still reject date-epoch overrides, malformed namespace bindings, active content and formula cells. Independently generated values-only workbooks demonstrate only that separate supported path, not acceptance of the original formula-bearing native workbook.
- Exact-posting matching never proves period completeness, clearing balance or full three-way reconciliation. Hashes bind local content and detect mutation; they do not authenticate the uploading institution or honest reviewer. Full customer acceptance, other locales/layouts, full-period coverage and native formula-bearing XLSX acceptance remain unestablished.
- A previous native-profile Argon dispatch had no verified receipt or usable review. Its remote outcome/billing remained unknown. It is NOT a review pass and must not be treated as an earlier endorsement of this code.
