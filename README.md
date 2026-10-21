# Reconciliation Desk

A private, local-file workbench for ServiceTitan → QuickBooks → bank activity.
The goal is evidence you can review, not a green checkmark from coincident amounts.

**Current stage: runnable private pilot implementation; browser acceptance and
real QuickBooks import are not established.** No financial account is connected,
no entries are posted, no real payment service is configured, and no public launch
is implied. Read [implementation limits](docs/IMPLEMENTATION_LIMITS.md) first.

## Run locally

Tested implementation environment: Node 24.19.0 and Python 3.12.14. Node >=22 required.

```bash
npm ci --ignore-scripts
npm run dev
```

Open the loopback URL Vite prints. Click **Load demo**. The sample is explicitly
synthetic. Its $20,000 missing settlement and $50,000 consolidated deposit are
investigation cases, not recovered money or customer revenue. Add synthetic
supporting evidence to see which conclusions the evidence actually supports.

**Import** accepts explicit CSV/TSV and guarded values-only XLSX profiles. Review
company/account, period, row grain, signed amounts and posted-ledger semantics.
All financial processing stays in browser workers. Raw files are not uploaded,
stored in a backend, sent to a model, or retained across reloads. Downloads remain
on the user's device.

**Exports** provides JSON evidence, formula-safe review CSV and a printable
workpaper. The separate $900 teaching journal is prominently marked synthetic and
must not be imported into real books. Main-run accounting imports remain disabled
without the complete verified facts required by the typed fee-only builder.

## Validation

```bash
npm test
npm run typecheck
npm run build
npm run check:artifacts
npm run test:reference
npm run benchmark
```

The original Python kit and the new TypeScript product tests are separate. Do not
add their counts together as independent quality coverage. Actual dated results,
including failed intermediate checks, are in `evidence/implementation-20261021/`.
Browser environment blockers and an unexecuted normal-browser QA script are in
`evidence/browser-20261021/`. A prepared test is not a passing browser test.

### CLI (same production engine)

```bash
npm run reconcile -- --st samples/st_export.csv --qb samples/qbo_clearing_gl.csv --bank samples/chase_bank.csv --profile examples/demo-profile.json --out /tmp/reconciliation-result.json
```

Optional `--processor`, `--components`, `--receipts`, and `--audit` flags add
explicit evidence files. The supplied profile is **synthetic only**. For actual
exports, create a reviewed manual profile rather than assuming demo semantics.
No production path imports `ground_truth_answer_key.json`; it remains test-only.

## Core safety model

- Integer USD cents, exact identity namespaces and physical-row provenance.
- ST→QB receipt, QB→bank posting, and gross→net cash evidence assessed separately.
- Only clearing GL cannot prove the bank leg. Missing opening balances stay unknown.
- Fee ranges create hypotheses; missing deposits do not prove processor holds.
- Ambiguous, conflicting, bounded or incomplete searches cannot become confirmed.
- Accepted allocation conserves source amounts; noncash corrections are not refunds.
- Ordinary asset-clearing fee-only exports require documented existing net-bank
  posting, missing expense, reviewed accounts and exact immutable approval.
- Undeposited Funds requires payment/deposit object linkage, not a generic journal.
- Download is not posting. QBO CSV/QBD IIF remain Beta until target-version testing.
- No third-party analytics, financial APIs, live checkout or paid model adapter.

## Project layout

- `src/ingestion`, `src/mapping`: local parsing, bounds, provenance and explicit semantics.
- `src/engine`, `src/contracts`: deterministic evidence, conflict and amount logic.
- `src/export`: guarded journal serializers and human review workpapers.
- `src/workers`: isolated file parsing and reconciliation with cancellation.
- `src/pages`, `src/components`: evidence desk, imports and separate teaching workflow.
- `tests`: independent integration, engine, ingestion/export, workbook and source-kit checks.
- `samples`: synthetic inputs and test-only answers; `public/demo` contains inputs only.
- `docs`: original specification, source recovery, limits and implementation status.

## Source specification and remaining gates

The user-designated engineering kit was recovered intact (41 files, 40 manifest
hashes verified) before implementation. Its historical README is preserved in
[ORIGINAL_KIT_README.md](docs/ORIGINAL_KIT_README.md). Root `MANIFEST.sha256` describes
that original kit, not this evolving implementation. See [source provenance](docs/SOURCE_RECOVERY.md).

[Engineering PRD](docs/PRD_ENGINEERING.zh-CN.md) ·
[Algorithm](docs/ALGORITHM_SPEC.zh-CN.md) ·
[Accounting export](docs/ACCOUNTING_EXPORT_SPEC.zh-CN.md) ·
[Independent safety research](docs/INDEPENDENT_ACCOUNTING_SAFETY_REVIEW.md) ·
[Phase status](docs/phase-status.md)

The specification's $199 service and subscription prices are business hypotheses,
not configured payment products or proven revenue. Actual customer files, human
accounting review, target QBO/QBD import/re-import, and any launch/payment/account
steps require separate evidence and the applicable owner authorization.
