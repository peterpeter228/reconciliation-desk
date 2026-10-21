import { describe, expect, it } from 'vitest';
import {
  reconcile,
  boundedSubsetSum,
  businessAdd,
  sha256,
  feeInBand,
  sumCents,
  typedIdentity,
} from '../../src/engine';
import { bank, example, ledger, manifest, payment, provenance, statement } from './helpers';

describe('exact deterministic primitives', () => {
  it('uses SHA-256 rather than an unstable or non-collision-resistant source fingerprint', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  it('uses typed identities and never substring batch matches', () => {
    expect(typedIdentity('c', 'ST', 'accounting_batch', '123')).not.toBe(
      typedIdentity('c', 'ST', 'processor_batch', '123'),
    );
    const data = example();
    data.qb[0]!.accounting_batch_id = 'b1234';
    expect(reconcile(data).groups.some((g) => g.edges[0]?.state === 'CONFIRMED')).toBe(false);
  });
  it('skips weekends and actual settlement holidays without moving Saturday July 4 to Friday', () => {
    expect(businessAdd('2026-09-04', 1)).toBe('2026-09-08');
    expect(businessAdd('2026-07-02', 1)).toBe('2026-07-03');
  });
  it('checks aggregate safe-integer overflow and integer band boundaries', () => {
    expect(() => sumCents([Number.MAX_SAFE_INTEGER, 1])).toThrow();
    expect(feeInBand(10000, 150, 'CARD')).toBe(true);
    expect(feeInBand(10000, 149, 'CARD')).toBe(false);
    expect(feeInBand(100_000_000_000, 3_800_000_000, 'CARD')).toBe(true);
  });
  it('returns ambiguity for two distinct ID solutions', () => {
    const r = boundedSubsetSum(
      [
        { id: 'a', cents: 100 },
        { id: 'b', cents: 100 },
      ],
      100,
    );
    expect(r.status).toBe('AMBIGUOUS');
    expect(r.solutions).toHaveLength(2);
  });
  it('does not hide candidates above caps', () => {
    expect(
      boundedSubsetSum(
        Array.from({ length: 29 }, (_, i) => ({ id: String(i), cents: 100 })),
        100,
      ).status,
    ).toBe('CANDIDATE_CAP');
  });
  it('keeps cardinality incompleteness even with an apparent single solution', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ id: String(i), cents: 100 }));
    expect(boundedSubsetSum(items, 900).status).toBe('CARDINALITY_CAP');
    expect(boundedSubsetSum([...items, { id: 'big', cents: 900 }], 900).status).toBe(
      'CARDINALITY_CAP',
    );
  });
  it('returns unique only when extra cardinality is impossible', () => {
    expect(
      boundedSubsetSum(
        [
          { id: 'a', cents: 3 },
          { id: 'b', cents: 4 },
          { id: 'c', cents: 9 },
        ],
        7,
      ).status,
    ).toBe('UNIQUE_CANDIDATE');
  });
  it('never calls a timed-out search no-match', () => {
    expect(boundedSubsetSum([{ id: 'a', cents: 100 }], 100, { budget_ms: 0 }).status).toBe(
      'TIMEOUT',
    );
    expect(boundedSubsetSum([{ id: 'a', cents: 100 }], 100, { max_nodes: 1 }).status).toBe(
      'TIMEOUT',
    );
  });
  it('rejects negative subset inputs and duplicate IDs', () => {
    expect(() => boundedSubsetSum([{ id: 'a', cents: -100 }], 100)).toThrow();
    expect(() =>
      boundedSubsetSum(
        [
          { id: 'a', cents: 10 },
          { id: 'a', cents: 20 },
        ],
        100,
      ),
    ).toThrow();
  });
});

