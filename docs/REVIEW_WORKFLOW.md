# Local review workflow (2026-10-22)

This is a file-based review tool, not a bookkeeping service, bank connection or automatic posting tool. The current milestone adds a narrow case workflow to the existing deterministic engine; it does not establish customer demand or production acceptance.

## Three output levels

1. Investigation: source rows, unmatched candidates, controls and missing evidence.
2. Human judgment: a case workpaper or UF candidate worksheet. Missing accounting evidence must not disable these outputs.
3. Approved accounting artifact: only an eligible ordinary-asset clearing fee-only proposal, reviewed against exact accounts, date, amount and supporting evidence. A download is not a posted transaction.

## Native QBO XLSX

Select the explicit QBO Transaction Journal profile and the intended worksheet. Recognized report-control formulas are preserved with their addresses, formula text and cached values. The application independently recomputes permitted numeric controls; it does not evaluate workbook formulas or rewrite the original workbook. Posting formulas and unsupported/active workbook content remain blocked. Missing or conflicting controls can preserve investigative rows while blocking accounting use.

READY/PARTIAL/BLOCKED describe ingestion, not overall accounting readiness. Optional recovery quarantines whole reliably identified economic transactions, never individual sides of an unbalanced transaction. Complete journals must balance by transaction. Account-activity reports are a separate explicit scope and can legitimately show one side. A single complete Transaction Journal is not evidence of full-month expense coverage. Partial input cannot establish complete-period absence of a fee.

## Review an actual case

Select a case in the reconciliation desk and expand **Review facts & documented fee-only proposal**.

- Enter the reviewer, decision basis, exact existing account names and their reviewed COA types/existence.
- Select supporting COA, settlement and full-ledger documents. Only their local byte hashes/names are retained; contents are not automatically interpreted or sent anywhere. Keep the originals.
- Explicitly transcribe covered account names and the full period from the reviewed GL coverage document. A selected COA account does not prove that an expense account was included in the report.
- Bind the existing receipt and bank-settlement transaction IDs to this case. A bank-feed item is not an already posted bank leg.
- Review all fee/clearing activity in the full supplied GL. Unexplained associations stay unknown and block an import. Other-case exclusions require an actual distinct bound review case and a known source/document digest. Do not filter ledger rows out before validation.
- Build, inspect the exact two lines, approve, then download the QBO CSV and manifest. The supported example is Dr expense 900 / Cr ordinary clearing 900 after a posted gross 10,000 receipt and posted net 9,100 bank settlement. Never debit bank a second time.

UF, liability clearing, hold/release, mixed/refund cases, additional same-case postings, partial fees and reversals are not automatic fee-only journals. Their workpapers remain available. UF uses actual existing QB Payment IDs, current undeposited/deposit status and evidence. ST identifiers alone are only candidates. Reviewed UF instructions require actual reviewed bank/expense accounts and a documented netted fee; they are never accounting import files.

## Import semantics the fee-only path needs

Name the clearing account and, when the GL contains it, the **QuickBooks bank account (exact GL name)** on the import page. A fee-only draft requires the engine's QuickBooks → bank settlement link to be CONFIRMED, so the desk and the journal agree that the net deposit is already posted. The engine links sources only through explicit identities (Role / Account Type / Linked Payment or Deposit ID columns, processor settlement evidence), never by amount alone. Native QBO GL exports do not carry these columns, so they currently support investigation workpapers, not fee-only drafts.

## Save, reopen, and avoid duplicate exports

**Save review project** downloads versioned normalized input rows, source hashes, mappings/controls, review facts, proposals and export history. Original source bytes are not embedded. Treat the downloaded file as confidential if it contains actual financial data.

**Open review project** checks format, size, runtime schema, provenance references and integrity, then re-runs the engine. It revokes saved approvals. Because saved rows are no longer bound to original bytes (the integrity hash is unkeyed), **Verify original sources** must re-attach each original file; it is re-parsed with the saved settings and must reproduce the saved rows and manifest exactly before any accounting draft or reviewed UF instructions. Investigation and workpapers stay available. Opening a project, loading the demo or re-running an import asks first when there are unsaved review changes, and review state is never carried across company, bank or demo/real contexts. Stable economic-case and accounting-action identities are separate from engine-group and input-content hashes. Recalculation retains export history; ambiguous merges/splits preserve uncertain/orphaned history rather than resetting a case to new.

An attempted export is recorded before the browser download. Its posting outcome remains unknown until reviewed. A failed/uncertain download does not permit a blind second journal. This browser also keeps a small export register (hashed company key, case/action IDs, journal number, time) and reserves it under a cross-tab lock before download, so an older project copy or a second tab in the same browser cannot produce a second journal for the case. It is best effort, not shared across browsers or devices, and lost if site data is cleared. There is no backend or cross-device registry: retain and reuse the same review project and independently check actual books. Deleting a local project or maliciously rewriting its data cannot be prevented by a browser-only tool. Hashes detect local changes, not document authenticity or reviewer identity.

**Download reviewer summary (HTML)** gives a recipient-readable page: scope, sources and byte-binding status, amounts, engine observations, unverified items, reviewer statements (labelled as statements), accounting output, export history, and the next step with who confirms. It is not an import file.

## Acceptance boundaries

Synthetic fixtures and tests prove scoped mechanics, not the accuracy of unknown customer exports, professional accounting judgment, commercial demand or compatibility with every QBO/QBD edition. QBO CSV/QBD IIF remain Beta. This milestone does not connect accounts, post entries, take payments, publish a service or re-run external model review. Dated test/browser evidence is recorded separately; do not infer acceptance from this guide alone.
