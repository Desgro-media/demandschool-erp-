/* ===================== API + LOGIN GATE ===================== */
// All data lives on the server (Neon Postgres). The browser holds a signed HttpOnly session cookie it
// cannot read, so a script injected into the page still cannot steal the session token.
async function api(path, opts){
  opts = opts || {};
  const method = opts.method || 'GET';
  const init = { method, credentials:'same-origin', headers:{ 'X-Requested-With':'demand-erp' } };
  if(method!=='GET'){ init.headers['Content-Type']='application/json'; init.body = JSON.stringify(opts.body || {}); }
  let r;
  try{ r = await fetch('/api/'+path, init); }
  catch(_){ const e = new Error('Cannot reach the server — check your connection'); e.status = 0; throw e; }
  let data = null; try{ data = await r.json(); }catch(_){}
  if(!r.ok){ const e = new Error((data && data.error) || ('Request failed ('+r.status+')')); e.status = r.status; throw e; }
  return data;
}

// Creates or resets a login on the server. The password is sent once over HTTPS and stored only as a
// scrypt hash; it never enters the in-browser data (or the saved state) at all.
async function grantLogin(kind, refId, email, password){
  if(!password) return;
  try{
    await saveNow();   // the server checks the employee/student record exists before creating the login
    await api('users', { method:'POST', body:{ action:'set', kind, refId, email, password } });
    toast('Login saved for '+email);
  }catch(err){ toast("Record saved, but the login wasn't set: "+err.message); }
}

/* ---- state sync: each top-level collection is one JSON document on the server ---- */
const SYNC_KEYS = {
  COURSES:()=>COURSES, courseSettings:()=>courseSettings, employees:()=>employees, attendanceByDate:()=>attendanceByDate,
  monthPresentDays:()=>monthPresentDays, hrPolicy:()=>hrPolicy, leaveRequests:()=>leaveRequests, advances:()=>advances,
  paymentRequests:()=>paymentRequests, withdrawalRequests:()=>withdrawalRequests, openPositions:()=>openPositions,
  candidates:()=>candidates, complaints:()=>complaints, notices:()=>notices, payroll:()=>payroll,
  leavePayPolicy:()=>leavePayPolicy, students:()=>students, studentComplaints:()=>studentComplaints, batches:()=>batches,
  sessionLogs:()=>sessionLogs, materials:()=>materials, assignments:()=>assignments, submissions:()=>submissions,
  studentTasks:()=>studentTasks, contentItems:()=>contentItems, metaAdsCampaigns:()=>metaAdsCampaigns,
  marketingLeads:()=>marketingLeads, quotes:()=>quotes, invoices:()=>invoices, payables:()=>payables,
  commissionWithdrawals:()=>commissionWithdrawals, expenses:()=>expenses, bankAccounts:()=>bankAccounts,
  bankTransactions:()=>bankTransactions, chartOfAccounts:()=>chartOfAccounts, journalEntries:()=>journalEntries
};
let syncEnabled = false, syncBusy = false, syncDirty = false, syncTimer = null;
let syncWritable = [];
const syncVersions = {}, syncSnap = {};

