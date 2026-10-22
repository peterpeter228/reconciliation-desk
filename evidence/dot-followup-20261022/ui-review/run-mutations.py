from pathlib import Path
import shutil, subprocess, json
root=Path.cwd(); isolated=Path('/tmp/reconciliation-ui-mutations')
if isolated.exists(): shutil.rmtree(isolated)
isolated.mkdir()
for name in ['src','tests','contracts','public']:
 shutil.copytree(root/name, isolated/name)
for name in ['index.html','package.json','tsconfig.json','vitest.config.ts','vite.config.ts']:
 shutil.copy2(root/name, isolated/name)
(isolated/'node_modules').symlink_to(root/'node_modules',target_is_directory=True)
out=root/'evidence/dot-followup-20261022/ui-review'
mutations=[
 ('F02','src/app.tsx',lambda s:s.replace('if (workspace && dirty) {','if (false) {'),'tests/dot-ui-review/replacement.test.tsx','keeps import promise pending'),
 ('F07','src/app.tsx',lambda s:s.replace("window.addEventListener('beforeunload', warn);",'// MUTANT: unload protection removed'),'tests/dot-ui-review/replacement.test.tsx','unsaved edit installs unload'),
 ('F03','src/components/CaseReview.tsx',lambda s:s.replace('search for journal number','review records elsewhere'),'tests/dot-ui-review/presentation.test.tsx','F03 prior export'),
 ('F08','src/review/export-register.ts',lambda s:s.replace('if (existing.length) return','if (false) return'),'tests/dot-ui-review/summary-register.test.ts','serialized reservation'),
 ('F09','src/export/case-summary.ts',lambda s:s[:s.index('const escapeHtml')]+'const escapeHtml = (value: unknown) => String(value ?? "");\n'+s[s.index('const usd'):],'tests/dot-ui-review/summary-register.test.ts','escapes every hostile'),
 ('F10','index.html',lambda s:s.replace('<link rel="icon" href="data:,"/>',''),'tests/dot-ui-review/summary-register.test.ts','F10 explicitly'),
]
results=[]
for id,file,mutate,test,name in mutations:
 p=isolated/file; orig=p.read_text(); changed=mutate(orig); assert changed!=orig,id
 p.write_text(changed)
 proc=subprocess.run(['npm','test','--',test,'-t',name],cwd=isolated,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 (out/f'mutation-{id}-red.txt').write_text(proc.stdout)
 p.write_text(orig)
 restored=subprocess.run(['npm','test','--',test,'-t',name],cwd=isolated,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
 (out/f'mutation-{id}-restored.txt').write_text(restored.stdout)
 results.append({'finding':id,'test':name,'mutatedExit':proc.returncode,'restoredExit':restored.returncode,'file':file})
 print(results[-1],flush=True)
(out/'mutation-results.json').write_text(json.dumps(results,indent=2)+'\n')

