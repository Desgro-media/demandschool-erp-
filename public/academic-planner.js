/* Batch academic planning. Calendar entries remain shared with the student portal and trainer logs.
   Programme settings and the two auxiliary trackers live on the same versioned batch record. */
let academicBatchId = '', academicFaculty = '', academicStatus = '';
const ACADEMIC_STATUSES = ['Planned', 'In progress', 'Completed', 'Postponed', 'Cancelled'];
const ACADEMIC_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function canManageAcademicPlanner(){ return !!currentUser && syncWritable.includes('batches'); }
function academicPlanOf(b){
  return {programme:b.course, commencement:b.startDate || '', planningEnd:b.endDate || '', duration:'', academicDuration:'', internship:'', classStart:'', classEnd:'', classDays:[], minAttendance:'', assignmentPolicy:'', capstonePolicy:'', assessmentPolicy:'', examPolicy:'', notes:'', ...(b.academicPlan || {})};
}
function academicDaySummary(p){
  if(!p.commencement || !p.planningEnd || !p.classDays.length) return null;
  const start = Date.parse(p.commencement+'T00:00:00Z'), end = Date.parse(p.planningEnd+'T00:00:00Z');
  if(!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const total = Math.floor((end-start)/86400000)+1;
  const weeks = Math.floor(total/7), remainder = total%7, weekdays = new Set(p.classDays.map(Number));
  let working = weeks*weekdays.size;
  for(let i=0; i<remainder; i++) if(weekdays.has(new Date(start+i*86400000).getUTCDay())) working++;
  return {total, working, off:total-working};
}
// Day-wise planner built from the programme settings: one calendar day for every class day (the
// ticked weekdays; everything else is a weekly holiday) between commencement and planning end, stamped
// with the class timings. Generated days are flagged `auto` so a later change to the schedule can move
// or drop the ones nobody has touched, while any day with a trainer/topic/notes (or one added by hand
// or imported from a PDF) is never removed, and a date that already has a day is never doubled up.
// Runs whenever the programme settings are saved, and from the "Generate from schedule" button.
function academicScheduleDates(p){
  if(!p.commencement || !p.planningEnd || !p.classDays.length || p.planningEnd<p.commencement) return [];
  const days=new Set(p.classDays.map(Number)), out=[];
  for(let t=Date.parse(p.commencement+'T00:00:00Z'), end=Date.parse(p.planningEnd+'T00:00:00Z'); t<=end; t+=86400000){
    if(days.has(new Date(t).getUTCDay())) out.push(new Date(t).toISOString().slice(0,10));
  }
  return out;
}
function academicSessionTouched(s){
  return !s.auto || !!(s.trainerName || s.topic || s.covered || s.activity || s.progressNotes || s.module || s.dayLabel) || (s.status && s.status!=='Planned');
}
function syncAcademicCalendar(b){
  const p=academicPlanOf(b), dates=academicScheduleDates(p);
  if(!dates.length) return 0;
  const cal=ensureBatchCalendar(b);
  const want=new Set(dates);
  let kept=cal.filter(s=>academicSessionTouched(s) || want.has(s.date));
  const have=new Set(kept.map(s=>s.date));
  let added=0;
  for(const date of dates){
    if(have.has(date)) continue;
    kept.push({id:nextCalSessionId(), date, trainerType:'staff', trainerName:'', topic:'', syllabusRef:'', status:'Planned', auto:true});
    added++;
  }
  kept.forEach(s=>{ if(s.auto){ s.classStart=p.classStart||''; s.classEnd=p.classEnd||''; } });
  kept.sort((x,y)=>(x.date||'9999').localeCompare(y.date||'9999'));
  b.calendar=kept;
  return added;
}
function generateAcademicCalendar(batchId){
  const b=batchById(batchId); if(!b || !canManageAcademicPlanner()) return;
  if(!academicScheduleDates(academicPlanOf(b)).length){ toast('Set commencement, planning end and class days in Programme & policies first'); return; }
  const n=syncAcademicCalendar(b);
  render(); toast(n?`${n} class day${n===1?'':'s'} added from the schedule`:'Planner already matches the schedule');
}
// Display faculty evidence directly from saved logs: no duplicate batch write or manual sync.
function academicCalendarProgress(b){
  const latest=new Map();
  for(const log of sessionLogs){
    if(log.batchId!==b.id)continue;
    const previous=latest.get(log.calSessionId);
    if(!previous || (log.submittedDate || '')>=(previous.submittedDate || ''))latest.set(log.calSessionId,log);
  }
  return calendarOf(b).map(s=>{
    const log=latest.get(s.id);
    if(!log)return {...s};
    const accepted=log.status==='Logged'||log.status==='Approved',pending=log.status==='Pending';
    return {...s, status:accepted?'Completed':pending?'In progress':s.status,
      covered:accepted||pending?(log.topic || s.covered || ''):s.covered, facultyLog:log};
  });
}
function academicFacultyLogHTML(log){
  if(!log)return '';
  const status=log.status==='Pending'?'Awaiting HR approval':log.status==='Rejected'?'Rejected by HR':log.status;
  return `<div class="subtext">Faculty log · ${esc(log.trainerName || '')} · ${esc(String(log.hours ?? '—'))} hrs · ${esc(status)}</div>${log.notes?`<div class="subtext">${esc(log.notes)}</div>`:''}`;
}
// The normal state poll remains active elsewhere. Refresh an open coordinator planner promptly,
// using the existing guard against replacing unsaved work or an open editing dialog.
setInterval(()=>{
  if(typeof nav!=='undefined' && nav.module==='students' && nav.sub.students==='planner')pullUpdates();
},5000);
function academicStatusOf(s){ return ACADEMIC_STATUSES.includes(s.status) ? s.status : 'Planned'; }
function academicStatusPill(s){ const value=academicStatusOf(s); return pill(value, {Completed:'pos', 'In progress':'blue', Postponed:'warn', Cancelled:'neg'}[value] || 'neutral'); }
function academicField(label, value){ return `<div><label class="field-label">${esc(label)}</label><div style="white-space:pre-wrap;overflow-wrap:anywhere;">${esc(String(value == null || value === '' ? 'Not set' : value))}</div></div>`; }
function academicInput(label, name, value='', type='text', attrs=''){
  return `<div><label class="field-label" for="academic-${name}">${esc(label)}</label><input class="field-input" id="academic-${name}" name="${name}" type="${type}" value="${esc(String(value ?? ''))}" ${attrs}></div>`;
}
function academicTextarea(label,name,value=''){
  return `<div><label class="field-label" for="academic-${name}">${esc(label)}</label><textarea class="field-input" id="academic-${name}" name="${name}" rows="3">${esc(value || '')}</textarea></div>`;
}
function academicStatusSelect(value){ return `<div><label class="field-label" for="academic-status">Status</label><select class="field-input" id="academic-status" name="status">${ACADEMIC_STATUSES.map(s=>`<option ${s===value?'selected':''}>${esc(s)}</option>`).join('')}</select></div>`; }
function openAcademicPlanner(id){
  if(!visibleModules().some(m=>m.id==='students')) return;
  academicBatchId=id; academicFaculty=''; academicStatus=''; closeModal(); setSub('students','planner');
}
function changeAcademicBatch(id){ academicBatchId=id; academicFaculty=''; academicStatus=''; render(); }
function refreshAcademicCalendar(batchId){
  queueSave();
  if(nav.module==='students' && nav.sub.students==='planner'){ closeModal(); render(); }
  else openBatchDetail(batchId);
}
function academicPlanner(){
  if(!batches.some(b=>b.id===academicBatchId)) academicBatchId=batches[0]?.id || '';
  const b=batchById(academicBatchId);
  const selector=`<div class="toolbar"><div class="filter-group"><label class="filter-label" for="academic-batch">Batch</label><select id="academic-batch" class="select-sm" onchange="changeAcademicBatch(this.value)">${batches.map(b=>`<option value="${esc(b.id)}" ${b.id===academicBatchId?'selected':''}>${esc(b.label)} · ${esc(b.course)}</option>`).join('')}</select></div>${canManageAcademicPlanner() && b?`<button class="btn primary" onclick="openAcademicPdfImport(${jsq(b.id)})">Upload calendar PDF</button>`:''}</div>`;
  if(!b) return `<div class="panel"><div class="empty">Create a batch in Academics → Batches to start its academic planner.</div></div>`;
  const p=academicPlanOf(b), cal=academicCalendarProgress(b), editable=canManageAcademicPlanner(), summary=academicDaySummary(p);
  const done=cal.filter(s=>academicStatusOf(s)==='Completed').length;
  const overdue=cal.filter(s=>s.date && s.date<TODAY && !['Completed','Cancelled'].includes(academicStatusOf(s))).length;
  const faculty=[...new Set(cal.map(s=>s.trainerName).filter(Boolean))].sort();
  const rows=cal.map((s,i)=>({s,i})).filter(({s})=>(!academicFaculty||s.trainerName===academicFaculty)&&(!academicStatus||academicStatusOf(s)===academicStatus));
  const bid=jsq(b.id);
  return '<div class="academic-planner-page">'+selector+`
    <div class="kpi-grid">
      <div class="kpi-card"><div class="kpi-label">Planned sessions</div><div class="kpi-value">${cal.length}</div></div>
      <div class="kpi-card"><div class="kpi-label">Completed</div><div class="kpi-value">${done}</div><div class="kpi-sub">${cal.length?Math.round(done/cal.length*100):0}% of all sessions</div></div>
      <div class="kpi-card"><div class="kpi-label">Overdue</div><div class="kpi-value">${overdue}</div><div class="kpi-sub">Past date and not completed or cancelled</div></div>
      <div class="kpi-card"><div class="kpi-label">Unscheduled</div><div class="kpi-value">${cal.filter(s=>!s.date).length}</div></div>
    </div>
    <div class="panel"><div class="panel-head"><h3>Programme information & academic policies</h3>${editable?`<button class="btn btn-sm ghost" onclick="openAcademicSettings(${bid})">Edit programme & policies</button>`:''}</div>
      <div class="modal-body">
        <div class="field-row cols-3">${academicField('Programme',p.programme)}${academicField('Batch',b.label)}${academicField('Commencement',p.commencement?fmtDate(p.commencement):'')}</div>
        <div class="field-row cols-3">${academicField('Course duration',p.duration)}${academicField('Academic sessions',p.academicDuration)}${academicField('Internship',p.internship)}</div>
        <div class="field-row cols-3">${academicField('Planning end',p.planningEnd?fmtDate(p.planningEnd):'')}${academicField('Class days',p.classDays.map(d=>ACADEMIC_DAYS[d]).join(', '))}${academicField('Class timings',p.classStart&&p.classEnd?p.classStart+' – '+p.classEnd:'')}</div>
        ${academicField('Weekly holidays',p.classDays.length?ACADEMIC_DAYS.filter((_,i)=>!p.classDays.includes(i)).join(', ') || 'None':'')}
        ${summary?`<div class="subtext">${summary.total} calendar days · ${summary.working} scheduled weekdays · ${summary.off} weekly off days (inclusive; public holidays not deducted)</div>`:''}
        <div class="field-row cols-3">${academicField('Minimum attendance',p.minAttendance!==''?p.minAttendance+'%':'')}${academicField('Assignment submission',p.assignmentPolicy)}${academicField('Capstone project',p.capstonePolicy)}</div>
        <div class="field-row">${academicField('Internal assessment',p.assessmentPolicy)}${academicField('Final examination',p.examPolicy)}</div>
        ${p.notes?academicField('Notes',p.notes):''}
      </div>
    </div>
    <div class="panel"><div class="panel-head"><div><h3>Day-wise academic planner</h3><div class="sub">Planned topics, faculty delivery and assignment progress</div></div>${editable?`<div style="display:flex;gap:6px;"><button class="btn btn-sm ghost" title="Fill in any class days missing from the planner, using the dates, class days and timings above" onclick="generateAcademicCalendar(${bid})">Generate from schedule</button><button class="btn btn-sm primary" onclick="openAddCalendarSession(${bid})">Add day</button></div>`:''}</div>
      <div class="toolbar" style="padding:12px 16px;"><div class="filter-group"><label class="filter-label" for="academic-faculty">Faculty</label><select class="select-sm" id="academic-faculty" onchange="academicFaculty=this.value;render()"><option value="">All faculty</option>${faculty.map(f=>`<option value="${esc(f)}" ${f===academicFaculty?'selected':''}>${esc(f)}</option>`).join('')}</select><label class="filter-label" for="academic-filter-status">Status</label><select class="select-sm" id="academic-filter-status" onchange="academicStatus=this.value;render()"><option value="">All statuses</option>${ACADEMIC_STATUSES.map(s=>`<option ${s===academicStatus?'selected':''}>${s}</option>`).join('')}</select></div><span class="subtext">${rows.length} of ${cal.length} sessions</span></div>
      <div class="table-wrap"><table class="data academic-planner-table"><thead><tr><th>Day / Date</th><th>Module</th><th>Planned topic</th><th>Faculty</th><th>Topic covered</th><th>Assignment / Activity</th><th>Status / Notes</th>${editable?'<th>Actions</th>':''}</tr></thead><tbody>
        ${rows.map(({s,i})=>`<tr><td>${esc(s.dayLabel || 'Day '+(i+1))}<div class="subtext">${s.date?fmtDateShort(s.date)+(s.date?' · '+ACADEMIC_DAYS[new Date(s.date+'T00:00:00Z').getUTCDay()].slice(0,3):''):'Unscheduled'}${s.classStart&&s.classEnd?' · '+esc(s.classStart)+'–'+esc(s.classEnd):''}</div></td><td>${esc(s.module || '—')}</td><td>${esc(s.topic || '—')}</td><td>${esc(s.trainerName || 'Unassigned')}</td><td>${esc(s.covered || '—')}${academicFacultyLogHTML(s.facultyLog)}</td><td>${esc(s.activity || '—')}</td><td>${academicStatusPill(s)}${s.progressNotes?`<div class="subtext">${esc(s.progressNotes)}</div>`:''}</td>${editable?`<td><div style="display:flex;gap:4px;flex-wrap:wrap;"><button class="btn btn-sm ghost" onclick="openEditCalendarSession(${bid},${jsq(s.id)})">Edit</button><button class="btn btn-sm ghost" title="Insert day above" onclick="openAddCalendarSession(${bid},${i})">↑ Add</button><button class="btn btn-sm ghost" onclick="confirmAcademicDayRemoval(${bid},${jsq(s.id)})">Remove</button></div></td>`:''}</tr>`).join('') || `<tr><td colspan="${editable?8:7}"><div class="empty">${cal.length?'No sessions match these filters.':'No days planned yet. Add a day to start tracking faculty progress.'}</div></td></tr>`}
      </tbody></table></div>
    </div>
    ${academicExtraTable(b,'specialSessions')}
    ${academicExtraTable(b,'engagementActivities')}</div>`;
}
function academicModal(title, body, onSave){
  showModal(`<div class="modal-head"><h3>${esc(title)}</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">×</button></div><form id="f-academic"><div class="modal-body">${body}<div id="academic-error" class="subtext" role="alert" hidden></div></div><div class="modal-foot"><div></div><div style="display:flex;gap:8px"><button type="button" class="btn ghost" onclick="closeModal()">Cancel</button><button class="btn primary" type="submit">Save changes</button></div></div></form>`,true);
  document.getElementById('f-academic').addEventListener('submit',e=>{
    e.preventDefault(); if(!canManageAcademicPlanner()) return;
    const error=onSave(new FormData(e.target));
    if(error){ const el=document.getElementById('academic-error'); el.textContent=error; el.hidden=false; return; }
    closeModal(); render(); toast('Academic planner updated');
  });
}
function openAcademicSettings(id){
  const b=batchById(id); if(!b || !canManageAcademicPlanner()) return;
  const p=academicPlanOf(b);
  academicModal('Programme information & academic policies',`
    ${academicInput('Programme','programme',p.programme,'text','required')}
    <div class="field-row">${academicInput('Commencement','commencement',p.commencement,'date')}${academicInput('Planning end','planningEnd',p.planningEnd,'date')}</div>
    <div class="field-row cols-3">${academicInput('Course duration','duration',p.duration)}${academicInput('Academic sessions','academicDuration',p.academicDuration)}${academicInput('Internship','internship',p.internship)}</div>
    <div><label class="field-label">Class days</label><div class="check-row">${ACADEMIC_DAYS.map((d,i)=>`<label class="check-chip"><input type="checkbox" name="classDays" value="${i}" ${p.classDays.includes(i)?'checked':''}>${d}</label>`).join('')}</div></div>
    <div class="field-row">${academicInput('Class starts','classStart',p.classStart,'time')}${academicInput('Class ends','classEnd',p.classEnd,'time')}</div>
    ${academicInput('Minimum attendance (%)','minAttendance',p.minAttendance,'number','min="0" max="100" step="0.1"')}
    <div class="field-row">${academicInput('Assignment submission','assignmentPolicy',p.assignmentPolicy)}${academicInput('Capstone project','capstonePolicy',p.capstonePolicy)}</div>
    <div class="field-row">${academicInput('Internal assessment','assessmentPolicy',p.assessmentPolicy)}${academicInput('Final examination','examPolicy',p.examPolicy)}</div>
    ${academicTextarea('Notes','notes',p.notes)}`,f=>{
      const next=Object.fromEntries(f); next.classDays=f.getAll('classDays').map(Number);
      if(next.commencement && next.planningEnd && next.planningEnd<next.commencement) return 'Planning end must be on or after commencement.';
      if(!!next.classStart!==!!next.classEnd || (next.classStart && next.classEnd<=next.classStart)) return 'Enter both class times, with the end after the start.';
      next.minAttendance=next.minAttendance===''?'':Number(next.minAttendance);
      if(next.minAttendance!=='' && (!Number.isFinite(next.minAttendance)||next.minAttendance<0||next.minAttendance>100)) return 'Minimum attendance must be between 0 and 100.';
      b.academicPlan=next;
      const added=syncAcademicCalendar(b);
      if(added) toast(`${added} class day${added===1?'':'s'} added to the day-wise planner`);
    });
}
const ACADEMIC_EXTRA = {
  specialSessions:{title:'Special sessions tracker',person:'Faculty',personKey:'faculty',actual:'Actual day'},
  engagementActivities:{title:'Student engagement activities',person:'Coordinator',personKey:'coordinator',actual:'Conducted on'}
};
function academicExtraTable(b,key){
  const config=ACADEMIC_EXTRA[key], rows=b[key] || [], editable=canManageAcademicPlanner();
  return `<div class="panel"><div class="panel-head"><h3>${config.title}</h3>${editable?`<button class="btn btn-sm ghost" onclick="openAcademicExtra(${jsq(b.id)},'${key}')">Add ${key==='specialSessions'?'session':'activity'}</button>`:''}</div>
    <div class="table-wrap"><table class="data academic-planner-table"><thead><tr><th>${key==='specialSessions'?'Session':'Activity'}</th><th>${config.person}</th><th>Planned day</th><th>${config.actual}</th><th>Status</th><th>Remarks</th>${editable?'<th>Actions</th>':''}</tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.title)}</td><td>${esc(r[config.personKey] || 'Unassigned')}</td><td>${r.plannedDate?fmtDateShort(r.plannedDate):'Unscheduled'}</td><td>${r.actualDate?fmtDateShort(r.actualDate):'—'}</td><td>${academicStatusPill(r)}</td><td>${esc(r.remarks || '—')}</td>${editable?`<td><button class="btn btn-sm ghost" onclick="openAcademicExtra(${jsq(b.id)},'${key}',${jsq(r.id)})">Edit</button><button class="btn btn-sm ghost" onclick="removeAcademicExtra(${jsq(b.id)},'${key}',${jsq(r.id)})">Remove</button></td>`:''}</tr>`).join('') || `<tr><td colspan="${editable?7:6}"><div class="empty">No ${key==='specialSessions'?'special sessions':'engagement activities'} added yet.</div></td></tr>`}</tbody></table></div></div>`;
}
function openAcademicExtra(batchId,key,id){
  const b=batchById(batchId), config=ACADEMIC_EXTRA[key]; if(!b || !config || !canManageAcademicPlanner()) return;
  const r=id?(b[key] || []).find(x=>x.id===id):{}; if(!r) return;
  academicModal((id?'Edit':'Add')+' '+(key==='specialSessions'?'special session':'engagement activity'),`
    ${academicInput('Title','title',r.title,'text','required')}
    ${academicInput(config.person,config.personKey,r[config.personKey],'text','list="academic-staff-names"')}
    <datalist id="academic-staff-names">${employees.map(e=>`<option value="${esc(e.name)}"></option>`).join('')}</datalist>
    <div class="field-row">${academicInput('Planned day','plannedDate',r.plannedDate,'date')}${academicInput(config.actual,'actualDate',r.actualDate,'date')}</div>
    ${academicStatusSelect(academicStatusOf(r))}${academicTextarea('Remarks','remarks',r.remarks)}`,f=>{
      const next=Object.fromEntries(f); next.title=next.title.trim(); if(!next.title) return 'Enter a title.';
      if(id) Object.assign(r,next); else { if(!b[key]) b[key]=[]; b[key].push({...next,id:'ACA-'+crypto.randomUUID()}); }
    });
}
function removeAcademicExtra(batchId,key,id){
  const b=batchById(batchId); if(!b || !ACADEMIC_EXTRA[key] || !canManageAcademicPlanner()) return;
  if(!confirm('Remove this '+(key==='specialSessions'?'special session':'engagement activity')+'?')) return;
  b[key]=(b[key] || []).filter(r=>r.id!==id); render(); toast('Entry removed');
}
function confirmAcademicDayRemoval(batchId,id){
  if(canManageAcademicPlanner() && confirm('Remove this academic calendar day?')) removeCalendarSession(batchId,id);
}
function academicSessionProgressFields(s={}){
  return `<div class="field-row">${academicInput('Day label (optional)','dayLabel',s.dayLabel)}${academicInput('Module','module',s.module)}</div>
    ${academicTextarea('Topic covered','covered',s.covered)}${academicTextarea('Assignment / Activity','activity',s.activity)}
    ${academicStatusSelect(academicStatusOf(s))}${academicTextarea('Progress notes','progressNotes',s.progressNotes)}`;
}
function academicSessionProgress(f){
  return {dayLabel:f.get('dayLabel') || '', module:f.get('module') || '', covered:f.get('covered') || '', activity:f.get('activity') || '', status:ACADEMIC_STATUSES.includes(f.get('status'))?f.get('status'):'Planned', progressNotes:f.get('progressNotes') || ''};
}
