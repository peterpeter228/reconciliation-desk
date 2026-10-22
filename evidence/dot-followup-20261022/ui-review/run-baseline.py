"""Run against a disposable 42d677e worktree; never modifies its production code."""
from pathlib import Path
import shutil, subprocess, sys
root = Path.cwd()
baseline = Path(sys.argv[1]).resolve()
output = root / 'evidence/dot-followup-20261022/ui-review'
for name in ['tests/dot-ui-review', 'tests/fixtures/fee-case-csv']:
    shutil.copytree(root/name, baseline/name, dirs_exist_ok=True)
# Summary/register did not exist at baseline; avoid module-resolution failures.
(baseline/'tests/dot-ui-review/summary-register.test.ts').unlink()
p = baseline/'tests/claude-review'
p.mkdir(exist_ok=True)
for name in ['fee-case-fixture.ts', 'ui-safety.test.tsx']:
    shutil.copy2(root/'tests/claude-review'/name,p/name)
(baseline/'tests/dot-ui-review/favicon.test.ts').write_text('''import { it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
it('F10 baseline contains explicit local favicon', () => {
  expect(readFileSync('index.html','utf8')).toContain('<link rel="icon" href="data:,"/>');
});
''')
if not (baseline/'node_modules').exists():
    (baseline/'node_modules').symlink_to(root/'node_modules',target_is_directory=True)
proc=subprocess.run(['npm','test','--','tests/dot-ui-review','tests/claude-review/ui-safety.test.tsx','-t','F02|F07|F03|F09|F08|F10|F-02|F-09'],cwd=baseline,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
(output/'baseline-red.txt').write_text(proc.stdout)
print('baseline negative-control exit',proc.returncode)
f=p/'ui-safety.test.tsx'; s=f.read_text(); a=s.index("describe('F-09 an export"); b=s.index('    const stale =',a)
s=s[:b]+"    // Isolate the registry from the independent baseline multi-mapping length defect.\n    base.result.versions.mapping = ['synthetic-single-mapping-v1'];\n"+s[b:]
f.write_text(s)
proc=subprocess.run(['npm','test','--','tests/claude-review/ui-safety.test.tsx','-t','blocks a second journal'],cwd=baseline,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
(output/'baseline-F08-isolated-red.txt').write_text(proc.stdout)
print('baseline F08 isolated negative-control exit',proc.returncode)