describe('three independent edges and source budgets', () => {
  it('confirms three edges only after actual posted bank leg is present', () => {
    const a = reconcile(example(false));
    expect(a.groups).toHaveLength(1);
    expect(a.groups[0]!.edges.map((e) => e.state)).toEqual(['CONFIRMED', 'SUPPORTED', 'CONFIRMED']);
    expect(a.groups[0]!.matching_state).toBe('PARTIAL');
    expect(a.groups[0]!.matching_scope).toBe('ACTIVITY_BRIDGE');
    const b = reconcile(example());
    expect(b.groups[0]!.matching_scope).toBe('VERIFIED_THREE_WAY');
  });
  it('consumes a payment once even though both E1 and E3 reference it', () => {
    const r = reconcile(example());
    expect(r.allocations.filter((a) => a.atom_id === 'st-1')).toHaveLength(1);
    expect(r.controls.atoms.find((a) => a.atom_id === 'st-1')!.residual_cents).toBe(0);
    expect(r.controls.conservation_ok).toBe(true);
  });
  it('preserves ambiguity across two posted bank claims on one receipt', () => {
    const input = example(false);
    input.bank.push(bank({ id: 'bank-2', source_transaction_id: 'tx2' }));
    const r = reconcile(input);
    expect(r.groups.every((g) => g.matching_state === 'AMBIGUOUS')).toBe(true);
    expect(r.allocations).toHaveLength(0);
  });
  it('does not automatically accept unique amount/date without identity', () => {
    const i = example(false);
    i.st[0]!.deposit_id = null;
    const r = reconcile(i);
    expect(r.groups.every((g) => !g.accepted)).toBe(true);
    expect(r.groups.some((g) => g.edges[2]?.state === 'CANDIDATE')).toBe(true);
  });
  it('keeps two equal-value real payments rather than deduplicating them', () => {
    const i = example(false);
    i.st = [
      payment({ deposit_id: null }),
      payment({ id: 'st-2', source_payment_id: 'p2', accounting_batch_id: 'b2', deposit_id: null }),
    ];
    i.qb.push(
      ledger({
        id: 'qb-r2',
        transaction_id: 'receipt2',
        line_id: 'lr2',
        accounting_batch_id: 'b2',
      }),
    );
    const r = reconcile(i);
    expect(r.controls.st_gross_cents).toBe(20000);
    expect(r.allocations).toHaveLength(0);
    expect(r.groups.some((g) => g.matching_state === 'AMBIGUOUS')).toBe(true);
  });
  it('normalizes repeated payment applications without triple cash', () => {
    const i = example();
    i.st = [1, 2, 3].map((n) =>
      payment({
        id: `application-${n}`,
        row_grain: 'PAYMENT_APPLICATION',
        invoice_allocations: [{ invoice_id: `invoice-${n}`, applied_cents: n === 3 ? 4000 : 3000 }],
      }),
    );
    const r = reconcile(i);
    expect(r.controls.st_gross_cents).toBe(10000);
    expect(r.groups[0]!.gross_cents).toBe(10000);
    expect(r.controls.conservation_ok).toBe(true);
  });
  it('is idempotent across the exact same source reimport', () => {
    const i = example();
    i.st.push(structuredClone(i.st[0]!));
    i.qb.push(...structuredClone(i.qb));
    const r = reconcile(i);
    expect(r.controls.st_gross_cents).toBe(10000);
    expect(r.controls.qb_debits_cents).toBe(20000);
  });
  it('never counts a summary and its detail twice', () => {
    const i = example(false);
    i.qb.push(ledger({ id: 'summary', line_id: 'summary', line_grain: 'TRANSACTION_SUMMARY' }));
    i.st.push(
      payment({ id: 'batch-summary', source_payment_id: null, row_grain: 'BATCH_SUMMARY' }),
    );
    const r = reconcile(i);
    expect(r.controls.st_gross_cents).toBe(10000);
    expect(r.controls.qb_debits_cents).toBe(10000);
  });
  it('rejects cross-company and fractional cents without allocations', () => {
    for (const patch of [{ company_id: 'other' }, { gross_cents: 100.1 }]) {
      const i = example();
      Object.assign(i.st[0]!, patch);
      const r = reconcile(i);
      expect(r.allocations).toHaveLength(0);
      expect(r.groups.every((g) => g.matching_state === 'BLOCKED')).toBe(true);
    }
  });
  it('retains bank feed rows outside posted-ledger matching', () => {
    const i = example();
    i.qb[2]!.is_posted_ledger = false;
    const r = reconcile(i);
    expect(r.groups[0]!.matching_state).toBe('PARTIAL');
    expect(r.groups[0]!.edges[1]!.state).toBe('SUPPORTED');
    expect(r.controls.atoms.find((a) => a.atom_id === 'qb-bank')!.excluded_reason).toBe(
      'BANK_FEED_REVIEW_IS_NOT_LEDGER',
    );
  });
  it('keeps account residuals separate instead of cancelling', () => {
    const i = example(false);
    i.st = [];
    i.bank = [];
    i.qb = [
      ledger({
        id: 'a',
        account_id: 'A',
        account_full_name: 'A',
        debit_cents: 900,
        credit_cents: 0,
        signed_cents: 900,
      }),
      ledger({
        id: 'b',
        transaction_id: 'other',
        line_id: 'other',
        account_id: 'B',
        account_full_name: 'B',
        debit_cents: 0,
        credit_cents: 900,
        signed_cents: -900,
      }),
    ];
    const r = reconcile(i);
    expect(r.controls.accounts.map((a) => a.activity_cents)).toEqual([900, -900]);
    expect(r.controls.accounts.every((a) => a.status === 'ACTIVITY_ONLY')).toBe(true);
  });
  it('blocks a failed per-account rollforward', () => {
    const i = example(false);
    i.manifests[1]!.account_balances = [
      {
        account_id: 'clearing',
        account_full_name: 'ST Clearing',
        opening_debit_balance_cents: 0,
        closing_debit_balance_cents: 500,
        coverage_confirmed: true,
      },
    ];
    expect(reconcile(i).allocations).toHaveLength(0);
    expect(reconcile(i).controls.accounts[0]!.status).toBe('MISMATCH');
  });
  it('keeps economic results invariant under source row ordering', () => {
    const i = example();
    const a = reconcile(i),
      b = reconcile({
        ...i,
        st: [...i.st].reverse(),
        qb: [...i.qb].reverse(),
        bank: [...i.bank].reverse(),
      });
    expect(b.groups.map((g) => [g.id, g.matching_state, g.gross_cents])).toEqual(
      a.groups.map((g) => [g.id, g.matching_state, g.gross_cents]),
    );
  });
});

