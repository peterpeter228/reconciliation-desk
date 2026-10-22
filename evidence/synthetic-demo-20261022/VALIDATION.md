# Synthetic demo delivery validation

2026-10-22 UTC. Application runtime remains the reviewed b4562ed71a9d1877745d79727fd33be0c3301507 tree; this increment adds demonstration tooling, one regression test, documentation and synthetic artifacts only.

- Main was fast-forwarded from 42d677e9e983a05629ef24d1018562ba9a812221 to b4562ed71a9d1877745d79727fd33be0c3301507 using non-force expected-SHA update; remote ref readback matched.
- No .github workflows in reviewed tree; connector returned no commit statuses or workflow runs. This is no CI result, not a claimed CI pass.
- npm test: 785/785 tests, 45/45 files passed (full-tests.txt).
- npm run format:check, npm run build (includes TypeScript check), npm run check:artifacts: passed on the demo increment.
- Five scenario CLI checks passed; second output byte-identical; existing output refused with EEXIST.
- Browser: 10 PASS, 1 failed sample-label assumption retained. See browser/README.zh-CN.md for exact scope.
- 49-second MP4 is a slideshow of actual browser screenshots, not continuous recording. It has no voice track.
- No deployment, QuickBooks/ServiceTitan/bank write, customer data, paid model or real payment occurred.

Prior mixed-performance failure, Enter-only picker anomaly, HTML policy blockage, screen-reader and real accounting acceptance gaps remain unresolved. This demo does not prove demand, savings, accounting audit approval or profitability.
