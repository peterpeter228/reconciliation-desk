# QBO Transaction Journal: explicit transaction-scoped profile

Version: `qbo-transaction-journal-v1`, 2026-10-21.

This adapter supports the narrowly observed US-English QBO **Transaction Journal**
report in UTF-8 (optional BOM), not arbitrary General Ledger, Transaction List, localized reports, or QBD
exports. It is opt-in. Manual parsing does not automatically forward-fill a group
number or discard a blank-amount row.

## Required selection

Use `parseSource(text, 'QBO', options)` for CSV or `parseXlsx(bytes, 'QBO', options)`
for an independently exported values-only workbook. Options include:

- `profile: 'qbo-transaction-journal-v1'`.
- `qboTransactionJournalCompanyName`: independently reviewed exact company label
  from the source company. The local `companyId` remains a separate namespace;
  matching a label is not authentication of the uploaded file or company.
- `dateFormat: 'MDY'`, `postedLedgerConfirmed: true`, USD and the ordinary required
  company/account/timezone/date-range context.
- Optional `headerRow` must be 5. Account classification through `accountMap` is
  still explicit; no synthetic defaults are used.
- `coverageConfirmed` must not be true. `accountBalances` must not be supplied.
  This profile cannot be used to prove account-period completeness or balances.

The native schema is exactly: blank group column, Transaction date, Transaction
  type, Num, Name, Description, Account Name, Debit, Credit. Fixed mappings cannot
be overridden or omitted. Existing bindings are allowed only when identical to
these fixed meanings. In particular, `Num` is never a transaction identity.

## Fail-closed report grammar

The company, `Transaction Journal`, `All Dates`, a blank separator, and the full
header must occupy original physical rows 1–5. A transaction consists of a unique
positive decimal group ID in column zero, at least two posting lines, and an
exact `Total for ID` control. Each posting has the same real date and nonempty
journal number within its group, the `Journal Entry` type, a nonempty account,
and exactly one positive debit or credit. The selected date range must contain
all postings. The complete group must balance, and both group control amounts
must exactly match the postings in integer USD cents.

Groups cannot interleave or repeat an ID. The final `TOTAL` must match all groups.
It must be followed by optional empty rows and one valid US-English GMTZ export
timestamp footer with a matching calendar weekday. Nonempty content after the
footer, an unsupported footer, missing controls, missing footer, an orphan row,
an unknown blank-amount row, a repeated header, or a conflicting group all block
the entire import. There is no partial acceptance. Multiple balanced journals
are supported; extra legs are preserved, never dropped, and prevent an exact
match to the approved two-line fee journal.

The narrow footer/schema deliberately reject other layouts rather than guessing.
The first official sample is not a promise that every QBO region/version emits
this profile. A new layout needs a separately reviewed adapter and fixtures.

## Provenance and control proof

Raw files are not rewritten. If original CSV bytes are supplied, their decoded UTF-8
content must match the parsed text exactly (apart from a leading BOM); mismatches
are blocked instead of assigning an unrelated file hash. Every normalized posting retains its original file
SHA-256, raw row hash, worksheet and physical posting row. Its
`transaction_id_derivation` separately records the group row and column zero,
transaction ID, raw group hash, group-total row/hash, and profile version. No
source line ID is invented. The ordinary `column_indices` deliberately does not
claim that a transaction ID appeared in the posting row.

The manifest records all group boundaries, exact posting locators, group and
report controls, terminal footer, explicit transaction-only scope, and report
company label. Mapping-version hashes bind the reviewed company label, local
company namespace, fixed schema and account mapping. Full normalized-row and
manifest payload hashes detect modifications after parsing. They do not
cryptographically authenticate the external file, report company, or reviewer.
The source bytes remain available locally for independent inspection.

## Posting match is not period reconciliation

`matchProposalJournalPosting(proposal, rows, manifests)` checks the immutable
approved proposal, a single reliable native transaction identity, the exact
number of posting legs, dates, accounts, debit/credit amounts and descriptions,
and complete unmodified report membership/provenance. Duplicate journal numbers
across transactions, missing parsed rows, extra transaction legs, and altered
proofs fail closed.

Success returns `matched: true`, `scope: 'EXACT_JOURNAL_POSTING_ONLY'`,
`periodReconciliationVerified: false`, and `clearingBalanceVerified: false`.
It does not move the AJE lifecycle to `VERIFIED_IN_QB` or establish a full
three-way reconciliation. Whole-report coverage remains false and per-account
opening/closing balances remain null.

The existing `verifyProposalInLedger` keeps its complete reviewed account-period
coverage requirements and additionally rejects transaction-profile evidence,
even if a caller flips the coverage flag or removes some profile metadata.
Ordinary full-ledger verification requires a direct transaction-ID source-column
locator distinct from Num. A group-derived identity without the appropriate
transaction-only proof cannot be promoted to full-ledger evidence.

## Actual evidence and the XLSX limit

The untouched official public Sample Company CSV for synthetic journal
`RDCE641C900E` parses to original rows 7 and 8, with transaction ID `145` derived
only from original group row 6. It matches the saved approved proposal exactly.
Full-ledger verification remains false. No additional posting or account access
was performed for this engineering check.

The untouched native XLSX remains **rejected**: it contains formulas in its
control-total cells. The namespace compatibility fix resolves the earlier date
epoch false positive but does not evaluate formulas or trust their cached
values. Cross-format positive tests use independently generated values-only
synthetic workbooks, not silently transformed copies of the original workbook.

Reproduce with:

```
node --import tsx evidence/quickbooks-acceptance-20261021/check-native-profile-roundtrip.mjs
```

The new result is `native-profile-roundtrip-result.json`. The earlier failed
`native-roundtrip-result.json` and its original script remain untouched as
historical evidence. Full clearing rollforward, month-end completeness, real
customer books, other QBO layouts and QBD import acceptance remain unestablished.
