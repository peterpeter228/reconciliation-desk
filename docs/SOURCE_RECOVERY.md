# Source recovery and provenance

Recovered 2026-10-21 UTC from the user-designated conversation:
https://chatgpt.com/c/6ad81fe0-b2e8-83e8-b0b9-8f5de494acfe

The original engineering kit contained 41 files. Its ZIP SHA-256 was
8f464c2ae401da100c16b55fb8e9d605e65673f7fb3760321aab32173dea1b5f.
All 40 entries in its original MANIFEST.sha256 verified before implementation.
The complete source user request (5,807 characters) and assistant response
(22,801 characters) were recovered without omitted ranges.

The original package was preserved separately. This repository is the working
implementation derived from that package; MANIFEST.sha256 describes the original
kit, not the current application after changes. Source-specification claims about
market demand, prior testing, pricing and compatibility are not new validation.

The 33 Python reference tests passed in this environment on recovery. They are
reference-component coverage, not production-engine, browser or QuickBooks import
acceptance. Consult docs/phase-status.md for actual implementation results.
