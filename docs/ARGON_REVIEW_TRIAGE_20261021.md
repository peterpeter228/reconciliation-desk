# Argon review triage — 2026-10-21

## Scope and evidence

Argon returned a static review of 45 source/test/specification files on the owner-
authorized retry. Request: gemini-4-argon-high; provider-reported model version:
gemini-4-argon. Receipt: 103.228 seconds, HTTP 200, 107,299 reported tokens. Actual
price and upstream model identity are not independently verified.

Input identity: `evidence/argon-review-20261021/input-manifest.json`. Raw output is
preserved unchanged. That input excluded the UI and preceded final formatting/
some local hardening; omission from the packet does not mean UI code was absent.
The current implementation baseline is GitHub e1376bfcdb2b672f8df7dd98f41671e728139d44.
No paid follow-up model call is implied by the review, fixes or this document.

## Evaluation principles

- “Confirmed” in model text means a static model claim until reproduced locally.
- The model's blanket “no vulnerability” wording is not accepted as certification.
- Unsupported split settlements must stay fail-closed; a shared deposit number
  alone is not permission to aggregate money or consume source records twice.
- Missing transaction identity in a re-import cannot prove journal linkage.
- Scheduled versus actual settlement date is not a universal chronological rule;
  realized fees need appropriate completed-status evidence, not pending estimates.
- Keep raw model claims, local reproductions, patch decisions and residual limits
  separate. Do not weaken assertions to make the suite green.

## Final finding decisions

| Model item | Independent decision | Applied change / evidence |
| --- | --- | --- |
| P0-1 split bank settlement rejected | Not P0; known unsupported, fail-closed path, no accepted allocation | Preserve refusal, add regressions. Shared deposit IDs are not sufficient authority to aggregate |
| P1-1 pending/unknown statement used as final fee | Confirmed P1, fixed | Only appropriate completed status supplies realized fee/cash evidence; actual date cannot exceed observation date. Early settlement relative to schedule remains allowed |
| P1-2 reused DocNum across transactions | Confirmed P1, fixed | Require one nonblank transaction ID in one company/QB-product namespace; inspect all supplied lines for that transaction, including blank/other Num; missing identity remains unverified |
| P1-3 claimed arithmetic bypass | Original reproducer already blocked, not a demonstrated wrong fee | Unsupported balanced compound settlements now require review; unrelated surrounding GL remains bound to approval; case residual uses the two bound transactions |
| P2-1 refund confirmation reused | Confirmed, fixed | One diagnosis per group; each refund needs terminal evidence and its own refund_payment_id attestation. Partial/contradictory coverage cannot confirm all refunds |
| P2-2 OOXML aliases | Confirmed values-only import-profile gap, not observed network exfiltration | Reject noncanonical Relationship/Override/Default metadata, retain valid sheet r:id/namespaces; parser version 1.1 |
| P2-3 numeric preview disclosure | Data-leak claim unsupported; low-severity type-hint issue corrected | Original raw values were already replaced. Pure integers and malformed grouped numbers no longer masquerade as monetary samples |
| Observation: refunds omitted from receipt batch | Confirmed, fixed | PAYMENT and documented REFUND membership assessed together; partial matching cannot omit the refund leg |
| Observation: Total Comfort row excluded | Confirmed P1 data loss, fixed | Valid business identities/dates prevent summary-label exclusion; malformed business rows go through validation, not silent disappearance |

Additional independent follow-ons, not attributed to Argon:
- Valid case residual was falsely rejected by unrelated clearing activity in a
  larger supplied ledger. Residual is now explicitly case-scoped; surrounding
  evidence remains approval-bound and participates in duplicate checks.
- Direct helper calls bypassing TypeScript could falsely verify runtime-invalid
  rows or manifests. Currency, actual booleans, exact safe-integer algebra, QB
  namespace, validation status, source locators/hashes and reviewed ISO coverage
  are now validated at the verification boundary.
- Current fee-only rule version is fee-only-1.1. Old/unsupported versions and even
  self-consistent old approval hashes require rebuilding and fresh review.

## Reproduction and validation

- Engine scope: 10 original red cases reproduced before patch. Final new suite
  contains 20 cases; combined engine plus independent integration passes 129.
- Accounting/import scope: initial 29 cases yielded 16 failures and 13 passes;
  subsequent runtime-row boundary tests reproduced 13 failures, manifest tests
  reproduced 7, and stale-rule tests reproduced 3. Final scoped suite passes 86,
  including 57 new cases. Captured logs and exact decisions are in
  [accounting regressions](../tests/argon-accounting/README.md).
- XLSX scope: 65 new cases plus 40 previous cases pass. Direct SheetJS differential
  tests distinguish ignored malformed elements from interpreted aliased attrs;
  no actual external request or code execution was observed. See
  [XLSX regressions](../tests/argon-xlsx/README.md).
- Combined regression target: 329 TypeScript tests in 12 files, with the original
  Python reference suite separately reporting 33. The final combined-tree outputs
  under evidence/argon-review-20261021/final are authoritative, not the sum of
  overlapping scoped runs. Browser acceptance is not implied by jsdom or counts.

## Remaining limits

The new code was independently tested after applying the review; it was not sent
for a second Argon review and is not externally certified. File hashes prove byte
identity, not authenticity of financial documents. Full-month GL with unrelated
fee-account activity remains conservatively ineligible when linkage cannot prove
those fees unrelated. DocNum-only legacy imports remain readable but cannot prove
atomic posting. Split settlement, actual browser flows and target QBO/QBD import
acceptance remain outside the demonstrated completion boundary.
