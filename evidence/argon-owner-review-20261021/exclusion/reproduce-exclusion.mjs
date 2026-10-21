// Synthetic public-demo evidence only. Mutates parsed copies, not source files.
// Run from the project root:
// node --import tsx evidence/argon-owner-review-20261021/exclusion/reproduce-exclusion.mjs
import assert from 'node:assert/strict';
import { parseSource } from '../../../src/ingestion/index.ts';
import { matchProposalJournalPosting } from '../../../src/export/index.ts';
import { journalManifestDigest } from '../../../src/ingestion/qbo-transaction-journal.ts';
import { nativeCsv, nativeProposal, options } from '../../../tests/qbo-roundtrip-adversarial/fixtures.ts';

const parsed = await parseSource(nativeCsv, 'QBO', options);
assert.equal(parsed.ok, true, JSON.stringify(parsed.issues));
assert.ok(parsed.manifest);
const before = await matchProposalJournalPosting(nativeProposal, parsed.rows, [parsed.manifest]);
const originalExclusions = [...parsed.manifest.excluded_summary_rows];
parsed.manifest.excluded_summary_rows = [];
parsed.manifest.qbo_transaction_journal.manifest_payload_sha256 =
  await journalManifestDigest(parsed.manifest);
const after = await matchProposalJournalPosting(nativeProposal, parsed.rows, [parsed.manifest]);
console.log(JSON.stringify({
  originalExclusions,
  unmodifiedReport: before,
  clearedExclusionsWithRecomputedDigest: after,
  scopeLimit: 'Hashes check local evidence consistency, not QuickBooks source authenticity. This does not verify period coverage or clearing balances.',
}, null, 2));
assert.equal(before.matched, true);
assert.equal(after.matched, false);
for (const result of [before, after]) {
  assert.equal(result.scope, 'EXACT_JOURNAL_POSTING_ONLY');
  assert.equal(result.periodReconciliationVerified, false);
  assert.equal(result.clearingBalanceVerified, false);
}
