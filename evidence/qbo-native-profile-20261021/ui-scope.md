# Native QBO profile UI source checks

Changed ImportPage and UI tests only. Default imports remain manual; native QBO
Transaction Journal is an explicit selection with a separately entered expected
printed company name. Changing QuickBooks product resets selection to manual,
and QBD never receives the native QBO profile.

Native parsing receives coverageConfirmed=false, no account balances, fixed
column meanings and strict physical header choice. The run-level options are
also marked as unconfirmed full-period coverage. The interface explicitly says
that transaction-only journal evidence does not establish the entire clearing
account or month. Existing selected worksheet/header choices are retained;
incompatible physical headers fail closed rather than silently switching.

Profile, expected-company and source-setting changes invalidate prior validation
and in-flight parsing tokens. Read, worksheet, header-preview and validation
completion paths check tokens before installing results. Native profile settings
are disabled while the parent reconciliation is busy. The exact native XLSX
still fails at its total formulas; no formulas are removed or converted.

Source UI checks use real parsers behind mocked worker transports under jsdom.
They are not browser/worker proof. The focused suite has 13 tests across two files:
9 new native-profile cases and 4 existing manual header/worksheet regressions.
They cover native CSV scope, missing/mismatched company, default/manual/QBD,
explicit wrong-header rejection and recovery, stale upload/header/validation,
worksheet preservation and unchanged native formula-workbook rejection.

The existing manual test wait was increased from the testing-library default
1 second to 5 seconds to accommodate concurrent CPU-heavy parser suites. Its
assertions and coverage were not relaxed.

Targeted rendered browser verification is pending parent deployment and browser
assignment. No browser claim, financial write or external import is made here.
