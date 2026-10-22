# Independent review acceptance record — 2026-10-22

Reviewer: Claude Code (independent of dot). Branch `review/claude-code-independent-20261022`, based on `42d677e`
(`74ff1fc` + the review prompt doc). Synthetic data only. No QuickBooks/ServiceTitan/bank account was connected,
no accounting system was written, nothing was deployed, no paid model (Argon/other) was called.

## Environment (`environment.txt`)

Ubuntu 24.04.3, 8 vCPU Intel Xeon Platinum 8576C, Node v22.22.0, npm 11.17.0, Python 3.12.3,
Google Chrome 144.0.7559.132. `npm ci --ignore-scripts` warns `EBADENGINE` for a dev-only jsdom
dependency (`w3c-xmlserializer` wants Node ≥22.22.2); all checks still pass on 22.22.0.

Real browser: headless Google Chrome **with its sandbox** (`chromiumSandbox: true`, no `--no-sandbox`), run
as the unprivileged `nobody` user; `chrome://sandbox` reported Layer-1 namespace sandbox + seccomp-BPF
(`browser/after/chrome-sandbox.txt`). App served by `vite preview` on `127.0.0.1:4173` only. Driver:
`playwright-core@1.56.1` installed in a scratch directory (not a project dependency). Uploads go through the
visible control and the native file chooser, so disabled states are respected as for a person.

## Results (actually executed in this session)

| Check | Result | Evidence |
|---|---|---|
| Baseline at `42d677e`: typecheck/690 tests/33 Python/build/format/artifacts/benchmark | PASS | `baseline-vitest-42d677e.txt` |
| New review tests against unfixed code | 8 FAIL (expected red) | `red-before-fix.txt` |
| Final typecheck | PASS | `final-typecheck.txt` |
| Final vitest: **720 tests / 32 files** (690 prior + 30 new in `tests/claude-review/`) | PASS | `final-vitest.txt` |
| Python reference suite: 33 tests (separate; not additive coverage) | PASS | `final-python-reference.txt` |
| Production build, Prettier, static artifact check | PASS | `final-build.txt`, `final-format.txt`, `final-artifacts.txt` |
| `benchmark:3000` (Node engine only): p95 305 ms identity-rich; 378 ms ambiguous/capped with 90 unfinished scopes | PASS (synthetic Node, not browser SLA) | `final-benchmark-3000.txt` |
| Real browser, current branch: 29 checks | 29 PASS / 0 FAIL | `browser/after/browser-results.json`, `browser/after/qa-console.txt` |
| Real browser, baseline `42d677e`, same path | 3 defects OBSERVED | `browser/before/before-results.json`, `before-01-build-error.png`, `before-02-demo-replaced-workspace.png` |

`benchmark:3000` rewrites `evidence/implementation-20261021/benchmark-3000.json`; that historical file was
restored with `git checkout` and is unchanged in this branch.

## Minimum acceptance matrix (doc §8)

