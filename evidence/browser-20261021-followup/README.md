# Real-browser acceptance follow-up

## Current verdict

Real cloud Chromium reached and exercised the owner-private Site after explicit
approval to use the owner's existing ChatGPT sign-in. This is real browser
coverage, not jsdom. The original [login gate](private-site-login-gate.jpg) was
resolved without a password, new account, persistent grant prompt or bypass token.

Target: https://reconciliation-desk-private-qa.blueboot64.chatgpt.site/

The browser run proved the scoped demo, upload, evidence, approval, export,
cancellation and reset flows below. It found a genuine blocking upload-validation
defect, which was narrowly fixed and retested successfully in the deployed app.
The latest source suite passes 334 tests. This is a scoped pass, not unqualified
full browser acceptance, production launch or acceptance by QuickBooks.

## Actual browser coverage

- [Nonblank application](01-app-empty.jpg): title Reconciliation Desk, no Vite
  overlay, desktop DOM width equals scroll width.
- [Baseline demo](02-baseline-demo.jpg): $242,360.14 source receipts, largest-first
  review queue. Actual downloaded `baseline-browser-evidence.json` has 24,236,014
  cents, conservation true and the three expected source hashes.
- [$20k before evidence](03-missing-settlement.jpg): missing settlement, not a
  confirmed processor hold. Absence is explicitly not proof of a cause.
- [Source provenance](04-source-provenance.jpg): physical QB row 308, file hash,
  row hash and normalized source details visible.
- [Supplemental evidence](05-hold-supported-not-confirmed.jpg): $20k hold becomes
  SUPPORTED, not CONFIRMED; missing bank and processor-release coverage remains.
  Repeated sample-evidence load is disabled. Actual downloaded enhanced evidence
  has eight source files, unchanged source receipts and conservation true.
- $50k bridge is $47,000 minus $3,150 fees plus $6,150 outside receipts. No
  import-ready main-run adjustment is falsely enabled; bank/expense proof is
  still required, and all main-run fee eligibility flags remain false.
- [Independent fictional $900 fee approval](06-approved-synthetic-fee.jpg): both
  formats disabled before explicit name, attestation and approval. Actual browser
  CSV and IIF downloads contain only the $900 fee debit/clearing credit, not a
  second bank deposit. UI says exported, not posted. The separately triggered
  approval-manifest download was not independently retrieved or verified.
- [Approval invalidation](08-native-date-invalidated.jpg): changing the date
  through the native calendar resets the proposal to draft, unchecks attestation
  and disables exports. A locator `fill` initially changed the date input without
  committing React state; [07](07-date-fill-uncommitted.jpg) is an automation
  caveat, not evidence of successful state change or a proven application defect.
- [Unsupported file error](09-file-error.jpg): selecting synthetic invalid.pdf
  through the actual file chooser showed the expected type error and kept
  reconciliation disabled.
- [Multi-sheet XLSX](10-xlsx-selection-state.jpg): Payments and Read me appear;
  neither is silently selected/combined. CHOOSE_WORKSHEET blocks reconciliation
  until an explicit Payments selection.

## Browser-found upload blocker and source fix

[Before-fix browser screenshot](11-import-validation-blocked.jpg): after selecting
Payments, adding QBO clearing GL and bank CSVs, filling the synthetic scope and
explicitly confirming semantics, Validate files returned “Ambiguous header rows”
for all three inputs. Reconciliation stayed disabled, but the header-recovery
controls disappeared because mapping was null.

`src/pages/import.tsx` was passing approved column bindings into validation without
the already-resolved physical header row. Candidate scoring could consequently
credit the bindings to ordinary data rows and create artificial ambiguity.

The fix preserves the resolved row through preview, worksheet selection and
validation, respects explicit overrides, removes the silent row-1 fallback, and
keeps manual recovery available when no mapping resolves. Header reload is
disabled while a required XLSX worksheet has not been chosen. The parser and its
ambiguity rules are unchanged.

`tests/ui/import-validation.test.ts` exercises CSV validation, selected multi-sheet
XLSX validation, explicit row override and ambiguous-header recovery using the
real parsers through mocked worker transports. All four fail against the earlier
source and pass after the fix. These are source UI tests, not browser-worker proof.
See `import-regression-before.txt` and `import-regression-after.txt`.

## Deployed retest and remaining workflow checks

The refreshed Site served `index-Bx7ddThs.js` from private deployment
`appgdep_6ad8a196b9a88191871ad20e184d3c7e` (source
`3c2dde8b25a6a9402e0de1e238227393b4572b74`).

- [Exact upload flow passed](12-import-validation-passed.jpg): selected Payments,
  then 359 ST, 338 QB and 140 bank rows validated. Reconcile became enabled.
- [Uploaded reconciliation completed](13-upload-reconciliation.jpg) at $242,360.14
  with conservation true. Actual `upload-browser-evidence.json` was downloaded.
- [Cancellation](14-cancel-preserves-result.jpg) left the existing uploaded result
  unchanged. Two subsequent completed sample resets each returned 221 cases and
  the same gross, rather than accumulating results.
