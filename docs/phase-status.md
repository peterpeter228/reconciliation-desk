# Implementation status — 2026-10-21

Started 09:21 UTC (17:21 UTC+8). This is a private, file-only USD pilot, not a live
accounting service. The original 18-hour specification is a target, not proof of
completion, market demand or permitted external financial actions.

## Source and repository

- Original 41-file kit recovered; 40 original manifest entries verified.
- Source kit committed and GitHub main/tree independently reread at
  `98c144f5cccfd28fe195cd19f7da511eecef9eda` (41 local Git blob hashes matched).
- The subsequent application commit is identified by its GitHub history/readback
  receipt, not by this pre-push document. No public repository or live account link.

## Actual implemented milestone

- **G1 core:** TypeScript canonical models, runtime input validation, CSV/TSV and
  strict values-only XLSX, physical provenance, typed identities, three evidence
  edges, global conflicts, bounded subset search, exact amount conservation,
  per-account balances and conservative multi-label diagnostics.
- **G2 workbench:** real local parser/reconciliation workers, explicit mapping and
  source semantics, QBO/QBD choice, sorted cases, three-source evidence display,
  supplemental evidence and scope, JSON/CSV/print workpapers. Separate synthetic
  $900 fee-only approval/export demonstration with content-bound invalidation.
- **G3 executed:** 187 TypeScript tests in 9 suites, including 74 independent
  integration tests (default + held-out seed), 40 XLSX cases, 29 ingestion/export,
  35 engine tests and 9 jsdom UI regressions. Typecheck/build/artifact checks pass.
  Original Python reference suite separately passes 33 tests. Counts are not a
  security certification or independent coverage percentage.
- **G4:** not accepted. No public launch, payment-link configuration, real customer
  trial, real QuickBooks import or rendered-browser workflow acceptance.

## Important defects discovered and fixed during implementation

- Source adapters rejected legitimate synthetic payment labels and fee-mode none.
- Noncash corrections disappeared from source control totals.
- Invalid raw-row hashes, wrong evidence-source families and future/out-of-scope
  evidence could reach the engine.
- Known deposit identities and conflicting accountant confirmations could be
  overwritten by favorable alternative evidence.
- An initial handwritten fingerprint implementation failed a known SHA-256 vector;
  it was replaced with maintained @noble/hashes and regression coverage.
- Explicitly omitted mappings were restored by automatic aliases.
- Teaching exports were insufficiently distinguished from real-book imports.
- UI approval/rebuild/export async results could race changed visible inputs.

Regression assertions were preserved; intermediate failures remain in dated logs.

## Measured performance, not a universal guarantee

- Supplied 837-row Node engine: warm p95 approximately 126.7 ms, with 22 explicitly
  unfinished search scopes; parsing and browser rendering excluded.
- Exactly 3,000 canonical rows, 3 warmups and 20 measured runs per scenario:
  identity-rich p95 304.70 ms; ambiguous/capped mixture p95 415.33 ms. The latter
  retains 90 unfinished scopes (10 ambiguous, 80 candidate-capped).
- Correctness/conservation assertions pass for every measured run. This establishes
  these Node synthetic workloads only, not browser <500ms, complete subset search,
  customer-file accuracy or accounting compatibility.

## Browser and external review boundaries

Cloud browser cannot access shell loopback. Normal Chromium could not start in the
restricted runtime; a sanctioned execution request failed during runtime startup.
Zero real browser click checks/screenshots were completed. Static contrast and
jsdom tests do not replace this acceptance. A normal-browser QA script is prepared.

A single requested Argon review attempt returned no review: local transport error,
remote receipt/billing unknown. No automatic retry. Explicit private-source batch
sharing/retry consent and a separate owner-only Sites preview consent were requested;
neither is assumed granted by this document. No external-model approval claim.

## Remaining completion gates

1. Actual browser desktop/mobile, keyboard/zoom/print/download and live network
   egress inspection; approved owner-private preview is one proposed route.
2. Complete real-file pilot inputs and reviewed account/settlement evidence, not
   just the supplied clearing-only samples. Headerless bank profiles and split
   settlements remain unsupported; missing evidence must stay unresolved.
3. Real-company accounting proposal UI and target QBO/QBD import/re-import in an
   authorized sample/backup company. Typed helpers are not equivalent to that test.
4. Optional mapping persistence/model integration, payment/fulfillment and launch
   remain separate scope and permission decisions; none is secretly enabled.

See IMPLEMENTATION_LIMITS.md and dated evidence. All raw financial data remains
local; no financial system is modified by this implementation.
