// End-to-end API check against a running server (npm run dev), using the file store.
//   ADMIN_PW='...' node scripts/smoke-test.mjs [http://localhost:3000]
const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const ADMIN = { email: 'thanseemca@gmail.com', password: process.env.ADMIN_PW };
let failed = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  ' + extra}`); if (!ok) failed++; };

function client() {
  let cookie = '';
  return async (path, { method = 'GET', body, headers = {}, csrf = true } = {}) => {
    const h = { ...headers };
    if (cookie) h.Cookie = cookie;
    if (method !== 'GET' && csrf) { h['Content-Type'] = 'application/json'; h['X-Requested-With'] = 'demand-erp'; }
    const r = await fetch(BASE + '/api/' + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    let json = null; try { json = await r.json(); } catch {}
    return { status: r.status, json, setCookie: set };
  };
}
const put = (api, changes) => api('state', { method: 'PUT', body: { changes } });

const admin = client();
check('unauthenticated state is 401', (await client()('state')).status === 401);
const bad = await client()('login', { method: 'POST', body: { ...ADMIN, password: 'wrong-password1' } });
check('wrong password -> 401 generic', bad.status === 401 && bad.json.error === 'Incorrect email or password');
const noCsrf = await client()('login', { method: 'POST', body: ADMIN, csrf: false, headers: { 'Content-Type': 'application/json' } });
check('login without CSRF header -> 403', noCsrf.status === 403);
const li = await admin('login', { method: 'POST', body: ADMIN });
check('admin login ok', li.status === 200 && li.json.user.access === 'leadership', JSON.stringify(li.json));
check('cookie is HttpOnly + SameSite=Strict', /HttpOnly/.test(li.setCookie) && /SameSite=Strict/.test(li.setCookie));
check('student tab cannot log in with staff account', (await client()('login', { method: 'POST', body: { ...ADMIN, kind: 'student' } })).status === 401);

// seed employees (as leadership) and logins
const employees = [
  { id: 'EMP-101', name: 'Thanseem', dept: 'Administrative', role: 'COO & Head, Demand School', email: ADMIN.email, employmentStatus: 'Active', salary: 65000 },
  { id: 'EMP-102', name: 'Hana', dept: 'Administrative', role: 'HR Manager', email: 'hana@demandschool.in', employmentStatus: 'Active', salary: 40000 },
  { id: 'EMP-103', name: 'Sam', dept: 'Marketing', role: 'Designer', email: 'sam@demandschool.in', employmentStatus: 'Active', salary: 30000 },
  { id: 'EMP-104', name: 'Rita', dept: 'Sales', role: 'Sales Executive', email: 'rita@demandschool.in', employmentStatus: 'Active', salary: 25000, password: 'leak-me' },
  { id: 'EMP-105', name: 'Ravi', dept: 'Academics', role: 'Academic Head', email: 'ravi@demandschool.in', employmentStatus: 'Active', salary: 38000 },
];
let r = await put(admin, { employees: { base: 0, value: employees } });
check('leadership writes employees', r.status === 200 && r.json.results.employees.version === 1, JSON.stringify(r.json));
const stored = await admin('state');
check('password field stripped from stored employees', !JSON.stringify(stored.json.state.employees.value).includes('leak-me'));
r = await put(admin, { students: { base: 0, value: [{ id: 'STU-01', name: 'Anu', email: 'anu@x.com', course: 'OCC', coursesEnrolled: ['OCC'] }, { id: 'STU-02', name: 'Bob', email: 'bob@x.com', course: 'WPB' }] } });
await put(admin, { invoices: { base: 0, value: [{ id: 'INV-1', studentId: 'STU-01' }, { id: 'INV-2', studentId: 'STU-02' }] } });
await put(admin, { materials: { base: 0, value: [{ id: 'M1', course: 'OCC' }, { id: 'M2', course: 'WPB' }] } });
await put(admin, { payroll: { base: 0, value: { selectedMonth: '2026-09', history: { '2026-09': { entries: { 'EMP-103': { net: 1 }, 'EMP-104': { net: 2 } } } } } } });

const mk = async (kind, refId, email, password) => (await admin('users', { method: 'POST', body: { action: 'set', kind, refId, email, password } }));
check('weak password rejected', (await mk('staff', 'EMP-102', 'hana@demandschool.in', 'short')).status === 400);
check('create HR login', (await mk('staff', 'EMP-102', 'hana@demandschool.in', 'HanaPass123')).status === 200);
check('create staff login', (await mk('staff', 'EMP-103', 'sam@demandschool.in', 'SamPass1234')).status === 200);
check('create sales login', (await mk('staff', 'EMP-104', 'rita@demandschool.in', 'RitaPass123')).status === 200);
check('create academics login', (await mk('staff', 'EMP-105', 'ravi@demandschool.in', 'RaviPass1234')).status === 200);
check('create student login', (await mk('student', 'STU-01', 'anu@x.com', 'AnuPass1234')).status === 200);
check('login email must match record', (await mk('staff', 'EMP-103', 'other@x.com', 'SamPass1234')).status === 400);

const login = async (email, password, kind = 'staff') => { const c = client(); const x = await c('login', { method: 'POST', body: { email, password, kind } }); return { c, x }; };

// HR
const hr = await login('hana@demandschool.in', 'HanaPass123');
check('HR logs in with access=hr', hr.x.json?.user?.access === 'hr');
r = await put(hr.c, { employees: { base: 1, value: employees.map(e => e.id === 'EMP-102' ? { ...e, role: 'CEO' } : e) } });
check('HR cannot promote self to CEO', r.status === 403, JSON.stringify(r.json));
r = await put(hr.c, { employees: { base: 1, value: [...employees, { id: 'EMP-105', name: 'X', dept: 'Marketing', role: 'Founder', email: 'x@x.com' }] } });
check('HR cannot create a Founder', r.status === 403, JSON.stringify(r.json));
r = await put(hr.c, { invoices: { base: 1, value: [] } });
check('HR cannot write finance data', r.status === 403);
r = await hr.c('users', { method: 'POST', body: { action: 'set', kind: 'staff', refId: 'EMP-101', email: ADMIN.email, password: 'Takeover12345' } });
check('HR cannot reset leadership password', r.status === 403, JSON.stringify(r.json));
r = await put(hr.c, { hrPolicy: { base: 0, value: { holidays: [] } } });
check('HR can write HR data', r.status === 200);

r = await put(hr.c, { sessionLogs: { base: 0, value: [{ id: 'SL-1', empId: 'EMP-105', status: 'Approved' }] } });
check('HR can write session logs (approvals)', r.status === 200, JSON.stringify(r.json));

// Staff
const staff = await login('sam@demandschool.in', 'SamPass1234');
const st = await staff.c('state');
const emps = st.json.state.employees.value;
check('staff sees others without salary', emps.filter(e => e.id !== 'EMP-103').every(e => e.salary === undefined));
check('staff sees own salary', emps.find(e => e.id === 'EMP-103').salary === 30000);
check('staff cannot read invoices', st.json.state.invoices === undefined);
const pay = st.json.state.payroll.value.history['2026-09'].entries;
check('staff sees only own payroll', Object.keys(pay).join() === 'EMP-103');
r = await put(staff.c, { invoices: { base: 0, value: [] } });
check('staff cannot write invoices', r.status === 403);
r = await put(staff.c, { employees: { base: 1, value: [] } });
check('staff cannot write employees', r.status === 403);
r = await put(staff.c, { leaveRequests: { base: 0, value: [{ id: 'LV-1', empId: 'EMP-103', status: 'Pending' }, { id: 'LV-9', empId: 'EMP-101', status: 'Approved' }] } });
check('staff scoped write ok, forged record dropped', r.status === 200 && r.json.results.leaveRequests.value.length === 1 && r.json.results.leaveRequests.value[0].empId === 'EMP-103', JSON.stringify(r.json));
r = await put(staff.c, { courseSettings: { base: 0, value: { OCC: { price: 1 } } } });
check('non-academics staff cannot edit course settings', r.status === 403);
const acad = await login('ravi@demandschool.in', 'RaviPass1234');
r = await put(acad.c, { courseSettings: { base: 0, value: { OCC: { price: 1, syllabus: [{ title: 'M1' }] } } } });
check('academics staff can edit course settings/syllabus', r.status === 200, JSON.stringify(r.json));
const sales = await login('rita@demandschool.in', 'RitaPass123');
r = await put(sales.c, { leaveRequests: { base: 0, value: [{ id: 'LV-1', empId: 'EMP-104', status: 'Pending' }] } });
const lv = (await admin('state')).json.state.leaveRequests.value;
check('id collision renamed; both users records kept', lv.length === 2 && new Set(lv.map(x => x.id)).size === 2, JSON.stringify(lv));
check('sales sees only own leave requests', r.json.results.leaveRequests.value.length === 1);

// Student
const stu = await login('anu@x.com', 'AnuPass1234', 'student');
check('student logs in', stu.x.json?.user?.access === 'student');
const ss = (await stu.c('state')).json.state;
check('student sees only own record', ss.students.value.length === 1 && ss.students.value[0].id === 'STU-01');
check('student sees only own invoices', ss.invoices.value.length === 1 && ss.invoices.value[0].studentId === 'STU-01');
check('student sees only own course materials', ss.materials.value.length === 1 && ss.materials.value[0].course === 'OCC');
check('student cannot see payroll / bank', ss.payroll === undefined && ss.bankAccounts === undefined);
r = await put(stu.c, { students: { base: 1, value: [] } });
check('student cannot write students', r.status === 403);
r = await put(stu.c, { studentComplaints: { base: 0, value: [{ id: 'SC-1', studentId: 'STU-02', text: 'forged' }, { id: 'SC-2', studentId: 'STU-01', text: 'mine' }] } });
check('student scoped write keeps only own', r.status === 200 && r.json.results.studentComplaints.value.length === 1);

// concurrency + tamper + lockout
const a2 = (await admin('state')).json.state.hrPolicy.version;
r = await put(admin, { hrPolicy: { base: a2 - 1, value: { holidays: [1] } } });
check('stale version -> conflict', r.json.results.hrPolicy.conflict === true);
r = await put(admin, { __proto__x: { base: 0, value: {} } });
check('unknown collection rejected', r.status === 400);
const tampered = client(); const t = await tampered('login', { method: 'POST', body: ADMIN });
const good = t.setCookie.split(';')[0]; const forged = good.slice(0, -3) + 'AAA';
const rf = await fetch(BASE + '/api/state', { headers: { Cookie: forged } });
check('tampered session cookie rejected', rf.status === 401);
let last;
for (let i = 0; i < 6; i++) last = await client()('login', { method: 'POST', body: { email: 'rita@demandschool.in', password: 'nope-nope-1' } });
check('lockout after repeated failures (429)', last.status === 429, String(last.status));
check('locked account also blocks correct password', (await client()('login', { method: 'POST', body: { email: 'rita@demandschool.in', password: 'RitaPass123' } })).status === 429);

// password change revokes sessions
const ch = await hr.c('users', { method: 'POST', body: { action: 'change-own', current: 'HanaPass123', password: 'HanaNew12345' } });
check('change own password ok', ch.status === 200);
check('old session revoked after password change', (await hr.c('state')).status === 401);

console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
