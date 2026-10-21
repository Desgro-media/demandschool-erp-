// Isolated browser regression test; never uses the working project's .data or production service.
// PLAYWRIGHT_MODULE=/path/to/playwright-core/index.mjs node qa/qa-academic-planner.mjs
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import net from 'node:net';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = path.resolve(import.meta.dirname,'..');
const dir = await fs.mkdtemp(path.join(os.tmpdir(),'erp-academic-test-'));
for(const file of ['api','lib','public','dev-server.js','package.json','vercel.json']) await fs.cp(path.join(root,file),path.join(dir,file),{recursive:true});
await fs.symlink(path.join(root,'node_modules'),path.join(dir,'node_modules'),'dir');
// Clearing external database config ensures this test can only reach its disposable file store.
delete process.env.DATABASE_URL; delete process.env.VERCEL; process.env.NODE_ENV='test';
const { store } = await import(pathToFileURL(path.join(dir,'lib/store.js')));
const { hashPassword } = await import(pathToFileURL(path.join(dir,'lib/auth.js')));
const pw='QaAcademic123!';
const emps=[
  {id:'QA-COORD',name:'Test Coordinator',dept:'Academics',role:'ACADEMIC COORDINATOR',modules:['students'],email:'coordinator@example.test',joined:'2026-01-01',empType:'Permanent'},
  {id:'QA-FACULTY',name:'Test Faculty',dept:'Academics',role:'Faculty',modules:['students'],email:'faculty@example.test',joined:'2026-01-01',empType:'Permanent'},
  {id:'QA-SALES',name:'Test Sales',dept:'Sales',role:'Sales',email:'sales@example.test',joined:'2026-01-01'},
];
await store.setState('employees',emps,0,null);
await store.setState('COURSES',['Test course'],0,null);
await store.setState('courseSettings',{'Test course':{duration:'12 weeks',syllabus:[]}},0,null);
await store.setState('batches',[
  {id:'QA-B1',label:'Test batch',course:'Test course',startDate:'2026-08-10',schedule:{installments:[]},calendar:[]},
  {id:'QA-B2',label:'Legacy batch',course:'Test course',startDate:'2026-08-10',schedule:{installments:[]},calendar:[{id:'SESS-9',date:'2026-08-10',trainerName:'Former Trainer',trainerType:'staff',topic:'Legacy topic',syllabusRef:'legacy-ref'}]}
],0,null);
for(const e of emps) await store.createUser({email:e.email,password_hash:await hashPassword(pw),kind:'staff',ref_id:e.id});
await store.setState('students',[{id:'QA-STUDENT',name:'Test Student',email:'student@example.test',course:'Test course',batchId:'QA-B1',coursesEnrolled:['Test course']}],0,null);
await store.createUser({email:'student@example.test',password_hash:await hashPassword(pw),kind:'student',ref_id:'QA-STUDENT'});
const probe=net.createServer(); await new Promise(r=>probe.listen(0,'127.0.0.1',r)); const port=probe.address().port; await new Promise(r=>probe.close(r));
const server=spawn(process.execPath,['dev-server.js'],{cwd:dir,env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
let logs='';server.stderr.on('data',b=>logs+=b);
const base='http://127.0.0.1:'+port;
let browser;
try{
  for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break;}catch{} await new Promise(r=>setTimeout(r,100));}
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH || '/usr/bin/google-chrome',headless:true,args:['--no-sandbox']});
  const errors=[];
  async function login(email,kind='staff'){
    const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);
    if(kind==='student') await page.click('#login-tab-student');
    await page.fill(kind==='student'?'#login-email-student':'#login-email',email);
    await page.fill('#login-password',pw); await page.click('.login-submit');
    await page.waitForSelector(kind==='student'?'#student-shell:not([hidden])':'#app-shell:not([hidden])');
    return page;
  }
  const page=await login('coordinator@example.test');
  assert.deepEqual(await page.evaluate(()=>visibleModules().map(m=>m.id)),['workspace','students','placements']);
  await page.evaluate(()=>setSub('students','planner'));
  assert.equal(await page.getByText('No days planned yet.',{exact:false}).count(),1);
  assert.equal(await page.getByRole('button',{name:/template/i}).count(),0);
  await page.getByRole('button',{name:'Edit programme & policies'}).click();
  await page.fill('[name="planningEnd"]','2026-07-01'); await page.click('#f-academic [type="submit"]');
  assert.match(await page.locator('#academic-error').innerText(),/on or after/);
  await page.fill('[name="planningEnd"]','2026-11-10');
  await page.fill('[name="duration"]','6 Months'); await page.fill('[name="academicDuration"]','4 Months'); await page.fill('[name="internship"]','2 Months');
  for(const d of ['1','2','3','4','5']) await page.check(`[name="classDays"][value="${d}"]`);
  await page.fill('[name="classStart"]','14:30'); await page.fill('[name="classEnd"]','17:00');
  await page.fill('[name="minAttendance"]','85'); await page.fill('[name="assignmentPolicy"]','Mandatory');
  await page.click('#f-academic [type="submit"]');
  assert.match(await page.locator('body').innerText(),/93 calendar days · 67 scheduled weekdays · 26 weekly off days/);
  await page.getByRole('button',{name:'Add day',exact:true}).click();
  await page.fill('#f-add-cal-session [name="date"]',''); await page.fill('[name="topic"]','Research <img src=x onerror=alert(1)>');
  await page.selectOption('[name="staffTrainer"]','Test Coordinator');
  await page.fill('[name="module"]','Marketing'); await page.fill('[name="dayLabel"]','Day 1');
  await page.fill('[name="covered"]','Audience research'); await page.fill('[name="activity"]','Create a persona');
  await page.selectOption('#academic-status','Completed');
  await page.click('#f-add-cal-session [type="submit"]');
  assert.equal(await page.locator('.academic-planner-table img').count(),0);
  assert.match(await page.locator('.academic-planner-table').first().innerText(),/Audience research/);
  await page.selectOption('#academic-filter-status','Planned');
  assert.match(await page.locator('body').innerText(),/No sessions match these filters/);
  await page.selectOption('#academic-filter-status','');
  await page.getByRole('button',{name:'Add session',exact:true}).click();
  await page.fill('#f-academic [name="title"]','Career guidance'); await page.fill('[name="faculty"]','Guest Faculty');
  await page.fill('[name="plannedDate"]','2026-10-20'); await page.fill('[name="actualDate"]','2026-10-21');
  await page.selectOption('#academic-status','Completed'); await page.fill('[name="remarks"]','Rescheduled'); await page.click('#f-academic [type="submit"]');
  await page.getByRole('button',{name:'Add activity',exact:true}).click();
  await page.fill('[name="title"]','Group presentation'); await page.fill('[name="coordinator"]','Test Coordinator'); await page.click('#f-academic [type="submit"]');
  await page.evaluate(()=>saveNow()); await page.reload(); await page.waitForSelector('#app-shell:not([hidden])');
  await page.evaluate(()=>openAcademicPlanner('QA-B1'));
  assert.match(await page.locator('body').innerText(),/Career guidance/); assert.match(await page.locator('body').innerText(),/Group presentation/);
  let saved=await page.evaluate(async()=> (await api('state')).state.batches.value);
  assert.equal(saved[0].academicPlan.minAttendance,85); assert.equal(saved[0].calendar[0].date,''); assert.equal(saved[0].calendar[0].status,'Completed');
  assert.equal(saved[0].specialSessions[0].actualDate,'2026-10-21');
  // Exercise real PDF.js extraction using a browser-generated text PDF.
  const pdfPage=await browser.newPage();
  await pdfPage.setContent(`<style>body{font-family:Arial;font-size:10px}table{width:100%;border-collapse:collapse;table-layout:fixed;margin-bottom:24px}td,th{border:1px solid #888;padding:7px;text-align:left;vertical-align:top}h2{font-size:14px}</style>
    <h2>Programme Information</h2><table><tr><td>Course Duration</td><td>8 Months</td></tr><tr><td>Minimum Attendance</td><td>90%</td></tr></table>
    <h2>Day-wise Academic Planner</h2><h2>A. Marketing</h2><table><thead><tr><th>Day</th><th>Date</th><th>Module</th><th>Planned Topic</th><th>Faculty</th><th>Topic Covered</th><th>Assignment / Activity</th><th>Status</th></tr></thead><tbody>
    <tr><td>Day 20</td><td>Oct 22</td><td>Research</td><td>PDF imported topic</td><td>Test Coordinator</td><td>Multiple lines of covered content for testing wrapping</td><td>Persona exercise</td><td>Done</td></tr>
    <tr><td>Day 21</td><td></td><td>Research</td><td>Undated lesson</td><td></td><td></td><td></td><td>Pending</td></tr></tbody></table>
    <h2>Special Sessions Tracker</h2><table><tr><th>No.</th><th>Session</th><th>Faculty</th><th>Planned Day</th><th>Actual Day</th><th>Status</th><th>Remarks</th></tr><tr><td>1.</td><td>PDF workshop</td><td>Guest Faculty</td><td>Oct 23</td><td></td><td>Planned</td><td>Bring laptop</td></tr></table>
    <h2>Student Engagement Activities</h2><table><tr><th>Activity</th><th>Planned Day</th><th>Conducted On</th><th>Coordinator</th><th>Remarks</th></tr><tr><td>Engagement Activity 1</td><td>Oct 24</td><td></td><td>Test Coordinator</td><td>Teamwork</td></tr><tr><td>Engagement Activity 2</td><td></td><td></td><td></td><td></td></tr></table>`);
  const pdfBuffer=await pdfPage.pdf({format:'A4',landscape:true,margin:{top:'20px',bottom:'20px',left:'20px',right:'20px'}});await pdfPage.close();
  async function uploadPdf(){
    await page.getByRole('button',{name:'Upload calendar PDF'}).click();
    await page.locator('#academic-pdf-file').setInputFiles({name:'calendar.pdf',mimeType:'application/pdf',buffer:pdfBuffer});
    await page.waitForFunction(()=>!document.getElementById('academic-pdf-file').disabled);
    assert.equal(await page.locator('#academic-pdf-apply').isEnabled(),true,await page.locator('#academic-pdf-status').innerText());
  }
  await uploadPdf();
  assert.equal(await page.locator('[data-pdf-key="calendar"]').count(),2,await page.locator('#academic-pdf-preview').innerText());
  assert.equal(await page.locator('[data-pdf-key="specialSessions"]').count(),1);
  assert.equal(await page.locator('[data-pdf-key="engagementActivities"]').count(),2);
  assert.equal(await page.evaluate(()=>batchById('QA-B1').calendar.length),1,'preview must not mutate saved calendar');
  await page.click('#academic-pdf-apply');await page.evaluate(()=>saveNow());
  saved=await page.evaluate(async()=> (await api('state')).state.batches.value);
  assert.equal(saved[0].calendar.length,3);assert.equal(saved[0].academicPlan.duration,'8 Months');
  const imported=saved[0].calendar.find(s=>s.dayLabel==='Day 20');
  assert.equal(imported.date,'2026-10-22');assert.equal(imported.status,'Completed');assert.match(imported.covered,/testing wrapping/);
  await uploadPdf();
  assert.notEqual(await page.locator('[data-pdf-key="calendar"] [data-pdf-action]').first().inputValue(),'new');
  await page.click('#academic-pdf-apply');await page.evaluate(()=>saveNow());
  assert.equal(await page.evaluate(()=>batchById('QA-B1').calendar.length),3,'repeat upload must update matched rows');
  // Invalid PDF leaves the current batch untouched and keeps manual entry available.
  await page.getByRole('button',{name:'Upload calendar PDF'}).click();
  await page.locator('#academic-pdf-file').setInputFiles({name:'broken.pdf',mimeType:'application/pdf',buffer:Buffer.from('invalid pdf')});
  await page.waitForFunction(()=>!document.getElementById('academic-pdf-file').disabled);
  assert.equal(await page.locator('#academic-pdf-apply').isDisabled(),true);
  await page.getByRole('button',{name:'Cancel',exact:true}).click();
  await page.screenshot({path:'/tmp/erp-academic-planner-desktop.png',fullPage:true});
  await page.selectOption('#academic-batch','QA-B2');
  await page.locator('.academic-planner-table').first().getByRole('button',{name:'Edit',exact:true}).click();
  assert.equal(await page.locator('[name="staffTrainer"]').inputValue(),'Former Trainer');
  await page.fill('[name="covered"]','Legacy progress'); await page.click('#f-edit-cal-session [type="submit"]');
  await page.evaluate(()=>saveNow());
  saved=await page.evaluate(async()=> (await api('state')).state.batches.value);
  assert.equal(saved[1].calendar[0].trainerName,'Former Trainer'); assert.equal(saved[1].calendar[0].id,'SESS-9'); assert.equal(saved[1].calendar[0].syllabusRef,'legacy-ref');
  // Remove an auxiliary entry and confirm it persists.
  await page.selectOption('#academic-batch','QA-B1');
  page.once('dialog',d=>d.accept());
  await page.locator('.panel').filter({has:page.getByRole('heading',{name:'Student engagement activities'})}).getByRole('row').filter({hasText:'Group presentation'}).getByRole('button',{name:'Remove'}).click();
  await page.evaluate(()=>saveNow());
  assert.equal(await page.evaluate(async()=> (await api('state')).state.batches.value[0].engagementActivities.length),2);
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:'/tmp/erp-academic-planner-mobile.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'planner must not overflow viewport');
  const sales=await login('sales@example.test'); await sales.evaluate(()=>setSub('students','planner'));
  assert.equal(await sales.getByRole('button',{name:'Add day',exact:true}).count(),0);
  const denied=await sales.evaluate(async()=>{try{await api('state',{method:'PUT',body:{changes:{batches:{base:1,value:[]}}}});return 200;}catch(e){return e.status;}});
  assert.equal(denied,403);
  const student=await login('student@example.test','student');
  assert.equal(await student.evaluate(()=>canManageAcademicPlanner()),false);
  assert.equal(await student.evaluate(async()=>{try{await api('state',{method:'PUT',body:{changes:{batches:{base:1,value:[]}}}});return 200;}catch(e){return e.status;}}),403);
  // Faculty completion must reflect on an already-open coordinator planner.
  await page.setViewportSize({width:1440,height:1000});
  await page.evaluate(()=>openAcademicPlanner('QA-B1'));
  await page.getByRole('button',{name:'Add day',exact:true}).click();
  await page.fill('[name="topic"]','Faculty sync planned topic');
  await page.selectOption('[name="staffTrainer"]','Test Faculty');
  await page.click('#f-add-cal-session [type="submit"]');await page.evaluate(()=>saveNow());
  const faculty=await login('faculty@example.test');await faculty.evaluate(()=>setSub('workspace','sessions'));
  await faculty.getByRole('row').filter({hasText:'Faculty sync planned topic'}).getByRole('button',{name:'Log now'}).click();
  await faculty.fill('#f-log-session [name="topic"]','Actual faculty coverage');await faculty.fill('#f-log-session [name="hours"]','2');
  await faculty.fill('#f-log-session [name="notes"]','Practical activity finished');
  await faculty.click('#f-log-session [type="submit"]');await faculty.evaluate(()=>saveNow());
  await page.waitForFunction(()=>document.querySelector('.academic-planner-page')?.textContent.includes('Actual faculty coverage'),null,{timeout:15000});
  const synced=page.getByRole('row').filter({hasText:'Faculty sync planned topic'});
  assert.match(await synced.innerText(),/Completed/);assert.match(await synced.innerText(),/2 hrs/);assert.match(await synced.innerText(),/Practical activity finished/);
  await page.reload();await page.waitForSelector('#app-shell:not([hidden])');await page.evaluate(()=>openAcademicPlanner('QA-B1'));
  assert.match(await page.getByRole('row').filter({hasText:'Faculty sync planned topic'}).innerText(),/Actual faculty coverage/);
  // Coordinator can review, but cannot alter another employee's submitted log.
  const log=await page.evaluate(async()=> (await api('state')).state.sessionLogs.value.find(l=>l.empId==='QA-FACULTY'));
  assert.ok(log);
  await page.evaluate(async log=>{const state=(await api('state')).state;await api('state',{method:'PUT',body:{changes:{sessionLogs:{base:state.sessionLogs.version,value:[{...log,topic:'Forbidden overwrite'}]}}}});},log);
  assert.equal(await faculty.evaluate(async()=> (await api('state')).state.sessionLogs.value.find(l=>l.id===sessionLogs[0].id).topic),'Actual faculty coverage');
  assert.deepEqual(errors,[]);
  console.log('PASS: empty tracker, coordinator permissions, date validation/counts, faculty progress, filters, XSS escaping, special sessions, engagement CRUD, reload persistence, legacy calendar, mobile layout, sales/student write denial, real PDF upload/preview, repeat import, invalid PDF recovery, faculty-to-coordinator live progress and scoped log protection.');
  console.log('Screenshots: /tmp/erp-academic-planner-desktop.png, /tmp/erp-academic-planner-mobile.png');
} finally {
  await browser?.close(); server.kill();
  if(logs) console.error(logs);
  await fs.rm(dir,{recursive:true,force:true});
}
