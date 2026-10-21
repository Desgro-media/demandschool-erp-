// Isolated browser regression test for the Placements module and its public review links; never uses the
// working project's .data or production service.
// PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs CHROME_PATH=/path/to/chrome node qa/qa-placements.mjs
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import net from 'node:net';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = path.resolve(import.meta.dirname,'..');
const dir = await fs.mkdtemp(path.join(os.tmpdir(),'erp-placements-test-'));
for(const file of ['api','lib','public','dev-server.js','package.json','vercel.json']) await fs.cp(path.join(root,file),path.join(dir,file),{recursive:true});
await fs.symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.NODE_ENV='test';
const { store } = await import(pathToFileURL(path.join(dir,'lib/store.js')));
const { hashPassword } = await import(pathToFileURL(path.join(dir,'lib/auth.js')));
const pw='QaPlacement123!';
const emps=[
  {id:'QA-ANU',name:'Test Placement Lead',dept:'Academics',role:'Lead Trainer — Placements',modules:['students'],email:'anu@example.test',joined:'2026-01-01',empType:'Permanent'},
  {id:'QA-SALES',name:'Test Sales',dept:'Sales',role:'Sales',email:'sales@example.test',joined:'2026-01-01'},
];
await store.setState('employees',emps,0,null);
await store.setState('COURSES',['Test course','Other course'],0,null);
await store.setState('courseSettings',{'Test course':{duration:'12 weeks',internship:true,syllabus:[]},'Other course':{duration:'4 weeks',syllabus:[]}},0,null);
await store.setState('batches',[{id:'QA-B1',label:'Test batch',course:'Test course',startDate:'2026-08-10',schedule:{installments:[]},calendar:[]}],0,null);
await store.setState('students',[{id:'QA-S1',name:'Test Student',email:'student@example.test',course:'Test course',batchId:'QA-B1',coursesEnrolled:['Test course'],phone:'9847000000'}],0,null);
for(const e of emps) await store.createUser({email:e.email,password_hash:await hashPassword(pw),kind:'staff',ref_id:e.id});
const probe=net.createServer(); await new Promise(r=>probe.listen(0,'127.0.0.1',r)); const port=probe.address().port; await new Promise(r=>probe.close(r));
const server=spawn(process.execPath,['dev-server.js'],{cwd:dir,env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
let logs='';server.stderr.on('data',b=>logs+=b);
const base='http://127.0.0.1:'+port;
let browser;
try{
  for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break;}catch{} await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
  const errors=[];
  async function login(email){
    const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);
    await page.fill('#login-email',email); await page.fill('#login-password',pw); await page.click('.login-submit');
    await page.waitForSelector('#app-shell:not([hidden])');
    return page;
  }

  // Academics / placements staff get the module; other staff do not, and the server enforces it too.
  const sales=await login('sales@example.test');
  assert.equal(await sales.evaluate(()=>visibleModules().some(m=>m.id==='placements')),false);
  const denied=await sales.evaluate(async()=>{ try{ await api('state'); const r=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json','X-Requested-With':'demand-erp'},body:JSON.stringify({changes:{placements:{base:0,value:[]}}})}); return r.status; }catch(e){ return -1; } });
  assert.equal(denied,403);
  const keys=await sales.evaluate(async()=>Object.keys((await api('state')).state));
  assert.equal(keys.includes('placements'),false);
  await sales.context().close();

  const page=await login('anu@example.test');
  assert.equal(await page.evaluate(()=>visibleModules().some(m=>m.id==='placements')),true);
  assert.equal(await page.evaluate(()=>nav.module),'placements');
  assert.match(await page.locator('body').innerText(),/Placements Overview/);

  // Partner → position → register → place → complete
  await page.evaluate(()=>setSub('placements','partners'));
  await page.getByRole('button',{name:'Add partner',exact:true}).first().click();
  await page.fill('#f-partner [name="name"]','QA <b>Agency</b>'); await page.fill('#f-partner [name="contactName"]','Pat Partner');
  await page.click('#f-partner [type="submit"]');
  assert.equal(await page.locator('b',{hasText:'Agency'}).count(),0,'partner name must be escaped');
  const pid=await page.evaluate(()=>placementPartners[0].id);
  assert.equal(pid,'PTN-01');
  await page.evaluate(id=>openPositionModal(id),pid);
  await page.fill('#f-position [name="title"]','Content Intern'); await page.selectOption('#f-position [name="course"]','Test course');
  await page.fill('#f-position [name="openings"]','1');
  await page.click('#f-position [type="submit"]');
  assert.equal(await page.evaluate(()=>placementPartners[0].positions.length),1);
  await page.evaluate(()=>openRegisterPlacement('QA-S1'));
  await page.click('#f-register-placement [type="submit"]');
  assert.equal(await page.evaluate(()=>placements[0].status),'Registered');
  await page.evaluate(()=>openPlacementModal(placements[0].id));
  await page.selectOption('#plc-partner',pid);
  await page.selectOption('#plc-position',{index:1});
  await page.click('#f-placement [type="submit"]');
  assert.equal(await page.evaluate(()=>placements[0].status),'Placed');
  await page.evaluate(()=>completePlacement(placements[0].id));

  // The review links are created, saved to the server and usable with no login.
  await page.evaluate(()=>openReviewLinks(placements[0].id));
  const studentLink=await page.locator('#rl-partner').inputValue();
  const partnerLink=await page.locator('#rl-student').inputValue();
  assert.match(studentLink,/#review=[A-Za-z0-9]{24}$/);
  await page.evaluate(()=>saveNow());
  const anon=await browser.newContext({viewport:{width:420,height:900}}),pub=await anon.newPage();
  pub.on('pageerror',e=>errors.push(e.message));
  await pub.goto(studentLink.replace(/^https?:\/\/[^/]+/,base));
  await pub.waitForSelector('#f-review-public');
  const text=await pub.locator('#review-shell').innerText();
  assert.match(text,/How was your internship at QA/); assert.doesNotMatch(text,/Test course|Sales/);
  await pub.click('#f-review-public button[type=submit]');
  assert.match(await pub.locator('#review-error').innerText(),/star rating/);
  await pub.click('.review-star[data-n="4"]');
  await pub.fill('[name="text"]','Great mentoring <script>1</script>');
  await pub.click('#f-review-public button[type=submit]');
  await pub.waitForFunction(()=>/Thank you/.test(document.getElementById('review-shell').innerText));
  // one review per link
  await pub.reload(); await pub.waitForFunction(()=>/already received/.test(document.getElementById('review-shell').innerText));
  const again=await pub.evaluate(async t=>{ const r=await fetch('/api/review',{method:'POST',headers:{'Content-Type':'application/json','X-Requested-With':'demand-erp'},body:JSON.stringify({token:t,rating:1,text:'overwrite'})}); return (await r.json()).done; },studentLink.split('#review=')[1]);
  assert.equal(again,true);
  const stored=await page.evaluate(async()=> (await api('state')).state.placements.value[0].partnerReview);
  assert.equal(stored.rating,4); assert.match(stored.text,/Great mentoring/); assert.equal(stored.by,'Test Student');
  // a made-up token reveals nothing
  const bad=await pub.evaluate(async()=>{ const r=await fetch('/api/review?token=abcdefghijklmnopqrstuvwx'); return r.status; });
  assert.equal(bad,404);
  // the partner link works too, then staff see both after the next sync
  const pub2=await anon.newPage(); await pub2.goto(partnerLink.replace(/^https?:\/\/[^/]+/,base));
  await pub2.waitForSelector('#f-review-public'); await pub2.click('.review-star[data-n="5"]'); await pub2.click('#f-review-public button[type=submit]');
  await pub2.waitForFunction(()=>/Thank you/.test(document.getElementById('review-shell').innerText));
  await page.evaluate(()=>closeModal());
  await page.evaluate(()=>saveNow());
  await page.evaluate(()=>pullUpdates());
  await page.waitForFunction(()=>placements[0].partnerReview && placements[0].studentReview);
  await page.evaluate(()=>setSub('placements','reviews'));
  assert.match(await page.locator('body').innerText(),/Great mentoring/);
  assert.deepEqual(errors,[]);
  console.log('placements QA passed');
}finally{
  await browser?.close(); server.kill();
  if(logs.trim()) console.error(logs);
  await fs.rm(dir,{recursive:true,force:true});
}
