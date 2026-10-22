# Native workbook and partial ledger acceptance

Executed 2026-10-22 in the local development workspace. Tests use the untouched
QBO public sample-company export of a synthetic journal, plus explicitly synthetic
mutations. No real customer books, QuickBooks write operations, or production
accounting acceptance were performed.

## Verified behavior

- The original `target-transaction-journal-145.xlsx` remains unchanged. Its SHA-256
  remains `ac1b896b3377199496c67132968e8e61949f388eaa7a13c43ed52fcace95e033`.
- Physical rows 7 and 8 become the only posting rows. The four formula cells
  H9, I9, H10, I10 remain inert source controls. Formula text, address, stored cache,
  and independent detail sum are retained; no formula is evaluated.
- Cache/detail consistency is arithmetic only, not proof of cache freshness or
  a complete monthly ledger. Missing cache is null/unverified, not an invented zero.
- Cached conflicts and unsupported transaction formulas prevent accounting use;
  bounded native transaction groups can be isolated without discarding unrelated
  complete groups. Quarantined transaction rows are not mislabeled as summaries.
- Generic QBO/QBD partial recovery is explicitly enabled by
  `allowPartialTransactions`. `ledgerReportScope: COMPLETE_JOURNAL` requires complete
  balanced groups; `ACCOUNT_ACTIVITY` allows legitimate one-sided account activity.
  Invalid rows without trustworthy transaction IDs remain an atomic blocker.
- Partial source coverage cannot be promoted to verified coverage. Source control
  warnings and blocked transaction IDs must be retained in the review UI/project.
- Non-native workbook formulas, active links, macros, unsupported formula metadata,
  and existing ZIP/XML safety constraints remain blocked.

See `tests.txt` for the actual scoped test result. Browser acceptance and review
workflow integration are separate parent-task gates, not established by this log.
