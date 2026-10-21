import { describe, expect, it } from 'vitest';
import type { AccountingConfirmation, ReconcileInput } from '../../src/contracts/engine';
import { reconcile } from '../../src/engine';
import { receiptOptions } from '../../src/engine/edges';
import { normalize } from '../../src/engine/normalize';
import { bank, example, ledger, manifest, payment, provenance, statement } from '../engine/helpers';

function confirmation(over: Partial<AccountingConfirmation> = {}): AccountingConfirmation {
  return {
    id: 'confirmation',
    company_id: 'company',
    currency: 'USD',
    bank_account_id: 'bank',
    source_refs: [provenance('review')],
    evidence_ref: 'review:2',
    deposit_reference: 'd1',
    qb_transaction_id: 'deposit',
    bank_effect_cents: 9700,
    expense_coverage_confirmed: true,
    fee_not_recorded: true,
    clearing_account_id: 'clearing',
    fee_account_name: 'Merchant Fees',
    accounts_verified: true,
    period_open: true,
    reviewer: 'Test Reviewer',
    ...over,
  };
}
function feeCase(): ReconcileInput {
  const input = example();
  input.st[0]!.payment_method = 'CARD';
  input.st[0]!.fee_mode = 'NETTED';
  input.bank[0]!.signed_cents = 9700;
  Object.assign(input.qb[1]!, { credit_cents: 9700, signed_cents: -9700 });
  Object.assign(input.qb[2]!, { debit_cents: 9700, signed_cents: 9700 });
  input.evidence = { settlements: [statement()], confirmations: [confirmation()] };
  return input;
}
function refundCase(): ReconcileInput {
  const input = example();
  input.st = [1000, 2000].map((amount, i) =>
    payment({
      id: `refund-${i + 1}`,
      source_payment_id: `r${i + 1}`,
      record_type: 'REFUND',
      accounting_batch_id: null,
      gross_cents: -amount,
      export_status: 'PENDING',
    }),
  );
  input.qb = input.st
    .map((r, i) =>
      ledger({
        id: `qb-refund-${i + 1}`,
        transaction_id: `refund-receipt-${i + 1}`,
        line_id: `rr${i + 1}`,
        accounting_batch_id: null,
        linked_payment_id: r.source_payment_id,
        debit_cents: 0,
        credit_cents: -r.gross_cents,
        signed_cents: r.gross_cents,
      }),
    )
    .concat([
      ledger({
        id: 'qb-settle',
        transaction_id: 'deposit',
        line_id: 'settlement',
        role: 'CLEARING_SETTLEMENT',
        accounting_batch_id: null,
        linked_deposit_id: 'd1',
        debit_cents: 3000,
        signed_cents: 3000,
      }),
      ledger({
        id: 'qb-bank',
        transaction_id: 'deposit',
        line_id: 'bank',
        role: 'BANK',
        account_id: 'bank',
        account_type: 'BANK',
        account_full_name: 'Collections Bank',
        accounting_batch_id: null,
        linked_deposit_id: 'd1',
        debit_cents: 0,
        credit_cents: 3000,
        signed_cents: -3000,
      }),
    ]);
  input.bank = [bank({ signed_cents: -3000, bank_type: 'DEBIT' })];
  input.evidence = {
    settlements: input.st.map((r, i) =>
      statement({
        id: `settlement-${i + 1}`,
        evidence_ref: `processor:${i + 2}`,
        payment_id: r.source_payment_id!,
        accounting_batch_id: null,
        status: 'REFUNDED',
        gross_cents: r.gross_cents,
        fee_cents: 0,
        net_cents: r.gross_cents,
      }),
    ),
    confirmations: [
      confirmation({
        bank_effect_cents: -3000,
        expense_coverage_confirmed: false,
        fee_not_recorded: false,
        refund_coverage_confirmed: true,
        refund_not_recorded: true,
        batching_due_date: '2026-09-10',
      }),
    ],
  };
  return input;
}

