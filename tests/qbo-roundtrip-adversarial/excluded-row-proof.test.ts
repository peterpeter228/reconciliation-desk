import { describe, expect, it } from 'vitest';
import type { ImportManifest, QB_Ledger_Entry } from '../../contracts/canonical';
import { matchProposalJournalPosting, verifyProposalInLedger } from '../../src/export';
import { parseSource, parseXlsx } from '../../src/ingestion';
import { journalManifestDigest } from '../../src/ingestion/qbo-transaction-journal';
import {
  matrix,
  nativeCsv,
  nativeProposal,
  options,
  secondGroup,
  syntheticCsv,
  syntheticValuesOnlyXlsx,
} from './fixtures';

async function imported(text = nativeCsv) {
  const parsed = await parseSource(text, 'QBO', options);
  expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
  expect(parsed.manifest).not.toBeNull();
  return { rows: parsed.rows, manifest: parsed.manifest! };
}

async function assertScope(rows: QB_Ledger_Entry[], manifest: ImportManifest, matched: boolean) {
  const result = await matchProposalJournalPosting(nativeProposal, rows, [manifest]);
  expect(result.matched, result.reason).toBe(matched);
  expect(result.scope).toBe('EXACT_JOURNAL_POSTING_ONLY');
  expect(result.periodReconciliationVerified).toBe(false);
  expect(result.clearingBalanceVerified).toBe(false);
  expect((await verifyProposalInLedger(nativeProposal, rows, [manifest])).verified).toBe(false);
}

async function recomputeManifest(manifest: ImportManifest) {
  manifest.qbo_transaction_journal!.manifest_payload_sha256 = await journalManifestDigest(manifest);
}

describe('non-posting audit classifications survive a recomputed manifest digest', () => {
  it('rejects clearing all excluded rows without changing any posting amounts', async () => {
    const { rows, manifest } = await imported();
    manifest.excluded_summary_rows = [];
    await recomputeManifest(manifest);
    await assertScope(rows, manifest, false);
  });

  it.each([1, 2, 3, 4])('requires native preamble row %i', async (row) => {
    const { rows, manifest } = await imported();
    manifest.excluded_summary_rows = manifest.excluded_summary_rows.filter((r) => r !== row);
    await recomputeManifest(manifest);
    await assertScope(rows, manifest, false);
  });

  it('requires every group header and control, the grand total and footer in a multi-group report', async () => {
    const { rows, manifest } = await imported(syntheticCsv(secondGroup));
    const proof = manifest.qbo_transaction_journal!;
    const mandatory = [
      ...proof.groups.flatMap((g) => [g.group_physical_row, g.total_physical_row]),
      proof.total_physical_row,
      proof.footer_physical_row,
    ];
    for (const locator of mandatory) {
      const changed = structuredClone(manifest);
      changed.excluded_summary_rows = changed.excluded_summary_rows.filter((r) => r !== locator);
      await recomputeManifest(changed);
      await assertScope(rows, changed, false);
    }
  });

  it.each(['posting', 'column header'] as const)('rejects an excluded %s row', async (kind) => {
    const { rows, manifest } = await imported();
    manifest.excluded_summary_rows.push(
      kind === 'posting' ? rows[0].source_refs[0].physical_row : manifest.header_row,
    );
    await recomputeManifest(manifest);
    await assertScope(rows, manifest, false);
  });

  it.each(['preamble', 'group', 'footer', 'optional blank'] as const)(
    'rejects duplicate %s exclusion locators',
    async (kind) => {
      const { rows, manifest } = await imported();
      const proof = manifest.qbo_transaction_journal!;
      const locator = {
        preamble: 1,
        group: proof.groups[0].group_physical_row,
        footer: proof.footer_physical_row,
        'optional blank': proof.total_physical_row + 1,
      }[kind];
      expect(manifest.excluded_summary_rows).toContain(locator);
      manifest.excluded_summary_rows.push(locator);
      await recomputeManifest(manifest);
      await assertScope(rows, manifest, false);
    },
  );

  it('rejects classifying a CSV continuation line inside a posting as an extra excluded row', async () => {
    const { rows, manifest } = await imported(
      syntheticCsv((r) => {
        r[6][4] = 'Synthetic name\ncontinued';
      }),
    );
    const continuation = rows[0].source_refs[0].physical_row + 1;
    expect(rows[1].source_refs[0].physical_row).toBe(continuation + 1);
    expect(manifest.excluded_summary_rows).not.toContain(continuation);
    manifest.excluded_summary_rows.push(continuation);
    await recomputeManifest(manifest);
    await assertScope(rows, manifest, false);
  });

  it.each([-1, 1])('rejects a nonempty after-header record count changed by %i', async (delta) => {
    const { rows, manifest } = await imported();
    manifest.raw_row_count += delta;
    await recomputeManifest(manifest);
    await assertScope(rows, manifest, false);
  });
});

describe('valid native CSV and controlled synthetic report layouts keep narrow matches', () => {
  it('accepts the original observed native CSV', async () => {
    const { rows, manifest } = await imported();
    await assertScope(rows, manifest, true);
  });

  it('does not assume CSV record starts occupy every physical line', async () => {
    const { rows, manifest } = await imported(
      syntheticCsv((r) => {
        secondGroup(r);
        r[6][4] = 'Synthetic name\ncontinued';
      }),
    );
    expect(rows[1].source_refs[0].physical_row - rows[0].source_refs[0].physical_row).toBe(2);
    await assertScope(rows, manifest, true);
  });

  it.each([0, 1, 4])(
    'accepts %i optional blank rows before and after the footer',
    async (count) => {
      const text = syntheticCsv((r) => {
        secondGroup(r);
        for (let i = r.length - 1; i > 4; i--) {
          if (r[i].every((cell) => !cell.trim())) r.splice(i, 1);
        }
        r.splice(r.length - 1, 0, ...Array.from({ length: count }, () => Array(9).fill('')));
        r.push(...Array.from({ length: count }, () => Array(9).fill('')));
      });
      const { rows, manifest } = await imported(text);
      expect(manifest.raw_row_count).toBe(10);
      await assertScope(rows, manifest, true);
    },
  );

  it('accepts a controlled multi-group values-only XLSX without claiming native formula compatibility', async () => {
    const values = matrix();
    secondGroup(values);
    const parsed = await parseXlsx(syntheticValuesOnlyXlsx(values), 'QBO', {
      ...options,
      sheetName: 'Synthetic Values Only',
    });
    expect(parsed.ok, JSON.stringify(parsed.issues)).toBe(true);
    expect(parsed.manifest).not.toBeNull();
    await assertScope(parsed.rows, parsed.manifest!, true);
  });

  it('treats exclusions as a unique classification set, not a display-order requirement', async () => {
    const { rows, manifest } = await imported();
    manifest.excluded_summary_rows.reverse();
    await recomputeManifest(manifest);
    await assertScope(rows, manifest, true);
  });
});