// Replace contents in place so `const` collections and captured references keep working.
function replaceInPlace(target, value){
  if(Array.isArray(target)){ target.length = 0; for(let i=0;i<value.length;i++) target.push(value[i]); }
  else { Object.keys(target).forEach(k=>{ delete target[k]; }); Object.assign(target, value); }
}
function applyServerValue(key, value){
  if(key==='attendanceByDate'){
    // attendanceToday is aliased into attendanceByDate[TODAY]; keep that identity intact.
    const today = value[TODAY] || {};
    replaceInPlace(attendanceByDate, value);
    replaceInPlace(attendanceToday, today);
    attendanceByDate[TODAY] = attendanceToday;
    return;
  }
  replaceInPlace(SYNC_KEYS[key](), value);
}
// In-memory ID counters restart on every page load; after real data is loaded they must continue from
// the highest ID already stored, or a new material/assignment/post could reuse an existing ID.
function reseedIdCounters(){
  const maxNum = (arr, re) => arr.reduce((m,x)=>{ const r = re.exec(String(x && x.id)); return r ? Math.max(m, Number(r[1])) : m; }, 0);
  materialsNextId = Math.max(materialsNextId, maxNum(materials, /^MAT-(\d+)$/) + 1);
  assignmentsNextId = Math.max(assignmentsNextId, maxNum(assignments, /^ASG-(\d+)$/) + 1);
  contentNextId = Math.max(contentNextId, maxNum(contentItems, /^(\d+)$/) + 1);
  batches.forEach(b=>(b.calendar||[]).forEach(s=>{ const r = /^SESS-(\d+)$/.exec(String(s.id)); if(r) calSessionSeq = Math.max(calSessionSeq, Number(r[1])); }));
}
function loadServerState(state){
  for(const k of Object.keys(state)){
    if(!SYNC_KEYS[k]) continue;
    applyServerValue(k, state[k].value);
    syncVersions[k] = state[k].version;
  }
  // A collection the server has never stored keeps the app's built-in starting data. Mark it unsaved ('')
  // so the first person allowed to write it uploads it — otherwise the server would have no employee
  // list to check logins and roles against.
  for(const k of Object.keys(SYNC_KEYS)) syncSnap[k] = (k in state) ? JSON.stringify(SYNC_KEYS[k]()) : '';
  reseedIdCounters();
}
function rerenderCurrent(){
  if(currentStudent) renderStudentPortal(); else if(currentUser) render();
}
async function reloadFromServer(){
  const { state } = await api('state');
  loadServerState(state);
  rerenderCurrent();
}
function queueSave(){
  if(!syncEnabled) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(flushState, 700);
}
async function flushState(){
  if(!syncEnabled) return;
  if(syncBusy){ syncDirty = true; return; }
  const changes = {}, sent = {};
  for(const k of syncWritable){
    if(!SYNC_KEYS[k]) continue;
    const cur = JSON.stringify(SYNC_KEYS[k]());
    if(cur !== syncSnap[k]){ changes[k] = { base: syncVersions[k] || 0, value: JSON.parse(cur) }; sent[k] = cur; }
  }
  if(!Object.keys(changes).length) return;
  syncBusy = true;
  try{
    const { results } = await api('state', { method:'PUT', body:{ changes } });
    let conflict = false, refresh = false;
    for(const k of Object.keys(results)){
      const r = results[k];
      if(r.conflict){ conflict = true; continue; }
      syncVersions[k] = r.version;
      if(r.value !== undefined){ applyServerValue(k, r.value); syncSnap[k] = JSON.stringify(SYNC_KEYS[k]()); refresh = true; }
      else syncSnap[k] = sent[k];
    }
    if(conflict){ await reloadFromServer(); toast('Someone else changed this data — your screen was refreshed'); }
    else if(refresh) rerenderCurrent();
  }catch(err){
    if(err.status===401){ toast('Session expired — please sign in again'); setTimeout(()=>location.reload(), 1200); }
    else if(err.status>=400 && err.status<500){
      for(const k of Object.keys(sent)) syncSnap[k] = sent[k];   // rejected for good; don't retry forever
      toast("Couldn't save: "+err.message);
    } else toast("Couldn't save — will retry ("+err.message+")");
  }finally{
    syncBusy = false;
    if(syncDirty){ syncDirty = false; queueSave(); }
  }
}
// Save right now and wait for it (used when a follow-up server call depends on the data being stored).
async function saveNow(){
  clearTimeout(syncTimer);
  while(syncBusy) await new Promise(r=>setTimeout(r,60));
  await flushState();
  while(syncBusy) await new Promise(r=>setTimeout(r,60));
}
// Every UI mutation ends in a render, so hooking render() persists changes without touching each handler;
// the interval catches the few mutations (board drag-drop, etc.) that re-render only a fragment.
{
  const _render = render, _renderStudent = renderStudentPortal;
  render = function(){ const r = _render.apply(this, arguments); queueSave(); return r; };
  renderStudentPortal = function(){ const r = _renderStudent.apply(this, arguments); queueSave(); return r; };
  setInterval(queueSave, 8000);
  window.addEventListener('beforeunload', e=>{
    if(!syncEnabled) return;
    const pending = syncBusy || syncWritable.some(k=>SYNC_KEYS[k] && JSON.stringify(SYNC_KEYS[k]())!==syncSnap[k]);
    if(pending){ e.preventDefault(); e.returnValue = ''; }
  });
}

