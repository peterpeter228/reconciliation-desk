import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  parseSource,
  type ParseOptions,
  type RowByKind,
  type SourceKind,
} from '../../src/ingestion';
import type { ReconcileInput } from '../../src/contracts/engine';

export const options: ParseOptions = {
  companyId: 'integration-company',
  bankAccountId: 'collections-account',
  companyTimezone: 'America/New_York',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  asOfDate: '2026-09-30',
  currency: 'USD',
  profile: 'synthetic-v1',
  basis: 'ACCRUAL',
};
export async function parseFile<K extends SourceKind>(
  directory: string,
  file: string,
  kind: K,
  overrides: Partial<ParseOptions> = {},
) {
  const source = await readFile(join(directory, file), 'utf8');
  const result = await parseSource(source, kind, { ...options, ...overrides, fileName: file });
  if (!result.ok || !result.manifest) {
    throw new Error(
      `${file} failed actual ${kind} import: ${JSON.stringify(result.issues.filter((i) => i.severity === 'error').slice(0, 8))}`,
    );
  }
  return result as typeof result & { manifest: NonNullable<typeof result.manifest> };
}
export async function parseText<K extends SourceKind>(
  text: string,
  kind: K,
  overrides: Partial<ParseOptions> = {},
): Promise<RowByKind[K][]> {
  const result = await parseSource(text, kind, { ...options, ...overrides });
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.rows;
}
export async function loadFixture(directory: string) {
  const [st, qb, bank, settlements, components, receipts, audits, nextBank] = await Promise.all([
    parseFile(directory, 'st_export.csv', 'ST'),
    parseFile(directory, 'qbo_clearing_gl.csv', 'QBO'),
    parseFile(directory, 'chase_bank.csv', 'BANK'),
    parseFile(directory, 'processor_settlements.csv', 'PROCESSOR'),
    parseFile(directory, 'deposit_components.csv', 'COMPONENT'),
    parseFile(directory, 'external_receipts.csv', 'RECEIPT'),
    parseFile(directory, 'st_audit_events.csv', 'AUDIT'),
    parseFile(directory, 'bank_next_period.csv', 'BANK', {
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      asOfDate: '2026-10-31',
    }),
  ]);
  const baseline: ReconcileInput = {
    st: st.rows,
    qb: qb.rows,
    bank: bank.rows,
    manifests: [st.manifest, qb.manifest, bank.manifest],
    config: {
      company_id: options.companyId,
      bank_account_id: options.bankAccountId,
      period_cutoff: options.periodEnd,
      calendar: { holidays: ['2026-09-07'], version: 'fixture-weekdays-labor-day' },
      clearing_split_semantics_confirmed: true,
      qb_bank_account_names: ['Chase Checking'],
      search: { budget_ms: 2000, total_budget_ms: 10000 },
    },
  };
  const enhanced: ReconcileInput = {
    ...structuredClone(baseline),
    bank: [...bank.rows, ...nextBank.rows],
    manifests: [
      ...baseline.manifests,
      settlements.manifest,
      components.manifest,
      receipts.manifest,
      audits.manifest,
      nextBank.manifest,
    ],
    evidence: {
      settlements: settlements.rows,
      deposit_components: components.rows,
      external_receipts: receipts.rows,
      audit_events: audits.rows,
    },
  };
  return { baseline, enhanced, st, qb, bank, settlements, components, receipts, audits, nextBank };
}
export type LoadedFixture = Awaited<ReturnType<typeof loadFixture>>;
