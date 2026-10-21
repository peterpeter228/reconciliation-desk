# Manual import versus demo: controlled profile ablation

Verified 2026-10-21 using synthetic fixtures only. **The 416-group / 0-allocation
manual result is expected conservative behavior, not XLSX corruption or lost
rows.** Missing trusted schema, identity and bank-posting configuration remains a
real pilot limitation. This diagnostic does not establish real QuickBooks import
acceptance or production readiness.

## Reproduce

From the repository root with its existing Node >=22 dependencies installed:

```sh
node --import tsx evidence/browser-20261021-followup/profile-ablation/replay.mts
```

The script resolves all inputs relative to its own location and rewrites only
`results.json` beside itself. `run.log` records the executed verification. The
relocated script ran successfully, asserted the expected counts and controls, and
its 12 case results exactly matched the initial independent diagnostic.

Inputs are the repository's three synthetic `samples/` CSVs, the preserved
[uploaded workbook](../synthetic-upload-multisheet.xlsx), and the reviewed options
in [import-profile-comparison.json](../import-profile-comparison.json). The workbook
SHA-256 is
`4e3ed6b1762accb6460dcda3e31e60944db6447a8cc049bd41b879630c9f3cc6`.
No credentials, real customer data, financial connections or network calls are
used. No production source was changed.

## Finding

| Controlled input/configuration | Groups | Allocations |
| --- | ---: | ---: |
| Manual CSV | 416 | 0 |
| Manual XLSX | 416 | 0 |
| Demo CSV | 221 | 36 |
| Demo XLSX | 221 | 36 |
| Manual with demo company/bank labels | 416 | 0 |
| Manual plus demo split configuration only | 416 | 0 |
| Manual plus demo-inferred QB batch IDs only | 413 | 24 |
| Manual plus all demo-inferred IDs and fee roles | 221 | 24 |
| Previous case plus demo split configuration | 221 | 36 |

All cases preserve 359 ST, 338 QB and 140 bank input rows and identical monetary
controls: source gross 24,236,014 cents, conservation true. CSV and XLSX ST
canonical rows are exactly equal under the same profile, excluding source
provenance. The file container and company/bank labels do not cause the gap.

The synthetic-v1 profile supplies fixture-specific semantics absent from the
manual input columns:

- 203 QB accounting-batch IDs inferred from `Num`.
- 192 QB linked-deposit IDs inferred from `Num`/memo.
- 132 bank deposit IDs extracted from descriptions.
- 57 QB `FEE` roles inferred from the fixture's `FEE` numbering convention.
- ST export-status basis defaults to `SYSTEM` rather than `UNKNOWN`.
- Demo config verifies `Collections Checking` split semantics. Manual config
  deliberately does not claim that confirmation.

Consequently, manual import produces 198 candidate ST-to-QB edges rather than
confirmed edges, and no QB-to-bank identity links. It accepts no allocations.
The engine preserves 194 unassociated QB rows as separate review groups rather
than silently discarding them.

**The demo's 36 allocations are 18 accepted partial groups, not 36 completed
three-way reconciliations:** 12 ST/QB pairs and 6 QB/bank pairs. Split-account
support is not bank-leg proof, and no acceptance claim is upgraded here.

## Scope and safe next step

The baseline/manual cases execute actual parsers and the same deterministic
engine locally. Field-restoration cases are isolated counterfactual changes to
in-memory canonical clones, not additional browser tests, trusted user mappings,
or new accounting evidence. They explain causality; they do not authorize those
assumptions for uploads.

Do **not** enable synthetic inference for real uploads or force result counts to
match. Explain missing identities to the reviewer; obtain reviewed explicit
batch/payment/deposit fields, account-role semantics and bank-leg evidence (or
itemized accountant evidence). A clearly marked manual-compatible synthetic
fixture can test that supported path without weakening production evidence gates.

## Source and browser evidence

- [Baseline browser download](../baseline-browser-evidence.json) and
  [manual browser download](../upload-browser-evidence.json).
- `src/pages/import.tsx`: manual profile and unconfirmed split configuration.
- `src/app.tsx`: synthetic-v1 profile and verified demo bank/split configuration.
- `src/ingestion/normalize.ts`: synthetic-only identity and role derivation.
- `src/engine/edges.ts`: typed receipt/deposit identity and bank-posting gates.
- `src/engine/waterfall.ts`: candidate conflicts and accepted-allocation gates.
