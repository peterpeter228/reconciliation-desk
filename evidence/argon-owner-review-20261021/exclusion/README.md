# Argon issue 1.4: excluded-row proof integrity

Verified and fixed on 2026-10-21. Review input: `reconciliation-review/argon-owner-retry-20261021/review.md`, issue 1.4, reviewing supplied baseline `44b996e74aa718d7276b325157204cf624af7f12`.

## Finding and impact

The original matcher returned `matched: true` after a caller cleared `manifest.excluded_summary_rows` and recomputed `journalManifestDigest(manifest)`. The posting rows, amounts, approved proposal, and transaction-group proof were unchanged. Both `periodReconciliationVerified` and `clearingBalanceVerified` remained `false`.

This confirms a low-risk audit-classification integrity gap. It does not demonstrate incorrect posting amounts, a successful journal write, or an escalation to account-period/clearing-balance verification. Ordinary SHA-256 payload digests detect accidental/stale mutations but do not prevent a caller from constructing self-consistent evidence.

## Correction

`src/export/journal-posting.ts` independently requires:

- Preamble exclusions at physical rows 1–4.
- Every transaction-group header and group-total row, the grand total, and the timestamp footer in the exclusion set.
- Unique exclusion locators, disjoint from posting rows and header row 5.
- No additional excluded locators before or at the grand total. The supported grammar permits optional blank records only after that total.
- A nonempty after-header record count equal to posting count + two controls per group + grand total + footer.

Existing group-boundary, amount, provenance, approval, and full-ledger guards are unchanged. This is not a contiguous-physical-line check: CSV quoted multiline records can skip physical row numbers. Optional blanks before and after the footer remain supported.

## Red/green evidence

The new dedicated suite is `tests/qbo-roundtrip-adversarial/excluded-row-proof.test.ts`.

- Before the fix: 22 tests ran; 15 negative regressions failed because invalid metadata was accepted, while 7 valid-input controls passed. `red-excerpt.log` is a faithful excerpt captured from the earlier tool result, not a fabricated current rerun or complete raw transcript.
- After the fix: all 22 new tests passed. The combined new exclusion suite, existing posting-proof suite, and existing parser suite passed 145/145 tests. The checks are rerun and captured in `green-targeted.log`.
- `typecheck.log` records `npm run typecheck`.
- `format.log` records a Prettier check of the two changed source/test files.
- `reproduction.log` records the current fixed behavior: the unmodified report matches; clearing all exclusions and recomputing the digest fails closed, while broader verification flags remain false.
- `source-sha256.txt` records the implementation, regression suite, and reproduction script hashes associated with this evidence capture.

The 7 valid-input controls cover the unchanged observed native CSV, synthetic multiline CSV/multiple groups, zero/one/four optional blank rows around the footer, a controlled generated values-only multi-group XLSX, and exclusion-set ordering. The XLSX control is not evidence that native formula-bearing exports are accepted.

## Reproduce

From the project root:

```sh
node --import tsx evidence/argon-owner-review-20261021/exclusion/reproduce-exclusion.mjs
npx vitest run tests/qbo-roundtrip-adversarial/excluded-row-proof.test.ts tests/qbo-roundtrip-adversarial/posting-proof.test.ts tests/qbo-roundtrip-adversarial/parser.test.ts
npm run typecheck
npx prettier --check src/export/journal-posting.ts tests/qbo-roundtrip-adversarial/excluded-row-proof.test.ts
```

## Limits

The manifest does not retain an independent complete inventory of blank source records. Without original source records, the matcher cannot prove that every optional blank after TOTAL is listed, reject every invented optional trailing-blank locator, or reconstruct a full physical-row complement. It must not manufacture missing physical rows from numeric gaps. These changes validate the mandatory and mutually disjoint classifications that the existing proof actually supports.

Input file/row/payload hashes are consistency bindings, not authentication that a file originated from QuickBooks. A wholly fabricated but internally consistent report cannot be excluded by these checks alone. No real customer books, external model requests, keys, browser actions, deployment, or accounting-system writes were involved. Full-suite checks and publication belong to the parent task and are not asserted by this evidence package.
