import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('../public/academic-pdf.js',import.meta.url),'utf8'),ctx);
const item=(text,x,y,width=text.length*4)=>({str:text,transform:[1,0,0,1,x,y],width});
const header=y=>[['Day',35],['Date',85],['Module',130],['Planned Topic',200],['Faculty',285],['Topic Covered',350],['Assignment / Activity',430],['Status',540]].map(([t,x])=>item(t,x,y));
test('dates validate calendar days and use the selected reference year',()=>{
 assert.equal(ctx.academicPdfDate('4th Sep',2026),'2026-09-04');
 assert.equal(ctx.academicPdfDate('10/08/2027',2026),'2027-08-10');
 assert.equal(ctx.academicPdfDate('Feb 29',2026),'');
 assert.equal(ctx.academicPdfDate('Feb 29',2028),'2028-02-29');
 assert.equal(ctx.academicPdfDate('2026-13-01',2026),'');
});
test('class days and times handle ranges and noon/midnight',()=>{
 assert.deepEqual(Array.from(ctx.academicPdfWeekdays('Monday - Friday')),[1,2,3,4,5]);
 assert.deepEqual(Array.from(ctx.academicPdfWeekdays('Saturday to Monday')),[6,0,1]);
 assert.deepEqual(Array.from(ctx.academicPdfTimes('12:00 PM - 5:00 PM')),['12:00','17:00']);
 assert.equal(ctx.academicPdfTimes('17:00 - 14:00'),null);
});
test('rows continue across page headers without duplicating sessions',()=>{
 const r=ctx.parseAcademicPdfPages([
  [...header(700),item('Day 1',35,670),item('Oct 22',85,670),item('Research',200,670),item('First line',350,670)],
  [...header(700),item('Continued coverage',350,670),item('Day 2',35,640),item('Next topic',200,640)]
 ],2026);
 assert.equal(r.calendar.length,2);assert.equal(r.calendar[0].date,'2026-10-22');
 assert.equal(r.calendar[0].covered,'First line Continued coverage');assert.equal(r.calendar[1].topic,'Next topic');
});
test('unread dates and custom statuses remain visible in notes',()=>{
 const r=ctx.parseAcademicPdfPages([[...header(700),item('Day 1',35,670),item('TBD',85,670),item('Research',200,670),item('Done4',540,670)]],2026);
 assert.equal(r.calendar[0].date,'');assert.match(r.calendar[0].progressNotes,/TBD/);assert.match(r.calendar[0].progressNotes,/Done4/);assert.equal(r.calendar[0].status,'');
});
test('ambiguous matches require review; unique section/day matches allow topic changes',()=>{
 const b={calendar:[{id:'a',dayLabel:'Day 1',sourceSection:'Marketing',topic:'Old topic'},{id:'b',dayLabel:'Day 1',sourceSection:'Design',topic:'Other'}]};
 assert.equal(ctx.academicPdfMatch(b,'calendar',{dayLabel:'Day 1',sourceSection:'Marketing',topic:'New topic'}),'a');
 b.calendar.push({...b.calendar[0],id:'c'});
 assert.equal(ctx.academicPdfMatch(b,'calendar',{dayLabel:'Day 1',sourceSection:'Marketing',topic:'New topic'}),'new');
});
test('blank or scanned pages produce a review warning',()=>{
 const r=ctx.parseAcademicPdfPages([[]],2026);assert.equal(r.calendar.length,0);assert.match(r.warnings.join(' '),/no readable text/);
});