describe('Argon P1-1: nonfinal settlement amounts are not realized cash or fees', () => {
  it.each(['PENDING', 'UNKNOWN', 'HELD'] as const)(
    'does not turn %s projections into final cash or a fee draft',
    (status) => {
      const input = feeCase();
      Object.assign(input.evidence!.settlements![0]!, { status, actual_settlement_date: null });
      const result = reconcile(input);
      const group = result.groups.find((g) => g.st_ids.includes('st-1'))!;
      expect(group.fees_cents).toBe(0);
      expect(group.edges.find((e) => e.kind === 'ST_BANK_CASH')!.state).not.toBe('CONFIRMED');
      expect(group.fee_proposal_math_ready).toBe(false);
      expect(group.fee_aje_draft_eligible).toBe(false);
      expect(group.aje_state).toBe('INELIGIBLE');
      expect(result.allocations).toHaveLength(0);
    },
  );
  it.each(['PENDING', 'UNKNOWN'] as const)(
    'rejects a %s statement that claims an actual settlement date',
    (status) => {
      const input = feeCase();
      input.evidence!.settlements![0]!.status = status;
      const result = reconcile(input);
      expect(result.warnings.some((w) => w.code === 'INVALID_EVIDENCE')).toBe(true);
      expect(result.allocations).toHaveLength(0);
      expect(result.groups.every((g) => g.aje_state === 'INELIGIBLE')).toBe(true);
    },
  );
  it('allows incomplete pending forecast evidence without treating missing amounts as zero-fee settlement', () => {
    const input = feeCase();
    Object.assign(input.evidence!.settlements![0]!, {
      status: 'PENDING',
      actual_settlement_date: null,
      fee_cents: null,
      net_cents: null,
      settlement_reference: null,
      scheduled_settlement_date: '2026-10-02',
    });
    const result = reconcile(input);
    expect(result.warnings.some((w) => w.code === 'INVALID_EVIDENCE')).toBe(false);
    expect(result.groups.every((g) => !g.accepted && !g.fee_aje_draft_eligible)).toBe(true);
    expect(result.groups.every((g) => g.fees_cents === 0)).toBe(true);
  });
  it('does not count a pending projected hold or release as a realized component', () => {
    const input = feeCase();
    Object.assign(input.evidence!.settlements![0]!, {
      status: 'PENDING',
      actual_settlement_date: null,
      held_cents: 100,
      released_cents: 100,
    });
    const group = reconcile(input).groups.find((g) => g.st_ids.includes('st-1'))!;
    expect([group.fees_cents, group.holds_cents, group.releases_cents]).toEqual([0, 0, 0]);
    expect(group.fee_aje_draft_eligible).toBe(false);
  });
  it('rejects a refund terminal status attached to an original payment', () => {
    const input = feeCase();
    input.evidence!.settlements![0]!.status = 'REFUNDED';
    const result = reconcile(input);
    expect(result.warnings.some((w) => w.code === 'INVALID_EVIDENCE')).toBe(true);
    expect(result.allocations).toHaveLength(0);
  });
  it('preserves settled fee eligibility and allows settlement earlier than the schedule', () => {
    const input = feeCase();
    input.evidence!.settlements![0]!.scheduled_settlement_date = '2026-09-04';
    expect(reconcile(input).groups[0]!.aje_state).toBe('DRAFT');
  });
  it('rejects an actual settlement after its own observation date', () => {
    const input = feeCase();
    input.evidence!.settlements![0]!.as_of_date = '2026-09-01';
    const result = reconcile(input);
    expect(result.warnings.some((w) => w.code === 'INVALID_EVIDENCE')).toBe(true);
    expect(result.allocations).toHaveLength(0);
  });
});

describe('Argon P2-1: refund diagnosis requires itemized coverage and deduplication', () => {
  it('does not reuse a deposit-level confirmation for two refunds', () => {
    const result = reconcile(refundCase());
    const diagnoses = result.groups
      .flatMap((g) => g.diagnoses)
      .filter((d) => d.cause === 'UNBATCHED_REFUND');
    expect(diagnoses).toHaveLength(1);
    expect(diagnoses[0]!.evidence_level).not.toBe('CONFIRMED');
  });
  it('requires independent settlement evidence for every included refund', () => {
    const input = refundCase();
    input.evidence!.settlements!.pop();
    const diagnoses = reconcile(input)
      .groups.flatMap((g) => g.diagnoses)
      .filter((d) => d.cause === 'UNBATCHED_REFUND');
    expect(diagnoses).toHaveLength(1);
    expect(diagnoses[0]!.evidence_level).not.toBe('CONFIRMED');
  });
  it('does not extend one itemized attestation to a second refund', () => {
    const input = refundCase();
    input.evidence!.confirmations![0]!.refund_payment_id = 'r1';
    const diagnoses = reconcile(input)
      .groups.flatMap((g) => g.diagnoses)
      .filter((d) => d.cause === 'UNBATCHED_REFUND');
    expect(diagnoses).toHaveLength(1);
    expect(diagnoses[0]!.evidence_level).toBe('SUPPORTED');
    expect(diagnoses[0]!.missing_evidence).toContain('QB_REFUND_OBJECT_AND_ACCOUNT_COVERAGE');
  });
  it('confirms one aggregate diagnosis only when every refund has its own settlement and review', () => {
    const input = refundCase();
    const base = input.evidence!.confirmations![0]!;
    input.evidence!.confirmations = ['r1', 'r2'].map((refund_payment_id, i) => ({
      ...base,
      id: `review-${i + 1}`,
      evidence_ref: `review:${i + 2}`,
      refund_payment_id,
    }));
    const result = reconcile(input);
    const diagnoses = result.groups
      .flatMap((g) => g.diagnoses)
      .filter((d) => d.cause === 'UNBATCHED_REFUND');
    expect(diagnoses).toHaveLength(1);
    expect(diagnoses[0]!.evidence_level).toBe('CONFIRMED');
    expect(diagnoses[0]!.evidence_refs).toEqual([
      'processor:2',
      'processor:3',
      'review:2',
      'review:3',
    ]);
    expect(diagnoses[0]!.missing_evidence).toEqual([]);
    expect(result.controls.conservation_ok).toBe(true);
    const reordered = reconcile({
      ...input,
      st: [...input.st].reverse(),
      qb: [...input.qb].reverse(),
      evidence: { ...input.evidence, confirmations: [...input.evidence!.confirmations!].reverse() },
    });
    expect(reordered.groups).toEqual(result.groups);
    input.evidence!.settlements!.pop();
    expect(
      reconcile(input)
        .groups.flatMap((g) => g.diagnoses)
        .find((d) => d.cause === 'UNBATCHED_REFUND')!.evidence_level,
    ).toBe('SUPPORTED');
  });
  it('rejects a refund attestation for a payment outside the imported refund records', () => {
    const input = refundCase();
    input.evidence!.confirmations![0]!.refund_payment_id = 'not-present';
    const result = reconcile(input);
    expect(result.warnings.some((w) => w.code === 'INVALID_EVIDENCE')).toBe(true);
    expect(result.allocations).toHaveLength(0);
  });
  it('blocks conflicting itemized attestations instead of selecting the favorable one', () => {
    const input = refundCase();
    const base = { ...input.evidence!.confirmations![0]!, refund_payment_id: 'r1' };
    input.evidence!.confirmations = [
      base,
      { ...base, id: 'conflicting', refund_not_recorded: false },
    ];
    const result = reconcile(input);
    expect(result.warnings.some((w) => w.code === 'CONTRADICTORY_ACCOUNTING_CONFIRMATIONS')).toBe(
      true,
    );
    expect(result.allocations).toHaveLength(0);
    expect(
      result.groups.flatMap((g) => g.diagnoses).every((d) => d.evidence_level !== 'CONFIRMED'),
    ).toBe(true);
  });
});