/* ---- login ---- */
let loginMode = 'staff';
function setLoginMode(mode){
  loginMode = mode;
  document.getElementById('login-tab-staff').classList.toggle('active', mode==='staff');
  document.getElementById('login-tab-student').classList.toggle('active', mode==='student');
  document.getElementById('login-fields-staff').hidden = mode!=='staff';
  document.getElementById('login-fields-student').hidden = mode!=='student';
  document.getElementById('login-card-sub').textContent = mode==='staff' ? 'Use your Demand School work account to continue.' : 'Sign in to see your courses, fees, attendance and scores.';
  const errEl = document.getElementById('login-error'); if(errEl) errEl.hidden = true;
}
let currentUser = null;
let currentStudent = null;
function applyCurrentUser(emp){
  currentUser = emp;
  const ini = initials(emp.name);
  document.getElementById('sidebar-avatar').textContent = ini;
  document.getElementById('sidebar-name').textContent = emp.name;
  document.getElementById('sidebar-role').textContent = emp.role;
  document.getElementById('topbar-avatar').textContent = ini;
}
// Loads this user's data from the server and opens the right shell. Throws if their record is missing.
async function bootSession(user, writable, readable){
  const { state } = await api('state');
  loadServerState(state);
  syncWritable = writable || [];
  // The page ships with built-in starting data for every collection. For collections this user is not
  // allowed to read, drop it, so a restricted account never works with (or sees) placeholder records.
  if(readable){
    for(const k of Object.keys(SYNC_KEYS)){
      if(readable.includes(k) || k==='chartOfAccounts') continue;
      const t = SYNC_KEYS[k]();
      if(Array.isArray(t)){ replaceInPlace(t, []); syncSnap[k] = '[]'; }
    }
  }
  if(user.kind==='student'){
    const s = studentById(user.refId);
    if(!s) throw new Error('Your student record was not found — contact admissions');
    applyCurrentStudent(s);
    studentTab = 'overview';
    document.getElementById('login-screen').hidden = true;
    document.getElementById('student-shell').hidden = false;
    syncEnabled = true;
    toast("Welcome, "+s.name.split(' ')[0]);
    renderStudentPortal();
    return;
  }
  const emp = employees.find(x=>x.id===user.refId);
  if(!emp) throw new Error('Your employee record was not found — contact HR');
  applyCurrentUser(emp);
  // Land each sign-in on the right home screen — HR only ever sees the HR module, and Staff/Sales land
  // on their own personal workspace, so start there instead of the full company Dashboard.
  nav.module = isHRRole(emp) ? 'hr' : ((isStaffRole(emp) || isSalesRole(emp)) ? 'workspace' : 'dashboard');
  {
    const landingMod = visibleModules().find(m=>m.id===nav.module);
    nav.sub[nav.module] = (landingMod && landingMod.sub && landingMod.sub.length) ? landingMod.sub[0].id : (nav.sub[nav.module] || 'overview');
  }
  nav.detail = null;
  document.getElementById('login-screen').hidden = true;
  document.getElementById('app-shell').hidden = false;
  syncEnabled = true;
  toast("Welcome back, "+emp.name.split(' ')[0]);
  render();
}
async function doLogin(e){
  e.preventDefault();
  const errEl = document.getElementById('login-error');
  const btn = e.target.querySelector('button[type=submit]');
  const email = document.getElementById(loginMode==='student' ? 'login-email-student' : 'login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if(!email || !password){ errEl.textContent = 'Enter your email and password to continue.'; errEl.hidden = false; return; }
  errEl.hidden = true; btn.disabled = true;
  try{
    const res = await api('login', { method:'POST', body:{ email, password, kind: loginMode } });
    document.getElementById('login-password').value = '';
    await bootSession(res.user, res.writable, res.readable);
  }catch(err){
    errEl.textContent = err.message; errEl.hidden = false;
  }finally{ btn.disabled = false; }
}
// Sign out: flush unsaved changes, drop the server session, then reload so no data from this
// account stays in browser memory for the next person who signs in on this machine.
async function signOut(){
  try{ await saveNow(); }catch(_){}
  syncEnabled = false;
  try{ await api('logout', { method:'POST' }); }catch(_){}
  location.reload();
}
function doLogout(){ signOut(); }
function doStudentLogout(){ signOut(); }
function applyCurrentStudent(s){
  currentStudent = s;
  const ini = initials(s.name);
  document.getElementById('student-sidebar-avatar').textContent = ini;
  document.getElementById('student-sidebar-name').textContent = s.name;
  document.getElementById('student-sidebar-role').textContent = s.course;
}
