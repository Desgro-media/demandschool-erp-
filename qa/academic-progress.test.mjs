import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {resolveAccess,readView,applyWrite,writeMode} from '../lib/policy.js';
const log={id:'LOG1',batchId:'B1',calSessionId:'C1',empId:'F1',trainerName:'Faculty',status:'Logged',topic:'Actually covered',hours:2};
const who=(extra={})=>resolveAccess({kind:'staff',ref_id:'COORD'},[{id:'COORD',name:'Coordinator',dept:'Academics',role:'ACADEMIC COORDINATOR',modules:['students'],...extra}]);
test('coordinator reads other faculty logs but cannot overwrite them',()=>{
 const c=who();assert.deepEqual(readView(c,'sessionLogs',[log]),[log]);assert.equal(writeMode(c,'sessionLogs'),'scoped');
 assert.deepEqual(applyWrite(c,'sessionLogs',[{...log,topic:'Forged'}],[log]).value,[log]);
 assert.equal(readView(who({role:'Faculty'}),'sessionLogs',[log]).length,0);
 assert.equal(readView(who({modules:[]}),'sessionLogs',[log]).length,0);
});
test('planner derives completion and coverage without mutating stored calendar',()=>{
 const ctx={sessionLogs:[log],calendarOf:b=>b.calendar,setInterval:()=>{}};vm.createContext(ctx);
 vm.runInContext(fs.readFileSync(new URL('../public/academic-planner.js',import.meta.url),'utf8'),ctx);
 const b={id:'B1',calendar:[{id:'C1',topic:'Planned topic',status:'Planned',covered:''}]};
 let r=ctx.academicCalendarProgress(b)[0];assert.equal(r.status,'Completed');assert.equal(r.covered,'Actually covered');assert.equal(b.calendar[0].status,'Planned');
 ctx.sessionLogs=[{...log,status:'Pending'}];assert.equal(ctx.academicCalendarProgress(b)[0].status,'In progress');
 ctx.sessionLogs=[{...log,status:'Approved'}];assert.equal(ctx.academicCalendarProgress(b)[0].status,'Completed');
 ctx.sessionLogs=[{...log,status:'Rejected'}];assert.equal(ctx.academicCalendarProgress(b)[0].status,'Planned');
 ctx.sessionLogs=[{...log,batchId:'other'}];assert.equal(ctx.academicCalendarProgress(b)[0].status,'Planned');
});
