# Current handoff after dot independent review — 2026-10-22

Current delivery: `review/dot-followup-20261022`, not merged into main. Read [独立复核结论](DOT_REVIEW_RESULTS_20261022.zh-CN.md) first, then [真实浏览器矩阵](DOT_BROWSER_REVIEW.md). The Claude snapshot below is historical evidence, not the final acceptance status.

Current review adds source-context/mapping ownership binding, stricter OTHER_CASE evidence, correct replacement Promise lifecycle, explicit local-register limitations, batch evidence association, isolated UNKNOWN review prototype, native-GL preparation evidence, and print-only skip-link correction. It does not authorize real accounting writes, outreach, deployments or UNKNOWN re-download.

The final report distinguishes successful synthetic flows from HTML-policy/screen-reader blocks, Enter-only keyboard limitation and mixed-scenario performance failure. A generated CSV or PDF is not proof of posting, demand or profitability. Use the report's single next action and its stop condition.

## Historical Claude Code handoff (retained for traceability)

# Handoff to dot — 2026-10-22

You should be able to continue from this file alone. Reports:
[independent review (zh-CN)](CLAUDE_CODE_INDEPENDENT_REVIEW_20261022.zh-CN.md) ·
[acceptance matrix + evidence](../evidence/claude-review-20261022/README.md) ·
[commercial validation plan (zh-CN)](COMMERCIAL_VALIDATION_PLAN_20261022.zh-CN.md).

## State

- Branch `review/claude-code-independent-20261022` from `42d677e`. Not merged into `main`.
- Verified on this branch: typecheck, 720 vitest (32 files), 33 Python reference tests, build, Prettier,
  artifact check, benchmark:3000, and 29/29 sandboxed real-Chrome checks. Commands and outputs are in
  `evidence/claude-review-20261022/`.
- Nothing touched a real accounting system. No deployment. The owner-private QA site is **older** than this branch.

## What changed and why (details in the review report)

| ID | Change | Main files |
|---|---|---|
| F-05 | Real three-file imports could never build a fee-only draft (mapping version string 242 > 240 chars, raw Zod error shown). Now bound by one digest; readable errors | `src/review/case-adapter.ts`, `src/components/CaseReview.tsx` |
| F-01 | Reopened projects must re-attach each original file; it is re-parsed with saved settings and must reproduce the saved rows and manifest before any accounting draft or reviewed UF instructions | `src/review/source-verification.ts`, `src/components/SourceVerification.tsx`, `src/review/project.ts`, `src/app.tsx` |
| F-06 | Import page asks for the QuickBooks bank GL account; fee-only draft requires a CONFIRMED QB→bank settlement edge, so desk and journal agree | `src/pages/import.tsx`, `src/review/case-adapter.ts` |
| F-02 / F-07 | Confirmation before replacing a workspace with unsaved review work; review state never crosses demo/real/company/bank; unsaved indicator; reload warning | `src/app.tsx`, `src/review/project.ts` (`compatibleReview`) |
| F-08 | Same-browser export register with a Web-Locks reservation before download; stale project copies and second tabs are blocked; reservation released if nothing downloaded | `src/review/export-register.ts`, `src/components/CaseReview.tsx` |
| F-04 | UF reviewed instructions stay CANDIDATE if the GL already has this case's bank deposit leg, the fee account has unassociated postings, or another case lists the same QB Payment; USD amount input | `src/review/case-adapter.ts` (`ufReviewConflicts`), `src/export/evidence.ts` |
| F-09 / F-03 | Reviewer summary HTML (escaped, no-script CSP); post-export guidance with the journal number and what to check | `src/export/case-summary.ts`, `src/components/CaseReview.tsx` |

New tests: `tests/claude-review/` (30). Parser-derived synthetic fixture: `tests/fixtures/fee-case-csv/`
(10,000 gross / 9,100 net / 900 netted fee, plus a UF variant). These CSVs carry explicit linkage columns
(Role, Account Type, Linked Payment/Deposit ID) that native QBO exports do not have.

## How to rerun

```bash
npm ci --ignore-scripts
npm run typecheck && npm test && npm run test:reference && npm run build && npm run format:check && npm run check:artifacts
npm run benchmark:3000   # NOTE: overwrites evidence/implementation-20261021/benchmark-3000.json; restore it with git checkout
```

Real browser (no `--no-sandbox`): install `playwright-core@1.56.1` in a scratch dir, run `npx vite preview --host 127.0.0.1 --port 4173`,
copy `tests/fixtures/fee-case-csv/*`, `evidence/handoff-workflow-20261022/fixtures/synthetic-*-review.txt`,
`malformed-review.json`, `evidence/qbo-native-profile-20261021/browser-fixtures/{st,bank}.csv` and
`evidence/quickbooks-acceptance-20261021/target-transaction-journal-145.xlsx` into an input dir, then run
`evidence/claude-review-20261022/browser/qa-run.mjs` as an unprivileged user with `QA_IN`/`QA_OUT` set.
Chrome refuses to start as root with its sandbox on, so run it as a normal user, not as root with `--no-sandbox`.

## Open items, in priority order

1. **Customer evidence before more features.** Run the five problem interviews in the commercial plan §3/§8.
   This needs the owner's authorization for any outreach. Stop condition: fewer than 2 of 5 confirm H1.
2. **Native-export gap (H5).** Native QBO GLs lack the linkage columns the engine requires. Measure the preparation time on one authorized real (redacted) month before deciding between a guided "add linkage columns" step and staying workpaper-only. Do not add amount-only matching.
3. **Full-month clearing association burden.** Each other clearing transaction must be marked OTHER_CASE with evidence. Design batch-level evidence binding; do not relax the block.
4. **Recovery after an UNKNOWN export.** The tool now explains what to check, but it has no reviewed in-app path such as "checked the books, journal absent, evidence attached". Design it with the owner before changing the gate.
5. Not run: print/PDF, screen reader, two real tabs racing, UF browser click-through, QBO/QBD import of current output, QBD IIF.
6. Housekeeping: make the benchmark output path configurable. The EBADENGINE warning needs Node ≥22.22.2 for jsdom's dependency.

## Do not

- Claim production, QBO/QBD acceptance, demand, revenue or profit from this branch.
- Accept a reopened project's rows without re-verification, or carry review state across companies or demo/real.
- Write to any real or sample accounting company without the owner's explicit, scoped authorization.
