import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { reconcile } from '../../src/engine';
import type { ReconcileResult } from '../../src/contracts/engine';
import { loadFixture, type LoadedFixture } from './fixtures';

interface Golden {
  balances: Record<string, number>;
  events: {
    event_id: string;
    st_payment_id: string | null;
    ground_truth_cause: string;
    original_receipt_gross_cents: number;
    fee_cents: number;
    source_refs: Record<string, { csv_row_number: number }[]>;
  }[];
}
function assertConserved(result: ReconcileResult) {
  expect(result.controls.conservation_ok).toBe(true);
  for (const atom of result.controls.atoms.filter((a) => !a.excluded_reason)) {
    expect(Number.isSafeInteger(atom.source_cents)).toBe(true);
    expect(atom.allocated_cents + atom.residual_cents).toBe(atom.source_cents);
    expect(Math.abs(atom.allocated_cents)).toBeLessThanOrEqual(Math.abs(atom.source_cents));
    if (atom.allocated_cents !== 0)
      expect(Math.sign(atom.allocated_cents)).toBe(Math.sign(atom.source_cents));
  }
  expect(new Set(result.allocations.map((a) => `${a.atom_id}:${a.group_id}`)).size).toBe(
    result.allocations.length,
  );
  for (const group of result.groups.filter((g) => g.accepted)) {
    expect(
      group.gross_cents -
        group.refunds_cents -
        group.fees_cents -
        group.holds_cents +
        group.releases_cents +
        group.external_receipts_cents +
        group.other_adjustments_cents -
        group.bank_cents,
    ).toBe(group.unexplained_cents);
  }
}
function economicSnapshot(result: ReconcileResult) {
  return {
    groups: result.groups
      .map((g) => ({
        id: g.id,
        st: g.st_ids,
        qb: g.qb_ids,
        bank: g.bank_ids,
        accepted: g.accepted,
        state: g.matching_state,
        scope: g.matching_scope,
        search: g.search_status,
        gross: g.gross_cents,
        refunds: g.refunds_cents,
        fees: g.fees_cents,
        holds: g.holds_cents,
        external: g.external_receipts_cents,
        unexplained: g.unexplained_cents,
        diagnoses: g.diagnoses,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    allocations: [...result.allocations].sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b)),
    ),
  };
}
for (const seed of [20261021, 804203]) {
  describe(`actual CSV → engine evidence boundaries, seed ${seed}`, () => {
    let directory: string;
    let temporary: string | undefined;
    let fixture: LoadedFixture;
    let baseline: ReconcileResult;
    let enhanced: ReconcileResult;
    let golden: Golden;
    beforeAll(async () => {
      directory = resolve('samples');
      if (seed !== 20261021) {
        temporary = await mkdtemp(join(tmpdir(), 'reconciliation-heldout-'));
        execFileSync(
          'python3',
          ['scripts/generate_synthetic.py', '--out', temporary, '--seed', String(seed)],
          { cwd: process.cwd() },
        );
        directory = temporary;
      }
      fixture = await loadFixture(directory);
      // The production path gets only imported source CSVs. The answer key is read below by assertions, never passed to reconcile.
      baseline = reconcile(fixture.baseline);
      enhanced = reconcile(fixture.enhanced);
      golden = JSON.parse(
        await readFile(join(directory, 'ground_truth_answer_key.json'), 'utf8'),
      ) as Golden;
    });
    afterAll(async () => {
      if (temporary) await rm(temporary, { recursive: true, force: true });
    });

    it('actually parses all source rows and does not globally block the supplied fixture', () => {
      expect(fixture.st.rows).toHaveLength(359);
      expect(fixture.qb.rows).toHaveLength(338);
      expect(fixture.bank.rows).toHaveLength(140);
      expect(fixture.settlements.rows).toHaveLength(243);
      expect(fixture.components.rows).toHaveLength(4);
      expect(fixture.receipts.rows).toHaveLength(7);
      expect(fixture.audits.rows).toHaveLength(8);
      expect(fixture.nextBank.rows).toHaveLength(10);
      expect(baseline.warnings.filter((w) => w.severity === 'BLOCKING')).toEqual([]);
      expect(enhanced.warnings.filter((w) => w.severity === 'BLOCKING')).toEqual([]);
      expect(baseline.groups.length).toBeGreaterThan(0);
      expect(enhanced.groups.some((g) => g.accepted)).toBe(true);
    });
    it('independently agrees with test-only source golden totals without counting corrections as cash refunds', () => {
      const b = golden.balances;
      expect(fixture.st.controls.signedCents).toBe(b.st_signed_report_cents);
      expect(baseline.controls.qb_debits_cents).toBe(b.clearing_period_debits_cents);
      expect(baseline.controls.qb_credits_cents).toBe(b.clearing_period_credits_cents);
      expect(baseline.controls.bank_signed_cents).toBe(
        b.bank_receipt_credits_cents + b.bank_refund_debits_signed_cents,
      );
      expect(baseline.controls.st_refunds_cents).toBe(-b.bank_refund_debits_signed_cents);
      expect(baseline.controls.st_corrections_cents).toBeLessThan(0);
      expect(
        baseline.controls.st_gross_cents -
          baseline.controls.st_refunds_cents +
          baseline.controls.st_corrections_cents,
      ).toBe(b.st_signed_report_cents);
      expect(enhanced.controls.bank_signed_cents).toBe(
        baseline.controls.bank_signed_cents + b.next_period_bank_receipts_cents,
      );
      assertConserved(baseline);
      assertConserved(enhanced);
    });
    it('preserves physical source provenance instead of replacing it with sorted row positions', () => {
      for (const event of golden.events.filter((e) => e.st_payment_id)) {
        const row = fixture.st.rows.find((r) => r.source_payment_id === event.st_payment_id);
        expect(row, event.st_payment_id!).toBeDefined();
        const expectedRows = event.source_refs['st_export.csv'].map((r) => r.csv_row_number);
        expect(expectedRows).toContain(row!.source_refs[0].physical_row);
        for (const ref of row!.source_refs) {
          expect(ref.file_sha256).toMatch(/^[a-f0-9]{64}$/);
          expect(ref.raw_row_sha256).toMatch(/^[a-f0-9]{64}$/);
        }
      }
    });
    it('never turns the $20k absence into a confirmed processor hold without its source', () => {
      const payment = fixture.st.rows.find(
        (r) =>
          r.gross_cents === 2_000_000 &&
          fixture.settlements.rows.some(
            (s) => s.payment_id === r.source_payment_id && s.status === 'HELD',
          ),
      )!;
      expect(payment).toBeDefined();
      const minimumGroups = baseline.groups.filter((g) => g.st_ids.includes(payment.id));
      expect(minimumGroups.length).toBeGreaterThan(0);
      expect(
        minimumGroups
          .flatMap((g) => g.diagnoses)
          .filter((d) => d.cause === 'PROCESSOR_HOLD' && d.evidence_level === 'CONFIRMED'),
      ).toEqual([]);
      expect(minimumGroups.every((g) => g.holds_cents === 0)).toBe(true);
      const withEvidence = enhanced.groups.filter((g) => g.st_ids.includes(payment.id));
      expect(withEvidence.some((g) => g.holds_cents === 2_000_000)).toBe(true);
      expect(
        withEvidence
          .flatMap((g) => g.diagnoses)
          .some(
            (d) =>
              d.cause === 'PROCESSOR_HOLD' &&
              ['SUPPORTED', 'CONFIRMED'].includes(d.evidence_level) &&
              d.evidence_refs.length > 0,
          ),
      ).toBe(true);
    });
    it('does not invent the $6,150 office check from a $50k bank gap; enhanced sources support the exact four-part bridge', () => {
      const bank = fixture.bank.rows.find((r) => r.signed_cents === 5_000_000)!;
      expect(bank).toBeDefined();
      const bare = baseline.groups.filter((g) => g.bank_ids.includes(bank.id));
      expect(bare.length).toBeGreaterThan(0);
      expect(bare.every((g) => g.external_receipts_cents === 0)).toBe(true);
      const sourced = enhanced.groups.filter((g) => g.bank_ids.includes(bank.id));
      expect(
        sourced.some(
          (g) =>
            g.accepted &&
            g.external_receipts_cents === 615_000 &&
            g.fees_cents === 315_000 &&
            g.gross_cents === 4_700_000 &&
            g.bank_cents === 5_000_000 &&
            g.unexplained_cents === 0,
        ),
      ).toBe(true);
    });
    it('matches the test-only expected net-fee workpaper total without making that amount importable', () => {
      const expected = golden.events
        .filter((e) => e.ground_truth_cause === 'NET_FEE')
        .reduce((sum, e) => sum + e.fee_cents, 0);
      expect(expected).toBeGreaterThan(0);
      expect(baseline.groups.filter((g) => g.fee_proposal_math_ready)).toEqual([]);
      const workpapers = enhanced.groups.filter((g) => g.fee_proposal_math_ready);
      expect(workpapers.reduce((sum, g) => sum + g.fees_cents, 0)).toBe(expected);
      expect(workpapers.every((g) => !g.fee_aje_draft_eligible)).toBe(true);
    });
    it('removing the external source downgrades the mixed deposit instead of retaining an invented balancing receipt', () => {
      const withoutOfficeSource = structuredClone(fixture.enhanced);
      withoutOfficeSource.evidence!.external_receipts =
        withoutOfficeSource.evidence!.external_receipts!.filter((e) => e.amount_cents !== 615_000);
      withoutOfficeSource.evidence!.deposit_components =
        withoutOfficeSource.evidence!.deposit_components!.filter(
          (e) => e.component_type !== 'OFFICE_CHECK',
        );
      const bank = fixture.bank.rows.find((r) => r.signed_cents === 5_000_000)!;
      const result = reconcile(withoutOfficeSource);
      const groups = result.groups.filter((g) => g.bank_ids.includes(bank.id));
      expect(groups.length).toBeGreaterThan(0);
      expect(groups.every((g) => g.external_receipts_cents === 0)).toBe(true);
      expect(
        groups.every((g) => g.edges.find((e) => e.kind === 'ST_BANK_CASH')!.state !== 'CONFIRMED'),
      ).toBe(true);
      expect(groups.every((g) => !g.fee_aje_draft_eligible)).toBe(true);
    });
    it('never upgrades clearing-only files to MATCHED, verified three-way or importable AJE, even with enhanced evidence', () => {
      for (const result of [baseline, enhanced])
        for (const group of result.groups) {
          expect(group.matching_state).not.toBe('MATCHED');
          expect(group.matching_scope).toBe('ACTIVITY_BRIDGE');
          expect(group.edges.find((e) => e.kind === 'QB_BANK_SETTLEMENT')?.state).not.toBe(
            'CONFIRMED',
          );
          expect(group.fee_aje_draft_eligible).toBe(false);
          expect(group.aje_state).toBe('INELIGIBLE');
        }
    });
    it('does not mistake audit relationship changes or incomplete refund coverage for confirmed accounting errors', () => {
      const unsafe = enhanced.groups
        .flatMap((g) => g.diagnoses)
        .filter(
          (d) =>
            ['POST_EXPORT_DRIFT', 'UNBATCHED_REFUND'].includes(d.cause) &&
            d.evidence_level === 'CONFIRMED',
        );
      expect(unsafe).toEqual([]);
      expect(
        enhanced.groups
          .flatMap((g) => g.diagnoses)
          .some((d) => d.cause === 'POST_EXPORT_DRIFT' && d.evidence_level === 'SUPPORTED'),
      ).toBe(true);
    });
    it('preserves unknown account opening/closing balances as null, never inferred zero', () => {
      expect(baseline.controls.accounts.length).toBeGreaterThan(0);
      for (const account of baseline.controls.accounts) {
        expect(account.opening_cents).toBeNull();
        expect(account.closing_cents).toBeNull();
        expect(account.calculated_closing_cents).toBeNull();
        expect(account.status).toBe('ACTIVITY_ONLY');
      }
      expect(baseline.controls.coverage_confirmed).toBe(false);
    });
    it('does not backdate next-period settlement into the September close', () => {
      const laterIds = new Set(fixture.nextBank.rows.map((b) => b.id));
      const laterGroups = enhanced.groups.filter(
        (g) => g.bank_ids.some((id) => laterIds.has(id)) && g.st_ids.length,
      );
      expect(laterGroups.length).toBeGreaterThan(0);
      expect(laterGroups.every((g) => g.period_status === 'SETTLED_AFTER_CUTOFF')).toBe(true);
    });
    it('remains economically stable under independent source and evidence input reversals', () => {
      const reversed = structuredClone(fixture.enhanced);
      reversed.st.reverse();
      reversed.qb.reverse();
      reversed.bank.reverse();
      reversed.manifests.reverse();
      Object.values(reversed.evidence!).forEach((rows) => rows?.reverse());
      expect(economicSnapshot(reconcile(reversed))).toEqual(economicSnapshot(enhanced));
    });
    it('does not spend duplicate input records or duplicate evidence twice', () => {
      const duplicate = structuredClone(fixture.enhanced);
      duplicate.st.push(...structuredClone(duplicate.st));
      duplicate.qb.push(...structuredClone(duplicate.qb));
      duplicate.bank.push(...structuredClone(duplicate.bank));
      Object.values(duplicate.evidence!).forEach((rows) => rows?.push(...structuredClone(rows)));
      const result = reconcile(duplicate);
      expect(result.controls.st_gross_cents).toBe(enhanced.controls.st_gross_cents);
      expect(result.controls.qb_debits_cents).toBe(enhanced.controls.qb_debits_cents);
      expect(result.controls.bank_signed_cents).toBe(enhanced.controls.bank_signed_cents);
      expect(economicSnapshot(result)).toEqual(economicSnapshot(enhanced));
      assertConserved(result);
    });
  });
}