describe('hard evidence gates and honest unknowns', () => {
  it('never calls missing settlement a processor hold', () => {
    const i = example(false);
    i.bank = [];
    i.qb = [i.qb[0]!];
    const r = reconcile(i);
    expect(r.groups[0]!.warnings).toContain('MISSING_SETTLEMENT');
    expect(r.groups.flatMap((g) => g.diagnoses).some((d) => d.cause === 'PROCESSOR_HOLD')).toBe(
      false,
    );
  });
  it('requires release coverage to confirm an explicit hold', () => {
    const i = example(false);
    i.bank = [];
    i.qb = [i.qb[0]!];
    i.evidence = {
      settlements: [
        statement({
          status: 'HELD',
          settlement_reference: null,
          fee_cents: null,
          net_cents: null,
          held_cents: 10000,
        }),
      ],
    };
    expect(
      reconcile(i).groups[0]!.diagnoses.find((d) => d.cause === 'PROCESSOR_HOLD')!.evidence_level,
    ).toBe('SUPPORTED');
    i.evidence.settlements![0]!.release_coverage_confirmed = true;
    expect(
      reconcile(i).groups[0]!.diagnoses.find((d) => d.cause === 'PROCESSOR_HOLD')!.evidence_level,
    ).toBe('CONFIRMED');
  });
  it('keeps 3% band evidence suspected and never fabricates a fee', () => {
    const i = example(false);
    i.st[0]!.payment_method = 'CARD';
    i.st[0]!.deposit_id = null;
    i.bank[0]!.signed_cents = 9700;
    i.qb[1]!.credit_cents = 9700;
    i.qb[1]!.signed_cents = -9700;
    const g = reconcile(i).groups[0]!;
    expect(g.fees_cents).toBe(0);
    expect(g.diagnoses.find((d) => d.cause === 'NET_FEE_DRIFT')!.evidence_level).toBe('SUSPECTED');
    expect(g.aje_state).toBe('INELIGIBLE');
  });
  it('does not label a documented 3% reserve as a fee', () => {
    const i = example(false);
    i.bank[0]!.signed_cents = 9700;
    i.qb[1]!.credit_cents = 9700;
    i.qb[1]!.signed_cents = -9700;
    i.evidence = { settlements: [statement({ fee_cents: 0, held_cents: 300, net_cents: 9700 })] };
    const r = reconcile(i);
    expect(r.groups[0]!.holds_cents).toBe(300);
    expect(r.groups[0]!.diagnoses.some((d) => d.cause === 'NET_FEE_DRIFT')).toBe(false);
  });
  it('does not net separate-invoice financing by brand or a 9% gap', () => {
    const i = example(false);
    i.st[0]!.payment_method = 'FINANCING';
    i.st[0]!.fee_mode = 'SEPARATE_INVOICE';
    i.st[0]!.processor = 'GreenSky';
    i.bank[0]!.signed_cents = 9100;
    i.qb[1]!.credit_cents = 9100;
    i.qb[1]!.signed_cents = -9100;
    expect(
      reconcile(i)
        .groups.flatMap((g) => g.diagnoses)
        .some((d) => d.cause === 'NET_FEE_DRIFT'),
    ).toBe(false);
  });
  it('documented net fee without QB bank/expense coverage remains workpaper only', () => {
    const i = example(false);
    i.bank[0]!.signed_cents = 9700;
    i.qb[1]!.credit_cents = 9700;
    i.qb[1]!.signed_cents = -9700;
    i.evidence = { settlements: [statement()] };
    const g = reconcile(i).groups[0]!;
    expect(g.fees_cents).toBe(300);
    expect(g.fee_proposal_math_ready).toBe(true);
    expect(g.fee_aje_draft_eligible).toBe(false);
    expect(g.diagnoses.find((d) => d.cause === 'NET_FEE_DRIFT')!.evidence_level).toBe('SUPPORTED');
  });
  it('enables a draft only with an itemized missing-fee confirmation and full posted bank leg', () => {
    const i = example();
    i.bank[0]!.signed_cents = 9700;
    i.qb[1]!.credit_cents = 9700;
    i.qb[1]!.signed_cents = -9700;
    i.qb[2]!.debit_cents = 9700;
    i.qb[2]!.signed_cents = 9700;
    i.evidence = {
      settlements: [statement()],
      confirmations: [
        {
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
        },
      ],
    };
    const g = reconcile(i).groups[0]!;
    expect(g.aje_state).toBe('DRAFT');
    expect(g.approved_proposal_hash).toBe(null);
    i.st[0]!.export_mode = 'PAYMENT_TO_UF';
    expect(reconcile(i).groups[0]!.aje_state).toBe('INELIGIBLE');
  });
  it('never treats payment correction as a bank refund', () => {
    const i = example();
    i.st.push(
      payment({
        id: 'correction',
        source_payment_id: 'p1a',
        original_payment_id: 'p1',
        record_type: 'PAYMENT_CORRECTION',
        gross_cents: -2000,
        accounting_batch_id: null,
      }),
    );
    const g = reconcile(i).groups[0]!;
    expect(g.refunds_cents).toBe(0);
    expect(g.diagnoses.find((d) => d.cause === 'POST_EXPORT_DRIFT')!.evidence_level).not.toBe(
      'CONFIRMED',
    );
  });
  it('rejects mismatched merchant evidence instead of forcing an equation', () => {
    const i = example();
    i.st[0]!.merchant_id = 'm1';
    i.evidence = { settlements: [statement({ merchant_id: 'm2' })] };
    const r = reconcile(i);
    expect(r.allocations).toHaveLength(0);
    expect(r.warnings.some((w) => w.code === 'INVALID_EVIDENCE')).toBe(true);
  });
  it('does not confirm date lag from future bank without complete cutoff coverage', () => {
    const i = example();
    i.bank[0]!.posted_date = '2026-10-02';
    i.manifests[2] = manifest('BANK', {
      period_start: '2026-10-01',
      period_end: '2026-10-31',
      as_of_date: '2026-10-31',
    });
    const g = reconcile(i).groups[0]!;
    expect(g.period_status).toBe('SETTLED_AFTER_CUTOFF');
    expect(g.diagnoses.find((d) => d.cause === 'DATE_LAG')!.evidence_level).not.toBe('CONFIRMED');
  });
});

