# Real-browser follow-up: blocked at owner authentication

## Current result

A real cloud Chromium browser opened the owner-private QA Site at
https://reconciliation-desk-private-qa.blueboot64.chatgpt.site/ and rendered the
ChatGPT authentication gate, not Reconciliation Desk. The title was
“需要登录”, with heading “登录后即可访问” and a “使用 ChatGPT 继续” link.

[Actual gate screenshot](private-site-login-gate.jpg), 1180 × 757 pixels.
This is evidence of the access blocker only, not app-rendering evidence.
No app workflow, file import, download, mobile layout, print flow, browser
cancellation, or app runtime/network acceptance check ran. Those remain NOT_RUN.

No denied local browser launch was retried. No sandbox/security/authentication
control was bypassed, and no public deployment or financial action was performed.
The private Site requires the owner's existing ChatGPT account. Sign-in approval
was requested by the parent; this worker stopped before clicking Continue.
The tab was retained for authorized continuation.

## Source-level finding and narrow fix

A separate deterministic jsdom test reproduced a cancellation race:

1. Load the synthetic workspace and begin parsing supporting evidence.
2. Close the evidence modal, cancel, and start a newer sample reconciliation.
3. Allow the old supplemental parser to complete.
4. Before the fix, the stale calculation aborted the newer worker's AbortSignal.

The failing expectation was `expected true to be false` for the newer signal.
See [before log](source-regression-before.txt). This test uses deferred/mock
workers and dialog open/close stubs: it is not real-browser or real-worker proof.

`src/app.tsx` now rejects stale operation tokens before touching the current
AbortController and immediately after supplemental parsing returns.
`tests/ui/supplemental-cancellation-race.test.ts` verifies that stale work neither
aborts the newer signal nor starts another reconciliation worker.

## Executed checks after the fix

- Targeted lifecycle/review tests: 10 passed in 3 files.
- Full Vitest suite: 330 passed in 13 files.
- TypeScript: passed. An initial type-only mismatch in the new test helper was
  corrected before this final run.
- Production build: passed, 16 output files.
- Static artifact scan: answer key absent, credential pattern scan no match.
  This is not a deployed-header or runtime-egress guarantee.
- Formatting: passed.

Logs are stored beside this report. The rebuilt local dist is ready for the
parent to sync; deployment freshness must be verified after that separate step.
QuickBooks import acceptance and production launch are not established.
