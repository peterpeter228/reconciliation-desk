/** Browser presentation oracle from the actual parser/engine, never an answer key.
 * This checks UI consistency; independent engine-correctness tests live in tests/.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseSource, type ParseOptions, type SourceKind } from '../../src/ingestion';
import { reconcile } from '../../src/engine';
import type { ReconcileInput } from '../../src/contracts/engine';
const root = process.env.RECONCILIATION_ROOT || process.cwd();
const options: ParseOptions = { companyId:'SYNTHETIC_DEMO',bankAccountId:'DEMO_BANK',companyTimezone:'America/New_York',periodStart:'2026-09-01',periodEnd:'2026-09-30',asOfDate:'2026-09-30',currency:'USD',profile:'synthetic-v1',rowGrain:'PAYMENT',exportMode:'JE_TO_CLEARING',postedLedgerConfirmed:true,bankPostedConfirmed:true,coverageConfirmed:true,basis:'ACCRUAL' };
async function load<K extends SourceKind>(name: string, kind: K, override: Partial<ParseOptions> = {}) {
 const text = await readFile(resolve(root,'public/demo',name),'utf8');
 const parsed = await parseSource(text,kind,{...options,...override,fileName:name});
 assert(parsed.ok && parsed.manifest, `${name}: ${JSON.stringify(parsed.issues)}`);
 return parsed;
}
const st = await load('st_export.csv','ST'), qb = await load('qbo_clearing_gl.csv','QBO'), bank = await load('chase_bank.csv','BANK');
const input: ReconcileInput = {st:st.rows,qb:qb.rows,bank:bank.rows,manifests:[st.manifest!,qb.manifest!,bank.manifest!],config:{company_id:options.companyId,bank_account_id:options.bankAccountId,period_cutoff:options.periodEnd,qb_bank_account_names:['Collections Checking'],clearing_split_semantics_confirmed:true}};
const baseline = reconcile(input);
const parsedPaymentGross = st.rows.filter(r=>r.record_type==='PAYMENT').reduce((sum,r)=>{assert(Number.isSafeInteger(sum+r.gross_cents));return sum+r.gross_cents;},0);
assert.equal(baseline.controls.st_gross_cents,parsedPaymentGross,'Control must use supplied PAYMENT receipts, not original economic-event gross.');
assert(baseline.controls.conservation_ok);
assert(!baseline.groups.flatMap(g=>g.diagnoses).some(d=>d.cause==='PROCESSOR_HOLD'&&d.evidence_level==='CONFIRMED'));
const settlements=await load('processor_settlements.csv','PROCESSOR'), audits=await load('st_audit_events.csv','AUDIT'), receipts=await load('external_receipts.csv','RECEIPT'), components=await load('deposit_components.csv','COMPONENT'), next=await load('bank_next_period.csv','BANK',{periodStart:'2026-10-01',periodEnd:'2026-10-07',asOfDate:'2026-10-07'});
const enhanced = reconcile({...structuredClone(input),bank:[...bank.rows,...next.rows],manifests:[...input.manifests,settlements.manifest!,audits.manifest!,receipts.manifest!,components.manifest!,next.manifest!],evidence:{settlements:settlements.rows,audit_events:audits.rows,external_receipts:receipts.rows,deposit_components:components.rows}});
assert.equal(enhanced.controls.st_gross_cents,parsedPaymentGross);
assert(enhanced.controls.conservation_ok);
const hold = enhanced.groups.find(g=>g.impact_cents===2000000&&g.diagnoses.some(d=>d.cause==='PROCESSOR_HOLD'));
assert(hold,'The 20k case must include actual processor evidence.');
const holdDiagnosis = hold.diagnoses.find(d=>d.cause==='PROCESSOR_HOLD')!;
assert.equal(holdDiagnosis.evidence_level,'SUPPORTED','Missing release coverage must not produce a confirmed hold.');
assert(holdDiagnosis.evidence_refs.length>0);
assert(holdDiagnosis.missing_evidence.includes('BANK_AND_PROCESSOR_RELEASE_COVERAGE_THROUGH_HOLD_AS_OF'));
assert(enhanced.groups.every(g=>!g.fee_aje_draft_eligible),'Sample main-run lacks complete bank/expense proof.');
const summary = {source:'Real parser and engine on public/demo CSVs; no answer key',isBrowserExecution:false,baseline:{st_gross_cents:baseline.controls.st_gross_cents,parsed_payment_gross_cents:parsedPaymentGross,source_hashes:[st,qb,bank].map(p=>p.manifest!.source_file_sha256)},enhanced:{st_gross_cents:enhanced.controls.st_gross_cents,hold:{impact_cents:hold.impact_cents,diagnosis:holdDiagnosis},main_run_import_eligible:false}};
process.stdout.write(JSON.stringify(summary,null,2)+'\n');
