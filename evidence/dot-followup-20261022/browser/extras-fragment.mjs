// Additional actual-browser flows. No synthetic dispatch or hidden state mutation.
{
 const ctx = await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const tabs = [await ctx.newPage(), await ctx.newPage()];
 await check('EXTRA-two-real-tabs-same-case-export', async()=>{
  for(const [i,p] of tabs.entries()){
   watch(p,`concurrent-${i}`); await p.goto(BASE);
   await upload(labelOf(p,'Open review project'),approvedSave.file);
   await p.getByText('Review project restored and recalculated').waitFor();
   await upload(labelOf(p,'Choose original files'),['st_payments.csv','qbo_general_ledger.csv','bank_activity.csv','processor_settlement.csv'].map(input));
   await p.locator('section.source-verification').getByText('All re-verified').waitFor();
   await click(p.locator('.queue-list > *',{hasText:'Settlement fee difference'}).first());
   const r=p.locator('section.case-review');
   await click(r.locator('details').first().locator('summary'));
   await click(r.getByRole('button',{name:'Build supported fee-only draft'}));
   await tick(r.getByLabel(/I reviewed these exact accounts, date, amounts/));
   await click(r.getByRole('button',{name:'Approve exact proposal'}));
   await r.getByRole('heading',{name:/^APPROVED · RD/}).waitFor();
  }
  const ds=[];for(const [i,p] of tabs.entries())p.on('download',d=>ds.push({i,d}));
  await Promise.all(tabs.map(p=>p.getByRole('button',{name:'Download approved QBO CSV'}).click()));
  await tabs[0].waitForTimeout(1200);
  for(const {i,d} of ds)await d.saveAs(out(`concurrent-tab${i}-${d.suggestedFilename()}`));
  assert(ds.length===2,`Expected exactly 1 CSV+manifest across 2 actual tabs; got ${ds.length}`);
  assert(new Set(ds.map(x=>x.i)).size===1,'both tabs downloaded');
  for(const [i,p]of tabs.entries())await p.screenshot({path:out(`concurrent-tab${i}.png`)});
  return `Two actual pages, shared storage and Web Locks; one winner, ${ds.length} downloads total`;
 });
 await check('EXTRA-print-main-app-PDF',async()=>{
  const p=tabs[0];await click(p.getByRole('button',{name:'Exports',exact:true}));
  await click(p.getByRole('button',{name:/Evidence summary/}));
  await p.locator('.print-summary').waitFor({state:'attached'});
  await p.pdf({path:out('evidence-summary.pdf'),format:'A4',printBackground:true});
  assert(fs.readFileSync(out('evidence-summary.pdf')).subarray(0,4).toString()==='%PDF','invalid PDF');
  return 'Visible Evidence summary Print / Save as PDF control, Chromium print renderer produced PDF; native print dialog not asserted';
 });
 await ctx.close();
}
record('EXTRA-screen-reader','BLOCKED','No supported screen reader integration in this environment; accessibility tree is not screen reader acceptance.');
async function importedPage(ctx,qb,mode='JE_TO_CLEARING',keyboard=false){
 const p=await ctx.newPage(); watch(p,keyboard?'keyboard-import':qb);await p.goto(BASE);
 async function focus(loc){for(let n=0;n<100;n++){if(await loc.evaluate(el=>el===document.activeElement))return;await p.keyboard.press('Tab');}throw Error('Control not reachable in 100 Tabs');}
 const act=async loc=>{if(keyboard){await focus(loc);await p.keyboard.press('Enter');}else await click(loc);};
 const val=async(loc,v)=>{if(keyboard){await focus(loc);await p.keyboard.press('Control+A');await p.keyboard.type(v);}else await fill(loc,v);};
 const pick=async(loc,v)=>{if(keyboard){await focus(loc);await p.keyboard.press('Home');for(let n=0;n<15;n++){if(await loc.inputValue()===v)return;await p.keyboard.press('ArrowDown');}throw Error('Keyboard select option unavailable');}else await select(loc,v);};
 await act(p.getByRole('button',{name:'Use my files'}));
 for(const [title,file]of [['ServiceTitan','st_payments.csv'],['QuickBooks',qb],['Bank','bank_activity.csv']]){
  if(keyboard){await focus(card(p,title));const[fc]=await Promise.all([p.waitForEvent('filechooser'),p.keyboard.press('Space')]);await fc.setFiles(input(file));}else await upload(card(p,title),input(file));
  await p.locator('.upload-card',{hasText:file}).waitFor(); await p.waitForFunction(()=>!document.querySelector('.upload-card button.file-picker:disabled'));
 }
 await val(p.getByLabel('Company label'),'Synthetic native browser review');await val(p.getByLabel('Bank account label'),'Collections Checking');
 await pick(p.getByLabel('QuickBooks report scope'),'ACCOUNT_ACTIVITY');
 await val(p.getByLabel('Clearing account, exact GL name'),mode==='PAYMENT_TO_UF'?'Undeposited Funds':'ServiceTitan Clearing');
 await val(p.getByLabel(/QuickBooks bank account, exact GL name/),'Collections Checking');await pick(p.getByLabel('ServiceTitan export mode'),mode);
 if(keyboard){await focus(p.locator('.quality-confirmation input[type=checkbox]'));await p.keyboard.press('Space');}else await tick(p.locator('.quality-confirmation input[type=checkbox]'));
 await act(p.getByRole('button',{name:'Validate files'}));await p.getByRole('button',{name:'Reconcile these files'}).waitFor();
 await p.screenshot({path:out(`${qb}-mapping.png`),fullPage:true});
 await act(p.getByRole('button',{name:'Reconcile these files'}));await p.getByText('Reconciliation complete').waitFor({timeout:20000});
 if(!keyboard){await click(p.getByRole('button',{name:'Add evidence'}).first());await upload(p.getByLabel('Choose a CSV file'),input('processor_settlement.csv'));await tick(p.locator('dialog input[type=checkbox]'));await click(p.getByRole('button',{name:'Validate & add local evidence'}));await p.getByText('Supporting evidence added').waitFor();}
 return p;
}
{
 const ctx=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 await check('EXTRA-keyboard-complete-import',async()=>{const p=await importedPage(ctx,'qbo_general_ledger.csv','JE_TO_CLEARING',true);await p.screenshot({path:out('keyboard-complete-import.png')});return 'Tab/Shift-free sequential Tab, Enter, Space, arrow keys, typing; visible file picker activated with Enter; native chooser files selected; full import to Reconciliation complete. Native chooser path selection automated by FileChooser.setFiles.';});
 for(const qb of ['native-style.csv','supplemented.csv'])await check(`EXTRA-native-GL-${qb}`,async()=>{const p=await importedPage(ctx,qb);await p.screenshot({path:out(`${qb}-result.png`),fullPage:true});const d=await download(p,()=>click(p.getByRole('button',{name:'Save review project'})),`${qb}.review.json`);const w=JSON.parse(d.text).workspace;fs.writeFileSync(out(`${qb}-visible.txt`),await p.locator('main').innerText());return `${w.input.qb.length} parsed rows; saved project and screenshot for independent edge inspection`;});
 await check('EXTRA-UF-full-click-flow',async()=>{
  const p=await importedPage(ctx,'qbo_uf_ledger.csv','PAYMENT_TO_UF');await click(p.locator('.queue-list > *').first());
  const r=p.locator('section.case-review');await click(r.locator('details').first().locator('summary'));
  await click(p.getByText('UF candidate / reviewed deposit worksheet',{exact:true}));
  const cand=await download(p,()=>click(p.getByRole('button',{name:'Download UF review worksheet'})),'uf-candidate.json');
  await click(p.getByRole('button',{name:'Add actual QB Payment'}));await fill(p.getByLabel('QB Payment ID 1'),'SYN-QB-P900');await fill(p.getByLabel('Payment amount USD 1'),'10000.00');await fill(p.getByLabel('Payment status evidence 1'),'Synthetic reviewed UF payment source row 2');await tick(p.getByLabel('Reviewed: still in UF, not already deposited'));
  for(const [purpose,file] of [['COA','uf-coa.txt'],['SETTLEMENT','uf-settlement.txt'],['LEDGER','uf-ledger.txt']]){await select(r.getByLabel('Document purpose'),purpose);await upload(r.getByLabel('Attach a locally reviewed supporting document'),input(file));await r.getByText(new RegExp(`^${purpose}: `)).waitFor();}
  await fill(r.getByLabel('Existing bank account full name'),'Collections Checking');await fill(r.getByLabel('Existing fee expense account full name'),'Merchant Processing Fees');
  for(const [name,type]of [['Collections Checking','BANK'],['Merchant Processing Fees','EXPENSE']]){await select(r.getByLabel(`COA type ${name}`),type);const row=r.locator('div',{has:p.getByLabel(`COA type ${name}`)}).last();await tick(row.getByLabel('Exists in reviewed COA'));await select(r.getByLabel(`UF status ${name}`),'NOT_UF');}
  await fill(r.getByLabel(/Exact accounts covered by reviewed full GL/),'Undeposited Funds\nAccounts Receivable\nCollections Checking\nMerchant Processing Fees');
  await fill(r.getByLabel('Reviewed GL coverage starts'),'2026-09-01');await fill(r.getByLabel('Reviewed GL coverage ends'),'2026-09-30');await fill(r.getByLabel(/Documented net fee in USD/),'900.00');await select(r.getByLabel('Fee mode'),'NETTED');
  for(const label of [/I reviewed the actual COA/,/The supplied GL includes complete relevant/,/Source evidence identifies this entire amount/,/I checked all fee journals/])await tick(r.getByLabel(label));
  const reviewed=await download(p,()=>click(p.getByRole('button',{name:'Download UF review worksheet'})),'uf-reviewed.json');await p.screenshot({path:out('uf-full-click-reviewed.png'),fullPage:true});fs.writeFileSync(out('uf-visible-state.txt'),await r.innerText());
  assert(JSON.parse(cand.text).status==='CANDIDATE','candidate status');const result=JSON.parse(reviewed.text);assert(result.status==='REVIEWED_INSTRUCTIONS',JSON.stringify(result.missingEvidence));assert(result.importEligible===false,'UF import improperly allowed');return 'Complete UF import/evidence/review/payments flow: CANDIDATE → REVIEWED_INSTRUCTIONS worksheet; never accounting import and no QBO write.';
 });
 await ctx.close();
}
