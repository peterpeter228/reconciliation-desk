// Diagnostic source replay, not browser proof. Uses synthetic inputs only.
import { readFileSync, writeFileSync } from 'node:fs';
import { parseSource, parseXlsx, type ParseOptions } from '../../src/ingestion';
import { reconcile, type ReconcileInput } from '../../src/engine';
const base: ParseOptions = {
  companyId: 'SYNTHETIC_DEMO',
  bankAccountId: 'DEMO_BANK',
  companyTimezone: 'America/New_York',
  periodStart: '2026-09-01',
  periodEnd: '2026-09-30',
  asOfDate: '2026-09-30',
  currency: 'USD',
  profile: 'synthetic-v1',
  rowGrain: 'PAYMENT',
  exportMode: 'JE_TO_CLEARING',
  postedLedgerConfirmed: true,
  bankPostedConfirmed: true,
  coverageConfirmed: true,
  basis: 'ACCRUAL',
};
const manual: ParseOptions = {
  ...base,
  companyId: 'SYNTHETIC_QA',
  bankAccountId: 'Synthetic checking',
  profile: 'manual',
  dateFormat: 'MDY',
  bankName: '',
  bankSignConvention: 'INFLOW_POSITIVE',
  headerRow: 1,
  accountMap: {
    'ServiceTitan Clearing': {
      accountType: 'OTHER_CURRENT_ASSET',
      role: 'CLEARING',
      isUndepositedFunds: false,
    },
  },
};
const directory = 'evidence/browser-20261021-followup';
async function replay(options: ParseOptions, xlsx: boolean) {
  const st = xlsx
    ? await parseXlsx(
        new Uint8Array(
          readFileSync('evidence/browser-20261021-followup/synthetic-upload-multisheet.xlsx'),
        ),
        'ST',
        { ...options, sheetName: 'Payments', fileName: 'synthetic-multisheet.xlsx' },
      )
    : await parseSource(readFileSync('samples/st_export.csv', 'utf8'), 'ST', {
        ...options,
        fileName: 'st_export.csv',
      });
  const qb = await parseSource(readFileSync('samples/qbo_clearing_gl.csv', 'utf8'), 'QBO', {
    ...options,
    fileName: 'qbo_clearing_gl.csv',
  });
  const bank = await parseSource(readFileSync('samples/chase_bank.csv', 'utf8'), 'BANK', {
    ...options,
    fileName: 'chase_bank.csv',
  });
  if (![st, qb, bank].every((x) => x.ok)) throw new Error('Diagnostic parse failed.');
  const config = {
    company_id: options.companyId,
    bank_account_id: options.bankAccountId,
    period_cutoff: options.periodEnd,
    ...(xlsx
      ? { clearing_split_semantics_confirmed: false }
      : {
          qb_bank_account_names: ['Collections Checking'],
          clearing_split_semantics_confirmed: true,
        }),
  };
  const result = reconcile({
    st: st.rows,
    qb: qb.rows,
    bank: bank.rows,
    manifests: [st.manifest!, qb.manifest!, bank.manifest!],
    config,
  } as ReconcileInput);
  const counts = (rows: object[], field: string) =>
    Object.fromEntries(
      [...new Set(rows.map((r) => String((r as Record<string, unknown>)[field])))].map((value) => [
        value,
        rows.filter((r) => String((r as Record<string, unknown>)[field]) === value).length,
      ]),
    );
  const browser = JSON.parse(
    readFileSync(`${directory}/${xlsx ? 'upload' : 'baseline'}-browser-evidence.json`, 'utf8'),
  );
  const controls = Object.fromEntries(
    Object.entries(result.controls).filter(([, v]) => typeof v !== 'object'),
  );
  const observed = Object.fromEntries(
    Object.entries(browser.result.controls).filter(([, v]) => typeof v !== 'object'),
  );
  return {
    options,
    config,
    source_rows: [st.rows.length, qb.rows.length, bank.rows.length],
    source_hashes: [
      st.manifest!.source_file_sha256,
      qb.manifest!.source_file_sha256,
      bank.manifest!.source_file_sha256,
    ],
    normalized: {
      st_export_status_basis: counts(st.rows, 'export_status_basis'),
      st_fee_mode: counts(st.rows, 'fee_mode'),
      qb_roles: counts(qb.rows, 'role'),
      qb_linked_deposit_ids: qb.rows.filter((r) => r.linked_deposit_id !== null).length,
      qb_accounting_batch_ids: qb.rows.filter((r) => r.accounting_batch_id !== null).length,
      bank_deposit_ids: bank.rows.filter((r) => r.deposit_id !== null).length,
    },
    groups: result.groups.length,
    allocations: result.allocations.length,
    controls,
    browser_comparison: {
      groups: browser.result.groups.length,
      allocations: browser.result.allocations.length,
      controls_equal: JSON.stringify(controls) === JSON.stringify(observed),
    },
  };
}
const comparison = {
  scope:
    'Synthetic source replay explaining distinct browser workflows; no claim of manual/demo semantic equivalence',
  demo: await replay(base, false),
  manual: await replay(manual, true),
};
writeFileSync(
  `${directory}/import-profile-comparison.json`,
  JSON.stringify(comparison, null, 2) + '\n',
);
console.log(JSON.stringify(comparison, null, 2));