- Keep workspace cancelled clearing without losing the result. A later explicit
  confirmation [cleared the in-memory workspace](15-workspace-cleared.jpg),
  returning to empty state; downloaded/selected files were not deleted.

## Manual import is not equivalent to the synthetic demo

The manual run has 416 groups and zero allocations, versus the demo's 221 groups
and 36 allocations. Do not present upload completion as matching-equivalence
acceptance. `compare-import-profiles.ts` independently replays the real parsers and
engine in the source environment; `import-profile-comparison.json` reproduces
both observed counts exactly. The exact selected workbook is preserved as
`synthetic-upload-multisheet.xlsx`, so the replay needs no external fixture path.
This diagnostic replay is not browser proof.

Both browser downloads agree on all scalar controls: ST positive 24,236,014,
refunds 154,326, corrections -84,396, QB debits 24,236,014, QB credits 21,975,512,
and bank signed activity 21,564,869 cents. Conservation is true in both. Normalized
row counts are 359 / 338 / 140, with physical header row 1 in all three sources.
The QB/bank file hashes match exactly; XLSX has a different container hash from ST
CSV, as expected. No manual main-run fee draft is eligible.

The configurations are deliberately different:

- Demo uses `synthetic-v1`, `SYNTHETIC_DEMO` / `DEMO_BANK`, known bank GL name
  `Collections Checking`, and `clearing_split_semantics_confirmed: true`.
- Manual upload uses `manual`, `SYNTHETIC_QA` / `Synthetic checking`, explicit
  ServiceTitan Clearing asset mapping, MDY, positive inflow convention,
  `clearing_split_semantics_confirmed: false`, and no bank GL account list.
- Both have America/New_York, September 1–30 2026, as-of September 30, PAYMENT
  grain, JE_TO_CLEARING and explicit coverage/posting confirmation.
- Synthetic-only normalization infers 192 QB deposit links, 203 QB batch IDs,
  132 bank deposit IDs and 57 fee roles. Manual normalization infers none of these
  IDs, treats those 57 rows as clearing settlement lines, and leaves all 359 ST
  export-status bases UNKNOWN rather than SYSTEM. Those are real semantic
  differences, not missing money or an XLSX row-count discrepancy.

An independent ablation review confirmed that CSV versus XLSX does not cause the
difference. Manual CSV and XLSX both produce 416/0; synthetic CSV and XLSX both
produce 221/36. Restoring fixture-only inferred identities and fee roles yields
221/24, and adding the demo split configuration yields 221/36. Those 36
allocations represent 18 accepted partial groups, not 36 complete three-way
matches. No additional parser defect was found. The manual path remains
conservative; no rules were weakened to force matching counts. See the separate
`profile-ablation/README.md` and `profile-ablation/results.json` independent review.

## Earlier cancellation race fix

A deterministic deferred-parser regression found that stale supplemental work
could abort a newer reconciliation worker after cancellation. `src/app.tsx` now
checks operation tokens before touching the current AbortController and after
supplemental parsing. The source regression verifies no stale abort or extra run.
See `source-regression-before.txt` and `source-regression-after.txt`. This does not
substitute for a controlled browser race-timing test. The ordinary browser
cancel/reset path subsequently passed, as described above.

## Latest executed source checks

- Full Vitest: 334 passed in 14 files.
- TypeScript, production build and formatting: passed.
- Static artifact scan: 16 files; answer key absent; credential pattern no match.
  This is not a runtime network-egress or deployed-header guarantee.
- Built application asset: `index-Bx7ddThs.js`.

Logs: `import-full-vitest-after.txt`, `import-typecheck-after.txt`,
`import-build-after.txt`, `import-artifacts-after.txt`, `import-format-after.txt`.

## Remaining scope and limitations

- Print was attempted: the app created its print-summary DOM, but neither its
  button nor native Ctrl+P produced an observed print dialog. No rendered PDF was
  obtained, so print-layout/PDF acceptance remains unverified.
- Mobile was not tested: no viewport API is advertised; a native corner-resize
  attempt left the actual DOM width at 1165 pixels. Desktop width fit passed;
  that is not mobile acceptance.
- A scoped console query returned 149 warning/error records, all from the browser
  extension content script and none from the app origin. This is a captured-log
  observation, not proof of absence of every possible runtime error.
- Runtime network egress was not instrumented; the supported browser API does
  not expose network-request events. Static privacy scans are not network proof.
- Approval-manifest download was not independently retrieved. No actual QBO/QBD
  accounting import or posted-GL verification was performed in this app QA task.

Only synthetic inputs were used. The manual upload's JSON `synthetic: false`
means the app's non-demo workflow flag, not that real customer data was used.
No live books, financial posting, or public deployment was performed. No denied
local-browser launch, sandbox/security bypass or uncertain file-chooser retry
was attempted. App tab 5 was retained; browser ownership returned for the
separate QuickBooks acceptance work.
