import {chromium} from '/opt/codex/cua_node/lib/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
const out=process.env.QA_OUT;
const b=await chromium.launch({executablePath:'/usr/bin/chromium',chromiumSandbox:true,headless:false});
const c=await b.newContext();const p=await c.newPage();const records=[];
p.on('request',r=>records.push({event:'request',url:r.url()}));p.on('response',r=>records.push({event:'response',url:r.url(),status:r.status()}));p.on('console',m=>records.push({event:'console',type:m.type(),text:m.text(),location:m.location()}));
await p.goto('http://127.0.0.1:4174/');await p.getByRole('button',{name:'Use my files'}).waitFor();await p.screenshot({path:out+'/baseline-landing.png'});await p.waitForTimeout(2000);
fs.writeFileSync(out+'/baseline-browser.json',JSON.stringify(records,null,2));await b.close();
