import Papa from 'papaparse';
import type { ReconcileResult } from '../contracts/engine';
import { formatCents } from '../ingestion/primitives';
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
export interface UfWorksheet {
  kind: 'UF_BANK_DEPOSIT_WORKSHEET';
  importEligible: false;
  explanation: string;
  paymentIds: string[];
  bankAccount: string;
  depositDate: string;
  grossCents: number;
  feeCents: number;
  expectedNetCents: number;
  steps: string[];
}
export function buildUfWorksheet(input: {
  paymentIds: string[];
  bankAccount: string;
  depositDate: string;
  grossCents: number;
  feeCents: number;
}): UfWorksheet {
  if (
    !input.paymentIds.length ||
    !input.bankAccount ||
    !Number.isSafeInteger(input.grossCents) ||
    !Number.isSafeInteger(input.feeCents) ||
    input.grossCents <= 0 ||
    input.feeCents < 0 ||
    input.feeCents > input.grossCents
  )
    throw new Error('Valid payment linkage and documented amounts are required.');
  return {
    ...input,
    kind: 'UF_BANK_DEPOSIT_WORKSHEET',
    importEligible: false,
    explanation: 'A journal entry does not link existing Undeposited Funds payments to a deposit.',
    expectedNetCents: input.grossCents - input.feeCents,
    steps: [
      'Verify the listed existing payments and any existing bank deposit before making changes.',
      'In QuickBooks Bank Deposit / Record Deposits, select the original payments.',
      'If supported by settlement evidence, add the negative fee line using the verified expense account.',
      'Match any existing Bank Feed item instead of categorizing a duplicate.',
      'Re-export Deposit Detail and GL to verify payment links, accounts, date and net amount.',
    ],
  };
}
