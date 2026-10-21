# Browser QA: blocked, not passed

No rendered browser workflow checks or screenshots were produced. See `browser-results.json` for exact route outcomes. The UI TypeScript check and QA script syntax check passed, which do not establish browser behavior.

## Intended flow

App loads → one-click local synthetic demo → largest $50k / $20k cases → source provenance → supplemental evidence → independent $900 fee-only approval/export/invalidation → print → 375px mobile/reset → real CSV/XLSX file-input error, explicit worksheet selection, and validation flow.

## Runnable prepared test

`qa-run.cjs` is a normal Playwright/Chromium flow, with `chromiumSandbox: true`, no custom Chromium flags, and Vite bound only to 127.0.0.1. It does not load an answer key, replace real parsers, mock the engine, or substitute jsdom for a browser. It observes real browser requests, errors, UI content, downloads, and screenshots.

Run from the project root in a supported browser environment where Playwright and `/usr/bin/chromium` are installed:

    node evidence/browser-20261021/qa-run.cjs

Optional environment variables: PLAYWRIGHT_MODULE, RECONCILIATION_ROOT, QA_ARTIFACT_DIR. The script records each check separately and exits nonzero on any failure or bootstrap block. Its checks are prepared, not executed or claimed as passed.

No security settings or filesystem access restrictions were changed to overcome the blocker.

## Current semantic expectations (not browser results)

The separately executed `pipeline-expectations.ts` parses the same bundled CSVs as the demo and runs the real engine. The supplied PAYMENT gross control is $242,360.14, not the distinct $250,000 original-economic-event fixture metric. UI checks compare the displayed source-payment metric and downloaded controls against this real pipeline, without imposing an economic-event count.

The enhanced $20,000 processor-hold diagnosis is SUPPORTED, not CONFIRMED: bank and processor release coverage through the hold as-of date remains missing. Prepared UI checks require that limitation and preserve the no-main-run-accounting-import gate.

For manual imports, the explicit report-semantics checkbox states that bank inflows are positive and outflows negative. The current UI has no separate bank-sign selector; this attestation supplies the sign convention. The prepared script checks that wording before checking the control. XLSX checks require a deliberate worksheet selection and never combine sheets automatically.

`pipeline-expectations.json` is non-browser preflight evidence only. No browser tests were rerun after the environment blocker.
