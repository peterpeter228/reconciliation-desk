# Independent QBO transaction-report adversarial review

Review date: 2026-10-21. This directory contains independent tests only; the reviewer did not change production sources or contact QuickBooks, a model, or any external service.

## Evidence and claim boundaries

- `parser.test.ts` reads the original CSV and XLSX directly from `evidence/quickbooks-acceptance-20261021/`. It verifies their exact SHA-256 values before exercising the production APIs. No fixture preprocessing is used for the native observations.
- The native CSV proves the observed synthetic public-demo journal has group ID `145`, journal Num `RDCE641C900E`, two posting rows at physical rows 7 and 8, and $900/$900 controls. The group identity is independently located at row 6, column 0, and closes at row 9. It is not inferred from Num.
- The native XLSX is still blocked with `XLSX_FORMULA`: it contains formulas in group/grand-total cells. Resolving `x15:workbookPr` correctly does not authorize trusting cached formula values.
- Generated values-only XLSX, multiple groups, altered reports, four varied fee amounts, and a 20-digit ID are **synthetic adversarial/held-out cases**, not additional real QBO observations or broader compatibility evidence.
- Exact posting match has scope `EXACT_JOURNAL_POSTING_ONLY`, `periodReconciliationVerified: false`, and `clearingBalanceVerified: false`. The legacy full-ledger verifier remains false. The public-demo target did not contain the teaching receipt/deposit, and the parsed clearing activity is minus $900, not a verified zero balance.
- SHA-256 detects changes to supplied evidence; it does not authenticate the file's origin, the accounting reviewer, or the accounting completeness of an external book.

## Adversarial coverage

The tests cover missing/duplicate/interleaved/mismatched group IDs; identity taken from Num; extra blank-Num or balanced posting legs; missing/truncated/changed controls and footers; malformed dates, amounts and currency; company/title/schema/profile conflicts; unapproved posted/coverage assertions; complete multi-group membership; duplicate Num across different genuine group IDs; runtime/provenance tampering; unsupported proof versions; approval immutability; and prevention of full-period/clearing-balance promotion.

Seven cases deliberately recompute ordinary evidence digests after mutation, ensuring independent group-boundary, membership, total, account-inventory and locator constraints are still enforced.

## Review findings

1. **Fixed by the implementation worker:** stripping optional native proof markers and setting coverage true initially allowed the legacy verifier to return true. The regression also strips the row derivation markers; native mapping provenance and the absence of a direct transaction-ID column still prevent promotion. Direct identity proof cannot reuse Num's column.
2. **Fixed by the implementation worker, source-byte binding:** `parseSource` originally accepted native text alongside unrelated `originalBytes`, then bound the parsed postings to the unrelated byte hash. Two regression cases cover unrelated bytes and stale decoded text paired with a changed source. The explicit native CSV profile now requires supplied source bytes to decode as UTF-8 and match the parsed text (allowing only a leading BOM difference). Unsupported encodings and mismatched/stale text fail atomically; the XLSX byte path is unchanged.

## Reproduction

From the repository root:

```sh
npm test -- tests/qbo-roundtrip-adversarial
npm run typecheck
npm exec -- prettier --check tests/qbo-roundtrip-adversarial/*.ts
```

Native CSV SHA-256: `d8e334975acbc74cc7a0b7b9f157f8f3f39f67f18bd85769deefceec5d690234`.

Native XLSX SHA-256: `ac1b896b3377199496c67132968e8e61949f388eaa7a13c43ed52fcace95e033`.

## Executed results

- Initial combined independent suite: 109/110 passed. The one assertion expected overly specific approval-error wording; production correctly rejected changed approval content. The test expectation was corrected, not production behavior.
- Expanded intermediate suite: 121/121 passed. Repository typecheck and focused formatting check passed after a concurrent UI test typing error was corrected by its owner.
- The two additional source-byte-binding regressions first reproduced **2 failures / 59 passes** in the parser suite before the fix.
- Final frozen independent run: **123/123 tests passed in two test files**; repository `npm run typecheck` passed; focused Prettier check passed. The root task owns the subsequent aggregate/build checks and publication. No further blockers were identified in this review scope.
