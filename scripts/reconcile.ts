import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseSource, type ParseOptions } from '../src/ingestion';
import { reconcile } from '../src/engine';
import type { ReconcileInput } from '../src/contracts/engine';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i < 0 ? undefined : args[i + 1];
};
if (args.includes('--help')) {
  console.log(
    'Usage: npm run reconcile -- --st file.csv --qb gl.csv --bank bank.csv --profile options.json [--processor file.csv] [--components file.csv] [--receipts file.csv] [--audit file.csv] [--out result.json]\nProfile is explicit ParseOptions. This local CLI never logs into financial systems.',
  );
  process.exit(0);
}
try {
  const profilePath = flag('--profile');
  if (!profilePath || !flag('--st') || !flag('--qb') || !flag('--bank'))
    throw new Error('Required: --st, --qb, --bank and --profile. See --help.');
  const options = JSON.parse(await readFile(resolve(profilePath), 'utf8')) as ParseOptions;
  const load = async <K extends Parameters<typeof parseSource>[1]>(path: string, kind: K) => {
    const result = await parseSource(await readFile(resolve(path), 'utf8'), kind, {
      ...options,
      fileName: path,
    });
    if (!result.ok)
      throw new Error(
        `${kind} import blocked: ${result.issues.map((i) => `${i.code}${i.physicalRow ? ` at row ${i.physicalRow}` : ''}`).join(', ')}`,
      );
    return result;
  };
  const st = await load(flag('--st')!, 'ST');
  const qb = await load(flag('--qb')!, 'QBO');
  const bank = await load(flag('--bank')!, 'BANK');
  const input: ReconcileInput = {
    st: st.rows,
    qb: qb.rows,
    bank: bank.rows,
    manifests: [st.manifest!, qb.manifest!, bank.manifest!],
    evidence: {},
    config: {
      company_id: options.companyId,
      bank_account_id: options.bankAccountId,
      period_cutoff: options.periodEnd,
      clearing_split_semantics_confirmed: options.profile === 'synthetic-v1',
    },
  };
  if (flag('--processor')) {
    const r = await load(flag('--processor')!, 'PROCESSOR');
    input.evidence!.settlements = r.rows;
    input.manifests.push(r.manifest!);
  }
  if (flag('--components')) {
    const r = await load(flag('--components')!, 'COMPONENT');
    input.evidence!.deposit_components = r.rows;
    input.manifests.push(r.manifest!);
  }
  if (flag('--receipts')) {
    const r = await load(flag('--receipts')!, 'RECEIPT');
    input.evidence!.external_receipts = r.rows;
    input.manifests.push(r.manifest!);
  }
  if (flag('--audit')) {
    const r = await load(flag('--audit')!, 'AUDIT');
    input.evidence!.audit_events = r.rows;
    input.manifests.push(r.manifest!);
  }
  const start = performance.now();
  const result = reconcile(input);
  const report = {
    schema_version: '1.0',
    created_at: new Date().toISOString(),
    scope: 'local review; no posting',
    duration_ms: performance.now() - start,
    manifests: input.manifests,
    result,
  };
  const output = JSON.stringify(report, null, 2) + '\n';
  if (flag('--out')) await writeFile(resolve(flag('--out')!), output);
  else process.stdout.write(output);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Local reconciliation failed.');
  process.exitCode = 1;
}