| # | Area | Status | What was actually run | Evidence |
|---|---|---|---|---|
| 1 | Unmodified QBO XLSX, four controls; cache/formula negatives | **PASS** (browser positive) / PASS (unit negatives, dot's tests) | Browser: H9 `H7+H8`, I9 `I7+I8`, H10 `H9`, I10 `I9`, each CONSISTENT, stored 900, independent 90000 cents; txn 145, posting rows 7/8, XLSX SHA-256 `ac1b896b…e033` unchanged; re-verify after reopen. Negatives: `tests/handoff-ingestion/native-controls.test.ts`, `tests/xlsx/*` | `browser/after/16-native-xlsx-controls.png`, `native-controls.txt`, `native-xlsx.review.json` |
| 2 | CSV/TSV/XLSX mapping, ambiguity, cancel/retry, bad file, quarantine, scope | PASS (unit, dot) / PASS partial (browser: CSV mapping + validation, wrong-file rejection) | Header ambiguity / quarantine / cancel only in jsdom/unit tests; import **retry** has no test | `final-vitest.txt` |
| 3 | Actual engine output → facts → draft → approval → CSV/manifest download and read-back | **PASS** (browser + unit) | Three real CSVs + processor CSV parsed in the browser workers; draft lines Dr Merchant Processing Fees 900 / Cr ServiceTitan Clearing 900; downloaded CSV has header + 2 lines, no bank leg; manifest `EXPORTED_NOT_POSTED`, `synthetic_only:false` (data is synthetic; archived file renamed `SYNTHETIC_DO_NOT_IMPORT__…`, original bytes hashed in `export-sha256.txt`) | `browser/after/04-draft.png`, `05-after-export.png`, CSV + manifest |
| 4 | Full GL: fee already posted, other case, unknown, partial, reversal, hold, UF | PASS (unit; dot's `accounting-domain`/`case-adapter` tests + new F-06) | Not exercised in browser | `final-vitest.txt` |
| 5 | UF full-evidence synthetic positive; deposited / missing ID / duplicate payment / cross-case / not conserved / fee in GL / GL deposit already posted | PASS (jsdom component, real parser fixture) | Positive gives `REVIEWED_INSTRUCTIONS`, `importEligible:false`; 7 negatives stay `CANDIDATE`. **Cross-company UF: NOT APPLICABLE** (one-company workspace; QB payment IDs carry no company). **Not real QB acceptance.** UF browser click-through: **NOT RUN** | `tests/claude-review/ui-safety.test.tsx` |
| 6 | Save/Open/refresh/recompute/changed facts/order/invalid schema; approvals revoked, history kept | PASS (unit + browser) | Browser: stale pre-export copy shows the browser-recorded export and blocks; reopened sources unverified until originals re-attached; malformed project keeps workspace and unsaved protection; reload prompt | `browser/after/07…10-*.png` |
| 7 | Races: double click, tabs, large input, cancel, stale worker | PASS partial | Cross-tab reservation tested with an injected lock (unit) and lock-wait unmount (jsdom). Real **two-tab** browser race: **NOT RUN**. Large-input caps: dot's unit tests | `tests/claude-review/fixes.test.ts`, `ui-safety.test.tsx` |
| 8 | Real browser full upload→delivery, desktop/narrow, keyboard/zoom, recovery, print/PDF, network, console | PASS except print/PDF | Desktop 1440×900; mobile 390×844 (no horizontal overflow on landing/desk/case review/exports); 720px CSS (=200% zoom) no overflow; Tab order reaches skip link → nav → primary actions; network: only `127.0.0.1:4173`; console errors: none. **Print/PDF: NOT RUN.** Screen-reader run: **NOT RUN** (labels checked only via accessible-name queries) | `browser/after/11…15-*.png`, `keyboard-order.txt` |
| 9 | Downloaded bytes match UI; source and limits included; no unnecessary data | PASS | CSV/manifest/summary/project read back from disk; summary escapes all values, no-script CSP | `browser/after/case-summary-*.html` |
| 10 | QBO/QBD compatibility | Official format check: PARTIAL; offline serializer tests: PASS; **actual QBO/QBD import of current output: NOT RUN** (not authorized) | Intuit en-global help lists Journal No/Date/Code, Account Name, Journal, Debits, Credits and a <1,000-row limit (read 2026-10-22). QBD IIF: untested. | `docs/COMMERCIAL_VALIDATION_PLAN_20261022.zh-CN.md` |

## Interaction count and timing (scripted, synthetic)

Fee-only path from "Use my files" to the two downloaded files: about 57 explicit interactions
(≈13 import, 4 evidence, 1 case select, ≈37 review facts, 2 approve). Counters for the whole desktop
script (which also covers reopen/verify/native checks) are in `browser-results.json`. Scripted wall time
is ~7 s; this is automation, not human task time, which was **not measured**.

Before (`42d677e`) the same path ended at "Build" with raw JSON
`[{"code":"too_big","maximum":240,…"path":["mappingVersion"]}]`; no accounting output was possible from parsed
files. After: the path completes and produces a verified 2-line CSV, manifest and a reviewer summary.

## Not established

Real customer files, real QBO/QBD import or re-import of current output, QBD IIF, print/PDF, assistive
technology, two real tabs racing, human task time, customer demand, revenue or profit.
