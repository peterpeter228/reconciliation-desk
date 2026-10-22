# Local workflow acceptance record — 2026-10-22

## Verified local checks

- 689 TypeScript tests across 29 files passed (`vitest.txt`). The earlier baseline was 638 passed / 1 UI async-wait failure; intermediate runs exposed stale historical-rule fixture expectations and obsolete native-XLSX UI expectations. These were corrected without mutating historical accounting evidence or accepting legacy approvals.
- TypeScript compilation and production build passed (`build.txt`).
- 33 Python reference tests passed separately (`python-reference.txt`), not additive independent coverage.
- Formatting and static artifact checks passed. The latter is not a security guarantee.
- Actual engine output, not a fabricated accepted group, drives `tests/review/current-case-flow.test.ts`: supported synthetic case → two-line fee approval/export → saved project → recomputation with stable action/history and revoked approval → duplicate export blocked.
- `tests/ui/current-case-lifecycle.test.tsx` prevents a pending async draft from restoring an unmounted/cleared case. This is a component regression, not browser proof.

## Audit fixes included

1. Full-period expense coverage is explicitly recorded against a reviewed ledger document; account selection does not invent coverage.
2. OTHER_CASE exclusions require a different bound case and known source/document reference; arbitrary labels are rejected.
3. Additional same-case postings, including alternate expense accounts, partial fees and reversals, block automatic fee-only output.
4. UF reviewed instructions require actual reviewed account types, payment status, netted-fee evidence and coverage. Candidate workpapers remain available.
5. Async operations cannot commit/download after case unmount; current sources/facts are rechecked before approval/export.

## Fixtures and limitations

The `fixtures/` project contains only synthetic normalized rows and synthetic reviewer documents. JSONL sources are explicitly not native provider exports. They allow repeatable case-review mechanics; they do not prove customer demand, actual institutional provenance, or real QuickBooks acceptance. The saved fixture is not approved and requires fresh exact-line approval in the UI.

Original source bytes remain outside the saved review project. Preserve them independently. Local integrity is not document authenticity, reviewer authentication or a shared cross-device duplicate registry.

Native untouched workbook controls are separately documented in `../handoff-ingestion-20261022/`. Current real-browser checks are recorded separately when completed. The prior owner-private deployed site is not automatically updated. No real accounting write, account connection, external paid-model call or public deployment was performed in this milestone.