describe('Argon batch membership observation', () => {
  it('keeps an exported payment and refund together in their documented accounting batch', () => {
    const input = example();
    input.bank = [];
    input.st.push(
      payment({
        id: 'refund',
        source_payment_id: 'refund',
        record_type: 'REFUND',
        gross_cents: -2000,
        deposit_id: null,
      }),
    );
    input.qb = [ledger({ debit_cents: 8000, signed_cents: 8000 })];
    const result = reconcile(input);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0]!.st_ids).toEqual(['refund', 'st-1']);
    expect(result.groups[0]!.edges[0]!.state).toBe('CONFIRMED');
    expect(result.groups[0]!.gross_cents).toBe(10000);
    expect(result.groups[0]!.refunds_cents).toBe(2000);
    expect(result.controls.conservation_ok).toBe(true);
  });
  it('rejects partial accounting-batch membership that omits its refund', () => {
    const input = example();
    input.st.push(
      payment({
        id: 'refund',
        source_payment_id: 'refund',
        record_type: 'REFUND',
        gross_cents: -2000,
      }),
    );
    const ctx = normalize(input);
    const options = receiptOptions(
      ctx.st.filter((r) => r.record_type === 'PAYMENT'),
      ctx,
      input,
    );
    expect(options[0]!.edge.state).toBe('CONTRADICTED');
    expect(options[0]!.edge.missing_evidence).toContain('COMPLETE_BATCH_MEMBERSHIP');
  });
});

describe('Argon P0-1: deliberately unsupported split bank deposit', () => {
  it('never treats a shared deposit ID as authorization to aggregate bank transactions', () => {
    const input = example();
    input.bank = [
      bank({ signed_cents: 6000 }),
      bank({ id: 'bank-2', source_transaction_id: 'tx2', signed_cents: 4000 }),
    ];
    input.manifests.push(
      manifest('RECEIPT', { source_file_sha256: provenance('receipt').file_sha256 }),
    );
    input.evidence = {
      deposit_components: [
        {
          id: 'component',
          company_id: 'company',
          currency: 'USD',
          bank_account_id: 'bank',
          source_refs: [provenance('receipt')],
          evidence_ref: 'receipt:2',
          deposit_reference: 'd1',
          component_reference: 'c1',
          payment_id: 'p1',
          component_type: 'ST_CHECK',
          gross_cents: 10000,
          fee_cents: 0,
          net_cents: 10000,
          bank_amount_cents: 10000,
          posted_date: '2026-09-02',
          fee_mode: 'GROSS_SETTLED',
          contract_reference: null,
        },
      ],
    };
    const result = reconcile(input);
    expect(result.allocations).toHaveLength(0);
    expect(result.groups).toHaveLength(2);
    expect(result.groups.every((g) => g.matching_state === 'AMBIGUOUS' && !g.accepted)).toBe(true);
    expect(result.groups.every((g) => g.warnings.includes('COMPONENT_BANK_CONTROL_MISMATCH'))).toBe(
      true,
    );
    expect(result.controls.conservation_ok).toBe(true);
  });
  it('preserves the explicit same-payment multiple-settlement block', () => {
    const input = feeCase();
    input.evidence!.settlements!.push(statement({ id: 'second-settlement' }));
    const result = reconcile(input);
    expect(result.warnings.some((w) => w.code === 'UNSUPPORTED_SPLIT_SETTLEMENT')).toBe(true);
    expect(result.allocations).toHaveLength(0);
  });
});
