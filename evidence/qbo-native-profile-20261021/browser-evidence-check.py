from pathlib import Path
import hashlib,json,sys
base=Path(__file__).resolve().parent
p=json.loads((base/(sys.argv[1] if len(sys.argv)>1 else 'browser-native-evidence.json')).read_text())
q=next(m for m in p['manifests'] if m['source_system']=='QBO')
r=q['qbo_transaction_journal']; g=r['groups'][0]; controls=p['result']['controls']
original=base.parent/'quickbooks-acceptance-20261021/target-transaction-journal-145.csv'
assert q['source_file_sha256']==hashlib.sha256(original.read_bytes()).hexdigest()
assert q['normalized_row_count']==2 and q['header_row']==5
assert r['scope']=='TRANSACTION_GROUPS' and r['report_company_name']=="Craig's Design and Landscaping Services"
assert g['transaction_id']=='145' and g['journal_num']=='RDCE641C900E'
assert g['group_physical_row']==6 and g['posting_physical_rows']==[7,8] and g['total_physical_row']==9
assert r['total_physical_row']==10 and r['footer_physical_row']==14
assert r['debit_cents']==r['credit_cents']==g['debit_cents']==g['credit_cents']==90000
assert q['coverage_confirmed'] is False and controls['coverage_confirmed'] is False
assert all(a['coverage_confirmed'] is False and a['status']=='ACTIVITY_ONLY' for a in controls['accounts'])
assert controls['conservation_ok'] is True and p['result']['allocations']==[]
assert not any(g['accepted'] for g in p['result']['groups'])
# The intentionally minimal ST fixture has no success status, so it is retained but not eligible cash.
st=next(a for a in controls['atoms'] if a['source']=='ST')
assert st['source_cents']==90000 and st['excluded_reason']=='UNSUCCESSFUL_PAYMENT_EXCLUDED'
assert controls['st_gross_cents']==0
print('PASS: unchanged CSV hash, 2 rows, transaction 145 distinct from Num, physical provenance, $900 balanced controls, no full-period coverage or false acceptance; ST exclusion explained.')
