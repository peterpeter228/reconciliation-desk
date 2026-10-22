import Papa from 'papaparse';
import type { ReconcileResult } from '../contracts/engine';
import { checkedSum, MAX_CENTS, parseDate, formatCents } from '../ingestion/primitives';
/** Human review CSV, never an accounting-import file. Strings are always neutralized. */
export function safeReviewText(value: unknown): string {
  const s = String(value ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
  return /^[\s]*[=+\-@\t\r\n]/.test(s) ? `'${s}` : s;
}
export function evidenceCsv(result: ReconcileResult): string {
  const fields = [
    'Case ID',
    'Matching state',
    'Scope',
    'Search status',
    'Gross USD',
    'Refunds USD',
    'Fees USD',
    'Holds USD',
    'External receipts USD',
    'Bank USD',
    'Unexplained USD',
    'Diagnosis / evidence level',
    'Evidence references',
    'Missing evidence',
    'AJE state',
  ];
  const data = result.groups.map((g) =>
    [
      g.id,
      g.matching_state,
      g.matching_scope,
      g.search_status,
      formatCents(g.gross_cents),
      formatCents(g.refunds_cents),
      formatCents(g.fees_cents),
      formatCents(g.holds_cents),
      formatCents(g.external_receipts_cents),
      formatCents(g.bank_cents),
      formatCents(g.unexplained_cents),
      g.diagnoses.map((d) => `${d.cause}: ${d.evidence_level}`).join('; '),
      g.evidence_refs.join('; '),
      g.diagnoses.flatMap((d) => d.missing_evidence).join('; '),
      g.aje_state,
    ].map(safeReviewText),
  );
  return Papa.unparse({ fields, data }, { quotes: true, newline: '\r\n' }) + '\r\n';
}
export interface PrintPacket {
  title: string;
  companyLabel: string;
  disclaimer: string;
  summary: { cases: number; grossCents: number; bankCents: number; conservationOk: boolean };
  sections: {
    caseId: string;
    status: string;
    facts: string[];
    missingEvidence: string[];
    evidenceRefs: string[];
    nextAction: string;
  }[];
}
/** Pure structured data. Render strings as React text; never inject HTML or imply defects. */
export function buildPrintPacket(
  result: ReconcileResult,
  companyLabel = 'Company (local review)',
): PrintPacket {
  return {
    title: 'Reconciliation evidence workpaper',
    companyLabel,
    disclaimer:
      'Observed activity differences, not proof of a platform defect. Export does not post a journal. Missing opening/closing or account coverage prevents a verified month-end close.',
    summary: {
      cases: result.groups.length,
      grossCents: result.controls.st_gross_cents,
      bankCents: result.controls.bank_signed_cents,
      conservationOk: result.controls.conservation_ok,
    },
    sections: result.groups.map((g) => ({
      caseId: g.id,
      status: `${g.matching_state} / ${g.matching_scope} / ${g.search_status}`,
      facts: [
        `Gross ${formatCents(g.gross_cents)} USD; bank ${formatCents(g.bank_cents)} USD; unexplained ${formatCents(g.unexplained_cents)} USD.`,
        ...g.diagnoses.map(
          (d) =>
            `${d.cause}: ${d.evidence_level}; evidence score ${d.score}/100, not a probability.`,
        ),
      ],
      missingEvidence: [...new Set(g.diagnoses.flatMap((d) => d.missing_evidence))],
      evidenceRefs: g.evidence_refs,
      nextAction: g.diagnoses.some(
        (d) => d.cause === 'PROCESSOR_HOLD' && d.evidence_level === 'CONFIRMED',
      )
        ? 'Ask the processor to review the evidenced hold and release status.'
        : 'Review the listed missing evidence and source rows before any accounting action.',
    })),
  };
}
export interface UfPayment {
  qbPaymentId: string;
  amountCents: number;
  inUndepositedFunds: boolean | null;
  existingDepositId: string | null;
  /** Must explicitly confirm the lookup covered existing deposit linkage. */
  depositStatusReviewed: boolean;
  statusEvidenceRef: string;
}
export interface UfWorksheetInput {
  /** Legacy/ST identifiers remain candidate references, not verified QB IDs. */
  paymentIds: string[];
  bankAccount: string;
  depositDate: string;
  grossCents: number;
  feeCents: number;
  payments?: UfPayment[];
  bankAccountVerified?: boolean;
  bankNetCents?: number;
  bankEvidenceRef?: string;
  feeAccount?: string;
  feeAccountVerified?: boolean;
  feeEvidenceRef?: string;
  feeNotRecordedConfirmed?: boolean;
}
export interface UfWorksheet extends UfWorksheetInput {
  kind: 'UF_BANK_DEPOSIT_WORKSHEET';
  importEligible: false;
  status: 'CANDIDATE' | 'REVIEWED_INSTRUCTIONS';
  explanation: string;
  expectedNetCents: number;
  negativeFeeCents: number;
  missingEvidence: string[];
  steps: string[];
}
export function buildUfWorksheet(input: UfWorksheetInput): UfWorksheet {
  const validMoney = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_CENTS;
  if (
    !input.paymentIds.length ||
    !validMoney(input.grossCents) ||
    !validMoney(input.feeCents) ||
    input.grossCents <= 0 ||
    input.feeCents > input.grossCents
  )
    throw new Error('Valid candidate references and documented amounts are required.');
  if (input.depositDate) parseDate(input.depositDate, 'ISO');
  const payments = input.payments ?? [];
  if (
    payments.some(
      (p) => !p.qbPaymentId.trim() || !validMoney(p.amountCents) || p.amountCents <= 0,
    ) ||
    new Set(payments.map((p) => p.qbPaymentId)).size !== payments.length
  )
    throw new Error('QB payment references must be distinct with positive integer amounts.');
  const missingEvidence: string[] = [];
  if (!input.depositDate) missingEvidence.push('Review the deposit date.');
  if (!payments.length)
    missingEvidence.push(
      'Locate actual QuickBooks Payment IDs; ST IDs alone are candidate references.',
    );
  if (payments.length && checkedSum(payments.map((p) => p.amountCents)) !== input.grossCents)
    missingEvidence.push('QB payment total does not equal the proposed gross deposit.');
  for (const payment of payments) {
    if (
      payment.inUndepositedFunds !== true ||
      payment.depositStatusReviewed !== true ||
      payment.existingDepositId !== null ||
      !payment.statusEvidenceRef.trim()
    )
      missingEvidence.push(
        `Verify ${payment.qbPaymentId} is currently in UF and not already linked to a deposit, with source evidence.`,
      );
  }
  if (!input.bankAccount.trim() || input.bankAccountVerified !== true)
    missingEvidence.push('Verify the target existing bank account.');
  if (input.bankNetCents !== input.grossCents - input.feeCents || !input.bankEvidenceRef?.trim())
    missingEvidence.push('Verify the bank net amount and its source against the proposed deposit.');
  if (
    input.feeCents > 0 &&
    (!input.feeAccount?.trim() ||
      input.feeAccountVerified !== true ||
      !input.feeEvidenceRef?.trim() ||
      input.feeNotRecordedConfirmed !== true)
  )
    missingEvidence.push(
      'Verify the expense account, documented net fee and that the fee is not already posted.',
    );
  const reviewed = missingEvidence.length === 0;
  return {
    ...input,
    kind: 'UF_BANK_DEPOSIT_WORKSHEET',
    importEligible: false,
    status: reviewed ? 'REVIEWED_INSTRUCTIONS' : 'CANDIDATE',
    explanation:
      'Human review workpaper only. A journal entry does not link existing Undeposited Funds payments to a deposit.',
    expectedNetCents: input.grossCents - input.feeCents,
    negativeFeeCents: -input.feeCents,
    missingEvidence,
    steps: reviewed
      ? [
          `In QuickBooks Bank Deposit, select these existing QB Payments: ${payments.map((p) => p.qbPaymentId).join(', ')}.`,
          `Use the reviewed bank account ${input.bankAccount} and deposit date ${input.depositDate}.`,
          ...(input.feeCents > 0
            ? [
                `Add a negative ${formatCents(-input.feeCents)} USD fee line to ${input.feeAccount}, supported by ${input.feeEvidenceRef}. Do not add a second already-recorded expense.`,
              ]
            : []),
          'Match any existing Bank Feed item to the saved deposit instead of categorizing another receipt.',
          'Re-export Deposit Detail and GL to verify payment links, accounts, date and net amount.',
        ]
      : [
          'Candidate investigation only: do not select payments or create a deposit from these unverified references.',
          ...missingEvidence,
          'Check existing deposits and fee postings before preparing reviewed instructions; never categorize a duplicate bank receipt.',
        ],
  };
}
