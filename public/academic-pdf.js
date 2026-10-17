/* Local PDF extraction: retain text coordinates so multi-column calendars are not flattened.
   Imported values are drafts until the coordinator reviews and applies them. */
const ACADEMIC_PDF_FIELDS = {
  calendar:[['dayLabel','Day'],['date','Date','date'],['module','Module'],['topic','Planned topic'],['trainerName','Faculty'],['covered','Topic covered'],['activity','Assignment / Activity'],['status','Status'],['progressNotes','Notes']],
  specialSessions:[['title','Session'],['faculty','Faculty'],['plannedDate','Planned day','date'],['actualDate','Actual day','date'],['status','Status'],['remarks','Remarks']],
  engagementActivities:[['title','Activity'],['coordinator','Coordinator'],['plannedDate','Planned day','date'],['actualDate','Conducted on','date'],['remarks','Remarks']]
};
const ACADEMIC_PDF_PLAN = {programme:'Programme',commencement:'Commencement',planningEnd:'Planning end',duration:'Course duration',academicDuration:'Academic sessions',internship:'Internship',minAttendance:'Minimum attendance (%)',assignmentPolicy:'Assignment submission',capstonePolicy:'Capstone project',assessmentPolicy:'Internal assessment',examPolicy:'Final examination',notes:'Notes',classDays:'Class days (comma-separated)',classStart:'Class starts',classEnd:'Class ends'};
function academicPdfLines(items){
  const rows=[];
  for(const it of items){
    if(!it.str?.trim()) continue;
    const x=it.transform[4],y=it.transform[5];
    let row=rows.find(r=>Math.abs(r.y-y)<2.5);
    if(!row){row={y,parts:[]};rows.push(row);}
    row.parts.push({x,width:Math.abs(it.width || 0),text:it.str.trim()});
  }
  return rows.sort((a,b)=>b.y-a.y).map(r=>({...r,parts:r.parts.sort((a,b)=>a.x-b.x)}));
}
function academicPdfDate(text,year){
  let s=String(text || '').replace(/(\d)(st|nd|rd|th)\b/gi,'$1').replace(/\s+/g,' ').trim();
  if(!s || /^(?:—|-|nil|none)$/i.test(s)) return '';
  let m,y=Number(year),month,day;
  if((m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))){y=+m[1];month=+m[2];day=+m[3];}
  else if((m=s.match(/^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{4}))?$/))){day=+m[1];month=+m[2];if(m[3])y=+m[3];}
  else {
    const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    m=s.match(/^(?:([a-z]+)\s+(\d{1,2})|(\d{1,2})\s+([a-z]+))(?:,?\s+(\d{4}))?$/i);
    if(!m)return ''; month=months.indexOf((m[1]||m[4]).slice(0,3).toLowerCase())+1;day=+(m[2]||m[3]);if(m[5])y=+m[5];
  }
  const d=new Date(Date.UTC(y,month-1,day));
  return y>=1900 && y<=2200 && d.getUTCFullYear()===y && d.getUTCMonth()===month-1 && d.getUTCDate()===day ? `${y}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}` : '';
}
function academicPdfWeekdays(value){
  const names=['sun','mon','tue','wed','thu','fri','sat'];
  const matches=[...String(value).toLowerCase().matchAll(/sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?/g)];
  if(!matches.length)return [];
  const days=matches.map(m=>names.indexOf(m[0].slice(0,3)));
  if(days.length===2 && /[-–—]|\bto\b/i.test(value)){const out=[days[0]];while(out.at(-1)!==days[1] && out.length<7)out.push((out.at(-1)+1)%7);return out;}
  return [...new Set(days)];
}
function academicPdfTimes(value){
  const matches=[...value.matchAll(/(\d{1,2}):(\d{2})\s*(AM|PM)?/gi)];
  if(matches.length!==2)return null;
  const times=matches.map(m=>{let h=+m[1];const min=+m[2],ap=m[3]?.toUpperCase();if(min>59 || (ap?(h<1||h>12):h>23))return '';if(ap)h=h%12+(ap==='PM'?12:0);return String(h).padStart(2,'0')+':'+String(min).padStart(2,'0');});
  return times.every(Boolean)&&times[1]>times[0]?times:null;
}
function academicPdfStatus(s){
  if(/^(done|completed|complete|100%)$/i.test(s.trim()))return 'Completed';
  if(/^(in progress|ongoing|started)$/i.test(s.trim()))return 'In progress';
  if(/^(pending|planned|not started)$/i.test(s.trim()))return 'Planned';
  if(/^postponed$/i.test(s.trim()))return 'Postponed';
  if(/^(cancelled|canceled)$/i.test(s.trim()))return 'Cancelled';
  return '';
}
function parseAcademicPdfPages(pages,year){
  const result={academicPlan:{},calendar:[],specialSessions:[],engagementActivities:[],warnings:[]};
  let table=null,current=null,section='',lastY=null;
  const warn=t=>{if(!result.warnings.includes(t))result.warnings.push(t);};
  function finish(){
    if(!current || !table)return;
    const r={};for(const [k,v]of Object.entries(current))r[k]=v.replace(/\s+/g,' ').trim();
    if(table.kind==='calendar' && !r.dayLabel && !r.topic){current=null;return;}
    if(table.kind!=='calendar' && !r.title){current=null;return;}
    if(table.kind==='calendar')r.sourceSection=section;
    for(const key of ['date','plannedDate','actualDate'])if(r[key]){
      const raw=r[key];r[key]=academicPdfDate(raw,year);
      if(!r[key]){r[table.kind==='calendar'?'progressNotes':'remarks']=((r[table.kind==='calendar'?'progressNotes':'remarks']||'')+' Unread date: '+raw).trim();warn('Some dates could not be read. Check the date fields and notes.');}
    }
    if(r.status){const raw=r.status;r.status=academicPdfStatus(raw);if(!r.status){const k=table.kind==='calendar'?'progressNotes':'remarks';r[k]=((r[k]||'')+' '+raw).trim();warn('Unrecognised statuses were kept as notes. Choose a status in the preview.');}}
    result[table.kind].push(r);current=null;
  }
  const headers={calendar:[['dayLabel',/^day$/i],['date',/^date$/i],['module',/^module$/i],['topic',/^planned\s*topic$/i],['trainerName',/^(faculty|trainer)$/i],['covered',/^topic\s*covered$/i],['activity',/^assignment(?:\s*\/\s*activity)?$/i],['status',/^status$/i]],specialSessions:[['number',/^(no\.?|#)$/i],['title',/^session$/i],['faculty',/^faculty$/i],['plannedDate',/^planned\s*day$/i],['actualDate',/^actual\s*day$/i],['status',/^status$/i],['remarks',/^remarks$/i]],engagementActivities:[['title',/^activity$/i],['plannedDate',/^planned\s*day$/i],['actualDate',/^conducted\s*on$/i],['coordinator',/^coordinator$/i],['remarks',/^remarks$/i]]};
  const meta=[['programme',/^programme$/i],['commencement',/^batch commencement$/i],['duration',/^course duration$/i],['academicDuration',/^academic sessions$/i],['internship',/^internship$/i],['minAttendance',/^minimum attendance$/i],['assignmentPolicy',/^assignment submission$/i],['capstonePolicy',/^capstone project$/i],['assessmentPolicy',/^internal assessment$/i],['examPolicy',/^final examination$/i]];
  for(const [pageIndex,page] of pages.entries()){
    if(!page.some(it=>it.str?.trim()))warn('Page '+(pageIndex+1)+' has no readable text (blank or scanned). Check it for entries that need manual input.');
    const lines=academicPdfLines(page);
    for(let i=0;i<lines.length;i++){
      const line=lines[i],text=line.parts.map(p=>p.text).join(' ').trim();
      // Find header labels using up to three adjacent baselines for wrapped column headings.
      let detected=null;
      for(let n=1;n<=3 && i+n<=lines.length;n++){
        const band=lines.slice(i,i+n);if(band[0].y-band.at(-1).y>32)break;
        const groups=[];
        for(const row of band)for(const part of row.parts){
          const center=part.x+part.width/2;
          let g=groups.filter(g=>g.y!==row.y && Math.abs(g.center-center)<Math.max(18,g.width/2)).sort((a,b)=>Math.abs(a.center-center)-Math.abs(b.center-center))[0];
          if(!g){g={x:part.x,center,width:part.width,text:'',y:row.y};groups.push(g);}
          g.text+=(g.text?' ':'')+part.text;
        }
        for(const [kind,defs]of Object.entries(headers)){
          const columns=defs.map(([key,re])=>{const p=groups.find(p=>re.test(p.text)||re.test(p.text.replace(/\s+/g,'')));return p?{key,x:p.x,center:p.center,width:p.width}:null;}).filter(Boolean).sort((a,b)=>a.x-b.x);
          const keys=columns.map(c=>c.key);
          if((kind==='calendar' && keys.includes('dayLabel') && keys.includes('topic') && keys.length>=5)||(kind==='specialSessions' && keys.includes('title')&&keys.includes('faculty')&&keys.includes('actualDate'))||(kind==='engagementActivities'&&keys.includes('title')&&keys.includes('coordinator')&&keys.includes('actualDate'))){
            if(!detected || columns.length>detected.columns.length)detected={kind,columns,n};
          }
        }
      }
      if(detected){
        // A repeated page header may interrupt a row whose text continues on the next page.
        if(table && table.kind!==detected.kind)finish();
        table=detected;lastY=null;i+=detected.n-1;continue;
      }
      const sectionHeading=/^(?:\d+[.)]?\s*)?(?:programme information|academic policies|day-wise academic planner|special sessions tracker|student engagement activities)\s*$/i.test(text);
      const moduleHeading=/^(?:[A-Z]|\d+)[.)]\s*\S/i.test(text) && (line.parts.length===1 || (line.parts.length===2 && /^[A-Z][.)]$/.test(line.parts[0].text)));
      if(sectionHeading || moduleHeading){finish();table=null;if(moduleHeading)section=text;continue;}
      // Programme/policy key-value rows are outside the planner tables.
      if(!table){
        const timing=line.parts.find(p=>/^class timings$/i.test(p.text));
        if(timing){const times=academicPdfTimes(line.parts.filter(p=>p.x>timing.x+10).map(p=>p.text).join(' '));if(times){result.academicPlan.classStart=times[0];result.academicPlan.classEnd=times[1];}}
        const classDays=line.parts.find(p=>/^class days$/i.test(p.text));
        if(classDays){const days=academicPdfWeekdays(line.parts.filter(p=>p.x>classDays.x+10).map(p=>p.text).join(' '));if(days.length)result.academicPlan.classDays=days.map(i=>['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][i]).join(', ');}
        const summaryDate=text.match(/^(?:[•●]\s*)?(Start|End):\s*(.+)$/i);
        if(summaryDate){const d=academicPdfDate(summaryDate[2],year);if(d)result.academicPlan[summaryDate[1].toLowerCase()==='start'?'commencement':'planningEnd']=d;}
        for(const [key,re]of meta){
          const part=line.parts.find(p=>re.test(p.text));if(!part)continue;
          let value=line.parts.filter(p=>p.x>part.x+10).map(p=>p.text).join(' ').trim();
          if(!value)continue;
          if(key==='commencement'){const d=academicPdfDate(value,year);if(!d){warn('Check the programme commencement date manually.');continue;}value=d;}
          if(key==='minAttendance'){const match=value.match(/^(\d+(?:\.\d+)?)\s*%?$/);if(!match || +match[1]>100)continue;value=match[1];}
          result.academicPlan[key]=value;
        }
        continue;
      }
      if(/^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i.test(text) && line.parts.length===1 && line.y<65)continue;
      const cells={};
      for(const p of line.parts){const center=p.x+p.width/2;const column=table.columns.reduce((best,c)=>Math.abs(c.center-center)<Math.abs(best.center-center)?c:best,table.columns[0]);cells[column.key]=(cells[column.key]?cells[column.key]+' ':'')+p.text;}
      let newRow=false;
      if(table.kind==='calendar')newRow=/^day\s*\d+/i.test(cells.dayLabel||'') || /^day$/i.test(cells.dayLabel||'');
      else if(table.kind==='specialSessions')newRow=/^\d+[.)]?$/.test(cells.number||'') || (!table.columns.some(c=>c.key==='number') && !!cells.title && !current);
      else newRow=!!cells.title && (!current || !!cells.plannedDate || /^engagement activity\s*\d+/i.test(cells.title) || (lastY!==null && lastY-line.y>18));
      if(newRow){finish();current={};}
      lastY=line.y;
      if(!current){if(Object.values(cells).some(Boolean))warn('Some text did not match a table row. Review the PDF for missing entries.');continue;}
      for(const [k,v]of Object.entries(cells))if(k!=='number')current[k]=(current[k]?current[k]+' ':'')+v;
    }
  }
  finish();
  if(!result.calendar.length && !result.specialSessions.length && !result.engagementActivities.length && !Object.keys(result.academicPlan).length)warn('No supported academic calendar tables were detected. Use a PDF with Day, Date, Module, Planned Topic and Faculty column headings, or add entries manually.');
  return result;
}
async function readAcademicPdf(file){
  const lib=await loadPdfJs();let pdf;
  try{
    pdf=await lib.getDocument({data:await file.arrayBuffer(),isEvalSupported:false}).promise;
    if(pdf.numPages>150)throw new Error('Please use a PDF with 150 pages or fewer.');
    const pages=[];for(let n=1;n<=pdf.numPages;n++){const page=await pdf.getPage(n);pages.push((await page.getTextContent()).items);page.cleanup();}
    if(!pages.some(items=>items.some(it=>it.str?.trim())))throw new Error('This PDF has no readable text. Scanned PDFs need OCR first; you can still enter the calendar manually.');
    return pages;
  }finally{if(pdf)await pdf.destroy();}
}
let academicPdfDraft=null,academicPdfJob=0;
function openAcademicPdfImport(id){
  const b=batchById(id);if(!b || !canManageAcademicPlanner())return;
  academicPdfDraft=null;const job=++academicPdfJob;
  showModal(`<div class="modal-head"><h3>Import academic calendar PDF</h3><button class="modal-close" onclick="closeModal()" aria-label="Close">×</button></div><div class="modal-body" id="academic-pdf-import" data-job="${job}">
    <div class="subtext">Select a text-based calendar PDF. Review and edit the extracted fields before applying them to ${esc(b.label)}. Manual entry remains available.</div>
    ${academicInput('Year for dates without a year','pdfYear',(b.startDate || TODAY).slice(0,4),'number','min="1900" max="2200" required')}
    <div><label class="field-label" for="academic-pdf-file">Academic calendar PDF (up to 15 MB)</label><input id="academic-pdf-file" class="field-input" type="file" accept=".pdf,application/pdf" onchange="importAcademicPdf(this,${jsq(id)},${job})"></div>
    <div id="academic-pdf-status" role="status" class="subtext">The file is read in your browser.</div><div id="academic-pdf-preview"></div>
    </div><div class="modal-foot"><button class="btn ghost" onclick="closeModal()">Cancel</button><button id="academic-pdf-apply" class="btn primary" disabled onclick="applyAcademicPdfImport()">Apply reviewed import</button></div>`,true);
}
function academicPdfMatch(b,key,row){
  const candidates=(b[key]||[]).filter(old=>key==='calendar' ?
    ((row.dayLabel && old.dayLabel===row.dayLabel && row.sourceSection && old.sourceSection===row.sourceSection) || (row.topic && old.topic===row.topic && (row.date?old.date===row.date:old.module===row.module))) : old.title===row.title);
  return candidates.length===1?candidates[0].id:'new';
}
async function importAcademicPdf(input,batchId,job){
  const file=input.files?.[0];if(!file)return;
  const status=document.getElementById('academic-pdf-status'),preview=document.getElementById('academic-pdf-preview'),apply=document.getElementById('academic-pdf-apply'),yearEl=document.getElementById('academic-pdfYear');
  const active=()=>document.getElementById('academic-pdf-import')?.dataset.job===String(job);
  academicPdfDraft=null;preview.innerHTML='';apply.disabled=true;
  if(!yearEl.reportValidity())return;
  if(!/\.pdf$/i.test(file.name) && file.type!=='application/pdf'){status.textContent='Please select a PDF file.';return;}
  if(file.size>15*1024*1024){status.textContent='Please choose a PDF smaller than 15 MB.';return;}
  input.disabled=true;yearEl.disabled=true;status.textContent='Reading '+file.name+'…';
  try{
    const pages=await readAcademicPdf(file);if(!active())return;
    const data=parseAcademicPdfPages(pages,Number(yearEl.value));
    const count=Object.keys(ACADEMIC_PDF_FIELDS).reduce((n,k)=>n+data[k].length,0);
    if(count>500)throw new Error('Please split this PDF into files with at most 500 entries.');
    const b=batchById(batchId);if(!b || !canManageAcademicPlanner())return;
    academicPdfDraft={batchId,data,base:JSON.stringify(b),job};
    status.textContent=`Read ${file.name}: ${data.calendar.length} calendar days, ${data.specialSessions.length} special sessions and ${data.engagementActivities.length} engagement activities. Review every field, especially dates and table rows.`;
    preview.innerHTML=academicPdfPreview(b,data);
    apply.disabled=!count&&!Object.keys(data.academicPlan).length;
  }catch(err){if(active())status.textContent='Could not import: '+err.message;}
  finally{if(active()){input.disabled=false;yearEl.disabled=false;input.value='';}}
}
function academicPdfPreview(b,data){
  let html=data.warnings.map(w=>`<div class="banner muted">${esc(w)}</div>`).join('');
  if(Object.keys(data.academicPlan).length)html+=`<details open><summary>Programme & policies</summary><div class="modal-body">${Object.entries(data.academicPlan).map(([k,v])=>`<label class="check-chip"><input type="checkbox" data-pdf-plan="${k}" checked>Apply ${esc(ACADEMIC_PDF_PLAN[k])}</label>${academicInput(ACADEMIC_PDF_PLAN[k],'pdf-plan-'+k,v,k==='commencement'||k==='planningEnd'?'date':k==='classStart'||k==='classEnd'?'time':'text')}`).join('')}</div></details>`;
  for(const [key,fields]of Object.entries(ACADEMIC_PDF_FIELDS)){
    if(!data[key].length)continue;
    html+=`<h3>${key==='calendar'?'Day-wise calendar':ACADEMIC_EXTRA[key].title} (${data[key].length})</h3>`;
    data[key].forEach((r,i)=>{
      const match=academicPdfMatch(b,key,r), label=[r.sourceSection,r.dayLabel||r.title||'Entry '+(i+1)].filter(Boolean).join(' · ');
      html+=`<details class="academic-import-row" data-pdf-key="${key}" data-pdf-index="${i}"><summary>${esc(label)}${r.topic?' · '+esc(r.topic):''} — ${match==='new'?'Add new':'Update matching entry'}</summary><div class="modal-body">
      <div><label class="field-label">Import action</label><select class="field-input" data-pdf-action><option value="new" ${match==='new'?'selected':''}>Add new entry</option><option value="skip">Skip this entry</option>${(b[key]||[]).map(old=>`<option value="${esc(old.id)}" ${match===old.id?'selected':''}>Update: ${esc(old.dayLabel||old.title||old.topic||old.id)} ${esc(old.date||'')}</option>`).join('')}</select></div>
      ${fields.map(([name,label,type])=>`<div><label class="field-label">${esc(label)}</label>${name==='status'?`<select class="field-input" data-pdf-field="${name}"><option value="">Keep current / Planned if new</option>${ACADEMIC_STATUSES.map(s=>`<option ${r[name]===s?'selected':''}>${s}</option>`).join('')}</select>`:type==='date'?`<input class="field-input" type="date" data-pdf-field="${name}" value="${esc(r[name]||'')}">`:`<textarea class="field-input" rows="2" data-pdf-field="${name}">${esc(r[name]||'')}</textarea>`}</div>`).join('')}</div></details>`;
    });
  }
  return html+'<div class="subtext">Updates keep existing IDs, syllabus links and any fields left blank in this preview. No existing entries are deleted. To clear a field, use its manual Edit form.</div>';
}
function applyAcademicPdfImport(){
  const draft=academicPdfDraft,b=draft&&batchById(draft.batchId),status=document.getElementById('academic-pdf-status');
  if(!draft || !b || !canManageAcademicPlanner() || document.getElementById('academic-pdf-import')?.dataset.job!==String(draft.job))return;
  if(JSON.stringify(b)!==draft.base){status.textContent='This batch changed while the preview was open. Choose the PDF again to review the latest entries.';return;}
  const next=JSON.parse(JSON.stringify(b)),used=new Set();let count=0;
  for(const el of document.querySelectorAll('[data-pdf-plan]:checked')){
    const key=el.dataset.pdfPlan,value=document.getElementById('academic-pdf-plan-'+key).value.trim();
    if(!value)continue;
    if(key==='minAttendance' && (!Number.isFinite(Number(value))||Number(value)<0||Number(value)>100)){status.textContent='Minimum attendance must be between 0 and 100.';return;}
    if(key==='classDays' && !academicPdfWeekdays(value).length){status.textContent='Enter valid class day names, such as Monday, Tuesday.';return;}
    if(!next.academicPlan)next.academicPlan={};next.academicPlan[key]=key==='minAttendance'?Number(value):key==='classDays'?academicPdfWeekdays(value):value;count++;
  }
  for(const el of document.querySelectorAll('[data-pdf-key]')){
    const key=el.dataset.pdfKey,index=Number(el.dataset.pdfIndex),action=el.querySelector('[data-pdf-action]').value;if(action==='skip')continue;
    const values={};for(const f of el.querySelectorAll('[data-pdf-field]')){if(!f.reportValidity()){status.textContent='Check the invalid field in the preview.';el.open=true;return;}if(f.value.trim())values[f.dataset.pdfField]=f.value.trim();}
    if(key==='calendar'?(!values.topic&&!values.dayLabel):!values.title){el.open=true;status.textContent=key==='calendar'?'Enter a day label or planned topic, or skip this calendar day.':'Enter a title or skip this entry.';return;}
    if(!next[key])next[key]=[];
    if(action==='new'){
      const sourceSection=draft.data[key][index].sourceSection;
      next[key].push({id:key==='calendar'?'SESS-'+crypto.randomUUID():'ACA-'+crypto.randomUUID(),status:'Planned',...(key==='calendar'?{date:'',trainerType:employees.some(e=>e.name===values.trainerName)?'staff':'guest',sourceSection:sourceSection||''}:{}),...values});
    }else{
      if(used.has(key+':'+action)){status.textContent='Two imported rows target the same existing entry. Choose a different action or skip one.';return;}
      const old=next[key].find(r=>r.id===action);if(!old){status.textContent='The entry to update no longer exists. Reopen the import.';return;}
      if(key==='calendar'){
        if(draft.data[key][index].sourceSection)values.sourceSection=draft.data[key][index].sourceSection;
        if(values.trainerName && values.trainerName!==old.trainerName)values.trainerType=employees.some(e=>e.name===values.trainerName)?'staff':'guest';
      }
      Object.assign(old,values);used.add(key+':'+action);
    }
    count++;
  }
  const p=academicPlanOf(next);if(p.commencement && p.planningEnd && p.planningEnd<p.commencement){status.textContent='Planning end must be on or after commencement. Review the programme dates.';return;}
  if((p.classStart || p.classEnd) && (!p.classStart || !p.classEnd || p.classEnd<=p.classStart)){status.textContent='Review the programme class times: enter both times with the end after the start.';return;}
  if(!count){status.textContent='Select at least one entry or programme field to import.';return;}
  Object.assign(b,next);academicPdfDraft=null;closeModal();academicFaculty='';academicStatus='';render();toast('Academic PDF import applied');
}
