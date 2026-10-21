import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
const walk=async(dir)=>{const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const p=join(dir,e.name);if(e.isDirectory())out.push(...await walk(p));else out.push(p);}return out;};
const files=await walk('dist');const errors=[];
for(const path of files){
 if(/ground_truth|answer_key|test_.*\.py|\.env(?:\.|$)/i.test(path))errors.push('Prohibited artifact: '+path);
 if(/\.(?:js|json|html)$/.test(path)){
  const s=await readFile(path,'utf8');
  if(/ground_truth_cause|expected_minimum_three_files|fee_aje_draft_eligible\":\s*false,\s*\"expected/.test(s))errors.push('Test-answer content in production: '+path);
  if(/sk-[A-Za-z0-9]{20,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/.test(s))errors.push('Possible credential in production: '+path);
 }
}
if(!files.includes('dist/_headers'))errors.push('Missing host security-header template');
if(errors.length){console.error(errors.join('\n'));process.exit(1);}
console.log(JSON.stringify({files:files.length,answer_key_absent:true,credential_pattern_scan:'no_match',headers_template_present:true,scope:'Static artifact checks only; not a guarantee of safety or deployed headers.'},null,2));
