from pathlib import Path
import hashlib,json
base=Path(__file__).resolve().parent
repo=base.parents[2]
checks=[]
for name,source in [
 ('native-csv-evidence.json',repo/'evidence/quickbooks-acceptance-20261021/target-transaction-journal-145.csv'),
 ('values-only-xlsx-evidence.json',base/'SYNTHETIC_DERIVED_VALUES_ONLY_NOT_NATIVE.xlsx')
]:
    p=json.loads((base/name).read_text()); q=next(m for m in p['manifests'] if m['source_system']=='QBO'); j=q['qbo_transaction_journal']; g=j['groups'][0]; c=p['result']['controls']
    assert q['source_file_sha256']==hashlib.sha256(source.read_bytes()).hexdigest()
    assert q['normalized_row_count']==2 and q['raw_row_count']==6 and q['header_row']==5
    assert q['excluded_summary_rows']==[1,2,3,4,6,9,10,11,12,13,14]
    assert j['scope']=='TRANSACTION_GROUPS' and j['report_company_name']=="Craig's Design and Landscaping Services"
    assert g['transaction_id']=='145' and g['journal_num']=='RDCE641C900E'
    assert g['group_physical_row']==6 and g['posting_physical_rows']==[7,8] and g['total_physical_row']==9
    assert j['total_physical_row']==10 and j['footer_physical_row']==14
    assert j['debit_cents']==j['credit_cents']==g['debit_cents']==g['credit_cents']==90000
    assert q['coverage_confirmed'] is False and c['coverage_confirmed'] is False
    assert all(a['coverage_confirmed'] is False and a['status']=='ACTIVITY_ONLY' for a in c['accounts'])
    assert c['conservation_ok'] is True and p['result']['allocations']==[]
    assert not any(g['accepted'] for g in p['result']['groups'])
    st=next(a for a in c['atoms'] if a['source']=='ST')
    assert st['source_cents']==90000 and st['excluded_reason']=='UNSUCCESSFUL_PAYMENT_EXCLUDED'
    checks.append({'file':name,'run_id':p['run_id'],'checks':'PASS','qb_rows':2,'transaction_id':'145','debits_cents':90000,'credits_cents':90000,'coverage_confirmed':False})
p=json.loads((base/'manual-evidence.json').read_text())
assert [m['normalized_row_count'] for m in p['manifests']]==[1,1,1]
assert not any(m.get('qbo_transaction_journal') for m in p['manifests'])
assert p['result']['controls']['conservation_ok'] is True
for f in p['source_files']:
    assert f['hash']==hashlib.sha256((base/f['name']).read_bytes()).hexdigest()
assert all(a['status']=='ACTIVITY_ONLY' for a in p['result']['controls']['accounts'])
checks.append({'file':'manual-evidence.json','run_id':p['run_id'],'checks':'PASS','source_rows':[1,1,1]})
original=repo/'evidence/quickbooks-acceptance-20261021/target-transaction-journal-145.xlsx'
assert hashlib.sha256(original.read_bytes()).hexdigest()=='ac1b896b3377199496c67132968e8e61949f388eaa7a13c43ed52fcace95e033'
print(json.dumps({'checks':checks,'original_native_xlsx_unchanged':True,'cancellation_notice':'INCONCLUSIVE in browser; no pending-read observation before settings change'},indent=2))
