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
- **G3 executed:** 334 TypeScript tests in 14 suites, including the original 187 and 147
  additional post-review regressions. The original coverage includes independent
  held-out-seed integration, input/export, XLSX and jsdom UI checks. Typecheck/build/artifact checks pass.
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

Post-review fixes also gate nonfinal settlement statements, itemize refunds, keep
whole-batch refund membership, prevent cross-transaction/invalid-data posting
verification, preserve legitimate Total-prefixed business rows, and reject aliased
active workbook metadata. Fee-only rules are version1.1; stale approvals fail.

Regression assertions were preserved; intermediate failures remain in dated logs.

## Measured performance, not a universal guarantee

- Supplied 837-row Node engine: warm p95 approximately 126.7 ms, with 22 explicitly
  unfinished search scopes; parsing and browser rendering excluded.
- Exactly 3,000 canonical rows, 3 warmups and 20 measured runs per scenario:
  identity-rich p95 350.88 ms; ambiguous/capped mixture p95 441.29 ms. The latter
  retains 90 unfinished scopes (10 ambiguous, 80 candidate-capped).
- Correctness/conservation assertions pass for every measured run. This establishes
  these Node synthetic workloads only, not browser <500ms, complete subset search,
  customer-file accuracy or accounting compatibility.

## Browser and external review boundaries

Cloud browser cannot access shell loopback. Normal Chromium could not start in the
restricted runtime; a sanctioned execution request failed during runtime startup.
The follow-up reached an owner-private deployed Site and, after owner-authorized
existing-account sign-in, exercised actual cloud Chromium. Demo, evidence, native
file chooser, XLSX worksheet selection, CSV/XLSX validation and reconciliation,
synthetic approval/CSV/IIF export, date invalidation, cancellation and clearing
passed their documented checks. Two source defects were fixed: cancelled
supplemental parsing could abort a newer run; resolved header state was lost during
validation and ambiguity recovery controls disappeared. The import fix was retested
in the deployed browser. These are scoped checks, not full browser acceptance:
PDF/mobile/runtime-egress and manifest-download verification remain unverified.
Manual uploaded fixtures deliberately retain more unknown identity semantics than
the synthetic demo; matching counts are not equivalent, and conservation is true
in both. See the real-browser evidence and independent profile ablation.

The first Argon attempt returned a transport error with unknown receipt/billing.
After explicit owner approval of the private-code batch and one retry, Argon
returned HTTP200 in103.228s. Its static claims were independently reproduced,
triaged and fixed; see ARGON_REVIEW_TRIAGE_20261021.md and the final dated tests.
The fixed code was not sent for a second external review. No model certification
or browser acceptance is claimed. An owner-private QA Site was deployed after the
owner requested another acceptance attempt; authorized sign-in succeeded. No public
deployment or financial-account integration occurred. See the dated follow-up
evidence and QuickBooks acceptance packet.

## Remaining completion gates

1. Remaining mobile, print/PDF, comprehensive keyboard/zoom, download-manifest
   and runtime network-egress checks. Scoped desktop app flows passed; not all gates.
2. Complete real-file pilot inputs and reviewed account/settlement evidence, not
   just the supplied clearing-only samples. Headerless bank profiles and split
   settlements remain unsupported; missing evidence must stay unresolved.
3. Real-company accounting proposal UI and target QBO/QBD import/re-import in an
   authorized sample/backup company. Typed helpers are not equivalent to that test.
4. Optional mapping persistence/model integration, payment/fulfillment and launch
   remain separate scope and permission decisions; none is secretly enabled.

See IMPLEMENTATION_LIMITS.md and dated evidence. All raw financial data remains
local; no financial system is modified by this implementation.