describe('conflicting authoritative evidence', () => {
  it('blocks a known deposit conflict even if amounts balance perfectly', () => {
    const i = example();
    i.st[0]!.deposit_id = 'other-known-deposit';
    i.evidence = { settlements: [statement({ fee_cents: 0, net_cents: 10000 })] };
    const r = reconcile(i);
    expect(r.allocations).toHaveLength(0);
    expect(r.groups.every((g) => g.matching_state === 'BLOCKED')).toBe(true);
  });
  it('cannot choose the favorable confirmation while another says the fee is already recorded', () => {
    const i = example();
    i.bank[0]!.signed_cents = 9700;
    i.qb[1]!.credit_cents = 9700;
    i.qb[1]!.signed_cents = -9700;
    i.qb[2]!.debit_cents = 9700;
    i.qb[2]!.signed_cents = 9700;
    const confirmation = {
      id: 'confirmation',
      company_id: 'company',
      currency: 'USD' as const,
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
    };
    i.evidence = {
      settlements: [statement()],
      confirmations: [
        confirmation,
        { ...confirmation, id: 'conflicting-confirmation', fee_not_recorded: false },
      ],
    };
    const r = reconcile(i);
    expect(r.allocations).toHaveLength(0);
    expect(r.groups.every((g) => g.aje_state === 'INELIGIBLE')).toBe(true);
    expect(r.warnings.some((w) => w.code === 'CONTRADICTORY_ACCOUNTING_CONFIRMATIONS')).toBe(true);
  });
});
