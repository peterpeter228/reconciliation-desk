"""Isolated-copy mutation audit. Run from repository root; never edits shared sources."""
from pathlib import Path
import tempfile, shutil, subprocess, hashlib, json
root = Path.cwd()
out = root / 'evidence/dot-followup-20261022/source-review'
with tempfile.TemporaryDirectory(prefix='dot-source-mutations-') as td:
    temp = Path(td)
    for name in ['src','tests']:
        shutil.copytree(root/name,temp/name)
    for name in ['package.json','vitest.config.ts','tsconfig.json']:
        shutil.copy(root/name,temp/name)
    (temp/'node_modules').symlink_to(root/'node_modules', target_is_directory=True)
    file = temp/'src/review/case-adapter.ts'
    original = file.read_text()
    cases = [
        ('F01','  if (untrusted) throw new Error(untrusted);','  // mutation: omit source trust guard', ['tests/dot-source-review/acceptance.test.ts','-t','F01 baseline']),
        ('F04','const caseRows = w.input.qb.filter((x) => g.qb_ids.includes(x.id));','const caseRows = [];', ['tests/claude-review/ui-safety.test.tsx','-t','stays a candidate when the GL already']),
        ('F05','mappingVersion: mappingSetVersion(w),', "mappingVersion: w.result.versions.mapping.join('|') || 'reviewed-mapping',", ['tests/dot-source-review/acceptance.test.ts','-t','F05 baseline']),
        ('F06',"if (qbBank?.state !== 'CONFIRMED')",'if (false)', ['tests/dot-source-review/acceptance.test.ts','-t','F06 baseline']),
    ]
    results=[]
    for label,old,new,args in cases:
        assert original.count(old)==1,(label,original.count(old))
        file.write_text(original.replace(old,new))
        command=[str(temp/'node_modules/.bin/vitest'),'run',*args]
        result=subprocess.run(command,cwd=temp,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        (out/f'mutation-{label}-red.txt').write_text('Mutation: '+old+' => '+new+'\nCommand: vitest run '+' '.join(args)+'\n'+result.stdout)
        file.write_text(original)
        restored=subprocess.run(command,cwd=temp,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
        (out/f'mutation-{label}-restored.txt').write_text(restored.stdout)
        results.append({'finding':label,'mutation_exit':result.returncode,'restored_exit':restored.returncode,'restored_sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
        assert result.returncode==1 and restored.returncode==0,(label,result.stdout,restored.stdout)
    (out/'mutation-results.json').write_text(json.dumps(results,indent=2)+'\n')
    print(json.dumps(results,indent=2))
