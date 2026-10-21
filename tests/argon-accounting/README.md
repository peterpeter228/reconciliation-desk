# Accounting/import review regressions

These are synthetic local regressions, not a QuickBooks import certification. No financial accounts, customer records, credentials or external services are used.

## Triage and before/after evidence

- **Argon P1-2, confirmed P1:** two different transactions reusing a document number, mixed or missing transaction IDs, or a two-line match inside a larger transaction could previously produce `verified: true`. Verification now requires one nonblank transaction ID in one company/QB-product namespace and no additional supplied rows in that transaction. Missing transaction IDs remain importable, but DocNum alone cannot prove posting. The existing positive fixture now supplies real synthetic transaction and line identifiers.
- **Argon P1-3, original allegation not reproduced:** adding a 90,000-cent clearing credit to the settlement and offsetting it in another transaction was already blocked by the settlement-specific clearing sum. The pinned equation remains `1,000,000 - 910,000 = 90,000`. A separate balanced unrelated pair inside the settlement was accepted but did not change that equation or demonstrate a wrong fee. The default template is now conservatively restricted to Bank debit/Clearing credit settlement legs; compound postings require separate review. Split same-account legs remain supported.
- **Separate P2 case-scope false rejection:** an unrelated 123,456-cent clearing receipt in the supplied GL previously caused a legitimate 90,000-cent case residual to fail. Residual calculation now uses only the explicitly bound receipt and settlement transactions; supplied surrounding evidence remains approval-bound and participates in duplicate checks.
- **CSV summary handling, confirmed P1 data loss:** `Total Comfort Heating & Air,PAY-1,09/01/2026,123.45` beneath `Customer Name,Payment ID,Payment Date,Payment Amount` previously returned successful import with zero rows. It now preserves one row and 12,345 cents, including original source hash, row hash and physical locator. Names/descriptions are not summary controls merely because they begin with Total, Subtotal or Opening Balance. An independent mapped identity/date preserves the row for validation, including malformed dates. Genuine explicit controls remain auditable exclusions.
- **Argon P2-3, privacy allegation unsupported:** raw samples were already replaced rather than disclosed. Pure integers and malformed grouped numbers were incorrectly hinted as amounts. They now become `TEXT`; explicitly monetary, strictly parsed US values become fixed synthetic amount samples. Classification is low-severity type-hint accuracy, not a privacy leak.
- **Parent follow-on boundary review, confirmed direct-call verification weakness:** runtime-invalid USD/currency, validation status, signed amounts, posted flags, QB product namespaces and source provenance could previously reach `verified: true` when TypeScript types were bypassed. A runtime schema now requires USD, a supported product, actual boolean posted status, safe integer amounts with correct signed algebra, zero validation errors and valid source hash/locator/version structure. These findings were not supplied by Argon.
- **Parent release hardening:** the active fee-only rule is now the exported `FEE_ONLY_RULE_VERSION = 'fee-only-1.1'`. The validator rejects old or unsupported rule versions, and the teaching factory uses the active constant. A self-consistent approval hash from version 1.0 no longer remains usable merely because it was not tampered with; the proposal must be rebuilt and reviewed under the current rules.
- **Parent follow-on manifest boundary:** truthy string coverage, lexicographically plausible but malformed dates, stale as-of dates, unresolved required fields and an account-list string previously served as proof of coverage. Manifests now require literal `true` coverage, a supported QB source, valid SHA, posting-line grain, real ISO scope dates with valid ordering/as-of, no missing required fields and an actual account-name array, followed by exact company/product/hash/account matching.

## Scope and limitations

The candidate-case transaction subset and independently reviewed ledger coverage are distinct. This change does **not** claim arbitrary whole-month GL is eligible for automatic fee proposals: the existing conservative duplicate-fee guard still blocks any nonzero fee-account activity in supplied `postedGL`, including potentially unrelated fees. The contract lacks linkage evidence to prove those fees unrelated, so the guard was not weakened. Other journal identifiers and full supplied evidence remain part of duplicate and approval checks.

Verification still depends on complete, reviewed re-imported evidence. It cannot discover omitted source rows or authenticate a human reviewer by hashing their name. It does not query, post to, import into, or modify QuickBooks. Unsupported compound journals remain review-only. No new comparison to an engine confirmation was invented because the builder has no such parameter. Browser acceptance and target QBO/QBD import compatibility are not established by these tests.

## Executed tests

1. Before the first production patch: the initial 29 regressions produced **16 expected failures and 13 passes**. This includes the already-blocked original P1-3 example and the already-safe raw-value redaction controls.
2. Two additional CSV positive-control cases were added, then the parent direct-call review added 16 cases. Before the runtime schema patch: **13 failed and 34 passed out of 47**. Invalid debit amounts were already rejected by exact proposal matching; the 13 remaining runtime cases reproduced the new boundary defects.
3. Before rule-version enforcement, three further release tests failed while the prior 47 passed: an old version, an unsupported version and a self-consistent old-version approval. These tests now pass.
4. Before manifest validation, seven further coverage regressions failed while the prior 50 passed. All now pass.
5. Final scoped command:

   `npm test -- tests/argon-accounting/accounting-regressions.test.ts tests/import-export/exports.test.ts tests/import-export/ingestion.test.ts tests/import-export/privacy.test.ts`

   **86 tests passed in four files, including all 57 tests in this directory.**
6. Final `npm run typecheck`: **passed**.
7. Prior aggregate checkpoint, before the final runtime-schema and rule-version additions: **303 TypeScript tests in 12 files passed**, `npm run build` passed, `npm run check:artifacts` passed, focused Prettier passed, and **33 separate Python reference-kit tests passed**. These are not described as final combined-tree checks; the parent task will validate the frozen combined tree separately. Python and TypeScript counts should not be summed as independent quality coverage.

Captured raw baseline, final focused/typecheck and prior aggregate logs are retained under `evidence/argon-review-20261021/accounting/`. Log runner times use its local timezone; the review date is 2026-10-21. Baseline failures are intentional red tests, not a claim that the original entire suite failed.

## Files changed by this scoped task

- `src/export/aje.ts`
- `src/ingestion/csv.ts`
- `src/mapping/redact.ts`
- `tests/argon-accounting/accounting-regressions.test.ts`
- `tests/argon-accounting/README.md`
- `tests/import-export/exports.test.ts` (positive verification fixture migration only)
- `evidence/argon-review-20261021/accounting/*.log` (captured execution evidence)

Engine, XLSX implementation and production-account integrations were not edited by this task.
