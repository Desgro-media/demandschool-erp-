// Server-side authorization. The browser UI hides modules by role, but that is cosmetic — this is the
// layer that actually decides which collections a signed-in user may read/write, and which records
// inside a collection are theirs. Roles mirror the client's helpers (isHRRole / isLeadershipRole / ...).

const HR = ['employees', 'attendanceByDate', 'monthPresentDays', 'hrPolicy', 'leaveRequests', 'advances',
  'paymentRequests', 'withdrawalRequests', 'openPositions', 'candidates', 'complaints', 'notices', 'payroll', 'leavePayPolicy'];
const ACAD = ['COURSES', 'courseSettings', 'students', 'studentComplaints', 'batches', 'sessionLogs', 'materials',
  'assignments', 'submissions', 'studentTasks'];
const MKT = ['contentItems', 'metaAdsCampaigns', 'marketingLeads', 'quotes'];
const FIN = ['invoices', 'payables', 'commissionWithdrawals', 'expenses', 'bankAccounts', 'bankTransactions',
  'chartOfAccounts', 'journalEntries'];

export const ALL_KEYS = [...HR, ...ACAD, ...MKT, ...FIN];
export const ARRAY_KEYS = new Set(['COURSES', 'employees', 'leaveRequests', 'advances', 'paymentRequests', 'withdrawalRequests',
  'openPositions', 'candidates', 'complaints', 'notices', 'students', 'studentComplaints', 'batches', 'sessionLogs',
  'materials', 'assignments', 'submissions', 'contentItems', 'metaAdsCampaigns', 'marketingLeads', 'quotes',
  'studentTasks', 'invoices', 'payables', 'commissionWithdrawals', 'expenses', 'bankAccounts', 'bankTransactions',
  'chartOfAccounts', 'journalEntries']);

const LEADERSHIP_RE = /\b(CEO|COO|CMO|CTO|CFO|Chief|Founder)\b/i;
// An employee's `access` field (chosen in HR > Edit employee) overrides the role/department guess.
// marketing and academics share the staff data rules; they differ only in which modules the UI shows.
export const ACCESS_PRESETS = { leadership: 'leadership', hr: 'hr', finance: 'finance', sales: 'sales', marketing: 'staff', academics: 'staff', staff: 'staff' };
export const isLeadershipEmp = e => !!e && (ACCESS_PRESETS[e.access] ? e.access === 'leadership' : LEADERSHIP_RE.test(e.role || ''));

// Which records belong to whom, for collections a role may touch only in part.
//   field: property that names the owner; by: which identity it is compared with
const OWN = {
  leaveRequests: { field: 'empId', by: 'empId' },
  advances: { field: 'empId', by: 'empId' },
  paymentRequests: { field: 'empId', by: 'empId' },
  withdrawalRequests: { field: 'empId', by: 'empId' },
  commissionWithdrawals: { field: 'empId', by: 'empId' },
  sessionLogs: { field: 'empId', by: 'empId' },
  complaints: { field: '_o', by: 'empId', stamp: true },        // staff can file, but never read others'
  payables: { field: 'salesPerson', by: 'name', readOnly: true }, // sales sees only their own commission rows
  submissions: { field: 'studentId', by: 'studentId' },
  studentComplaints: { field: 'studentId', by: 'studentId' },
  invoices: { field: 'studentId', by: 'studentId', readOnly: true },
  students: { field: 'id', by: 'studentId', readOnly: true },
};

const hrShared = ['hrPolicy', 'notices', 'leavePayPolicy', 'employees', 'attendanceByDate', 'monthPresentDays', 'payroll'];
const hrOwn = ['leaveRequests', 'advances', 'paymentRequests', 'withdrawalRequests', 'complaints'];

const RULES = {
  leadership: { read: ALL_KEYS, write: ALL_KEYS, scoped: [] },
  hr: { read: [...HR, 'sessionLogs', 'COURSES', 'courseSettings'], write: [...HR, 'sessionLogs'], scoped: [] },   // HR approves session logs
  sales: {
    read: [...ACAD, 'contentItems', 'metaAdsCampaigns', 'marketingLeads', 'quotes', 'invoices', 'payables',
      'commissionWithdrawals', ...hrShared, ...hrOwn],
    write: ['students', 'studentTasks', 'studentComplaints', 'marketingLeads', 'quotes', 'invoices', 'contentItems', 'metaAdsCampaigns'],
    scoped: ['leaveRequests', 'advances', 'paymentRequests', 'withdrawalRequests', 'commissionWithdrawals', 'complaints'],
    filter: ['leaveRequests', 'advances', 'paymentRequests', 'withdrawalRequests', 'commissionWithdrawals', 'complaints', 'payables', 'sessionLogs'],
  },
  // Finance runs Accounts: the money collections, plus the people/payment data payroll needs.
  finance: {
    read: [...FIN, 'students', 'batches', 'COURSES', 'courseSettings', 'marketingLeads', 'quotes', 'studentTasks', ...hrShared,
      'advances', 'paymentRequests', 'withdrawalRequests', 'leaveRequests', 'complaints'],
    write: [...FIN, 'quotes', 'payroll', 'advances', 'paymentRequests', 'withdrawalRequests'],
    scoped: ['leaveRequests', 'complaints'],
    filter: ['leaveRequests', 'complaints'],
  },
  staff: {
    read: [...ACAD, 'contentItems', 'metaAdsCampaigns', 'marketingLeads', ...hrShared, ...hrOwn],
    write: ['students', 'studentTasks', 'studentComplaints', 'batches', 'materials', 'assignments', 'submissions', 'contentItems',
      'metaAdsCampaigns', 'marketingLeads'],
    scoped: ['leaveRequests', 'advances', 'paymentRequests', 'withdrawalRequests', 'sessionLogs', 'complaints'],
    filter: ['leaveRequests', 'advances', 'paymentRequests', 'withdrawalRequests', 'sessionLogs', 'complaints'],
  },
  student: {
    read: ['students', 'batches', 'materials', 'assignments', 'submissions', 'invoices', 'studentComplaints',
      'employees', 'courseSettings', 'COURSES'],
    write: [],
    scoped: ['submissions', 'studentComplaints'],
    filter: ['students', 'submissions', 'studentComplaints', 'invoices'],
  },
};

// Module checkboxes (HR > Edit employee > "Modules they can access"). An employee with a `modules` array gets the
// union of the data rules of every ticked module, on top of the basics everyone has (own leave, advances, etc.).
//   hr · marketing · students (Academics) · accounts · content (content pipeline only, instead of full Marketing)
export const MODULE_KEYS = ['hr', 'marketing', 'students', 'accounts', 'content'];
const OWN_KEYS = ['leaveRequests', 'advances', 'paymentRequests', 'withdrawalRequests', 'complaints', 'sessionLogs'];
export function customRules(modules) {
  const m = new Set((modules || []).filter(x => MODULE_KEYS.includes(x)));
  const read = new Set([...hrShared, ...hrOwn]), write = new Set();
  const add = (set, keys) => keys.forEach(k => set.add(k));
  if (m.has('hr')) { add(read, [...HR, 'sessionLogs', 'COURSES', 'courseSettings']); add(write, [...HR, 'sessionLogs']); }
  if (m.has('marketing')) { add(read, ['contentItems', 'metaAdsCampaigns', 'marketingLeads', 'quotes']); add(write, ['contentItems', 'metaAdsCampaigns', 'marketingLeads', 'quotes']); }
  else if (m.has('content')) { add(read, ['contentItems']); add(write, ['contentItems']); }
  if (m.has('students')) { add(read, [...ACAD, 'marketingLeads']); add(write, ['students', 'studentTasks', 'studentComplaints', 'batches', 'materials', 'assignments', 'submissions']); }
  if (m.has('accounts')) {
    add(read, [...FIN, 'students', 'batches', 'COURSES', 'courseSettings', 'marketingLeads', 'quotes', 'studentTasks', 'advances', 'paymentRequests', 'withdrawalRequests']);
    add(write, [...FIN, 'quotes', 'payroll', 'advances', 'paymentRequests', 'withdrawalRequests']);
  }
  // Anyone who can't see everyone's leave/advance/etc. only ever sees (and writes) their own rows.
  const fullView = new Set([...(m.has('hr') ? OWN_KEYS : []), ...(m.has('accounts') ? ['advances', 'paymentRequests', 'withdrawalRequests'] : [])]);
  const scoped = OWN_KEYS.filter(k => !write.has(k));
  const filter = OWN_KEYS.filter(k => !fullView.has(k));
  return { read: [...read], write: [...write], scoped, filter, modules: [...m], seeAll: m.has('hr') || m.has('accounts') };
}
const rulesOf = who => who.rules || RULES[who.access];

/** Figures out what a signed-in user is. `employees` is the stored employee list (may be empty). */
export function resolveAccess(user, employees) {
  if (!user || user.disabled) return null;
  if (user.kind === 'student') return { access: 'student', studentId: user.ref_id, empId: null, name: null };
  const emp = (employees || []).find(e => e.id === user.ref_id) || null;
  if (emp && emp.employmentStatus === 'Left') return null;
  let access, rules = null;
  if (user.bootstrap === 'leadership') access = 'leadership';
  else if (!emp) return null;
  else if (emp.access === 'leadership') access = 'leadership';
  else if (Array.isArray(emp.modules)) { access = 'custom'; rules = customRules(emp.modules); }
  else if (ACCESS_PRESETS[emp.access]) access = ACCESS_PRESETS[emp.access];
  else if (/HR/i.test(emp.role || '')) access = 'hr';
  else if (isLeadershipEmp(emp)) access = 'leadership';
  else if (emp.dept === 'Sales') access = 'sales';
  else access = 'staff';
  return { access, rules, empId: user.ref_id, name: emp ? emp.name : null, studentId: null, emp };
}

export const canRead = (who, key) => rulesOf(who).read.includes(key);
export function writeMode(who, key) {
  const r = rulesOf(who);
  if (r.write.includes(key)) return 'full';
  // Course catalogue, pricing and syllabus are maintained by the Academics team.
  if ((key === 'COURSES' || key === 'courseSettings') && who.emp && who.emp.dept === 'Academics' && (who.access === 'staff' || who.access === 'sales' || (who.access === 'custom' && who.rules.modules.includes('students')))) return 'full';
  if (r.scoped.includes(key) && OWN[key] && !OWN[key].readOnly) return 'scoped';
  return null;
}

export const writableKeys = who => ALL_KEYS.filter(k => writeMode(who, k));
export const readableKeys = who => ALL_KEYS.filter(k => canRead(who, k));
const identity = (who, by) => (by === 'empId' ? who.empId : by === 'name' ? who.name : who.studentId);

const publicEmployee = e => ({ id: e.id, name: e.name, dept: e.dept, role: e.role, empType: e.empType, course: e.course,
  employmentStatus: e.employmentStatus, joined: e.joined });
const stripSecrets = e => { const { password, ...rest } = e; return rest; };

/** The view of a stored collection that this user is allowed to see. */
export function readView(who, key, value, ctx = {}) {
  if (who.access === 'leadership') return key === 'employees' ? value.map(stripSecrets) : value;
  if (who.access === 'hr' && key !== 'employees') return value;
  if (who.access === 'finance' && key !== 'employees' && !RULES.finance.filter.includes(key)) return value;
  if (who.access === 'custom' && who.rules.seeAll && key !== 'employees' && !who.rules.filter.includes(key)) return value;
  switch (key) {
    case 'employees':
      if (who.access === 'hr' || who.access === 'finance' || (who.access === 'custom' && who.rules.seeAll)) return value.map(stripSecrets);
      return value.map(e => (e.id === who.empId ? stripSecrets(e) : publicEmployee(e)));
    case 'payroll': {
      const out = { ...value, history: {} };
      for (const [m, h] of Object.entries(value.history || {})) {
        const mine = h.entries && h.entries[who.empId];
        out.history[m] = { ...h, entries: mine ? { [who.empId]: mine } : {} };
      }
      return out;
    }
    case 'attendanceByDate': {
      const out = {};
      for (const [d, rec] of Object.entries(value)) out[d] = rec && rec[who.empId] ? { [who.empId]: rec[who.empId] } : {};
      return out;
    }
    case 'monthPresentDays':
      return who.empId in value ? { [who.empId]: value[who.empId] } : {};
    case 'materials':
    case 'assignments':
      if (who.access === 'student') return value.filter(x => ctx.courses && ctx.courses.has(x.course));
      return value;
    default:
  }
  const own = OWN[key];
  if (own && (rulesOf(who).filter || []).includes(key)) {
    const me = identity(who, own.by);
    return value.filter(r => r && me != null && r[own.field] === me);
  }
  return value;
}

export function studentCourses(who, students) {
  const s = (students || []).find(x => x.id === who.studentId);
  const set = new Set();
  if (s) { if (s.course) set.add(s.course); (s.coursesEnrolled || []).forEach(c => set.add(c)); }
  return set;
}

/**
 * Applies a user's write to the stored collection. For full-write roles the value replaces the
 * collection; for scoped roles only that user's own records are replaced, everything else is preserved.
 * Returns { value, merged } — merged=true means the caller should re-read the view.
 */
export function applyWrite(who, key, incoming, existing) {
  const mode = writeMode(who, key);
  if (mode === 'full') {
    if (key === 'employees') guardEmployeeWrite(who, incoming, existing || []);
    return { value: incoming, merged: false };
  }
  const own = OWN[key];
  const me = identity(who, own.by);
  const cur = Array.isArray(existing) ? existing : [];
  const others = cur.filter(r => !(r && r[own.field] === me));
  const used = new Set(others.map(r => r && r.id));
  const mine = [];
  for (const r of incoming) {
    if (!r || typeof r !== 'object') continue;
    if (own.stamp && r[own.field] == null) r[own.field] = me;
    if (r[own.field] !== me) continue;                       // can't write records for someone else
    if (r.id != null && used.has(r.id)) r.id = `${r.id}-${Math.random().toString(36).slice(2, 6)}`;
    if (r.id != null) used.add(r.id);
    mine.push(r);
  }
  return { value: [...mine, ...others], merged: true };
}

// HR may manage staff records but must not be able to promote anyone (including themselves) to leadership
// or change their own role/department — that would turn HR write access into full admin.
function guardEmployeeWrite(who, incoming, existing) {
  if (who.access === 'leadership') return;
  const byId = new Map(existing.map(e => [e.id, e]));
  for (const e of incoming) {
    const old = byId.get(e.id);
    const roleChanged = !old || old.role !== e.role || old.dept !== e.dept || (old.access || '') !== (e.access || '') || JSON.stringify(old.modules || null) !== JSON.stringify(e.modules || null);
    if (roleChanged && isLeadershipEmp(e)) throw httpError(403, 'Only leadership can assign a leadership role');
    // Money access is leadership's call: HR can't hand out (or take away) the Accounts module.
    const hadAccounts = !!old && Array.isArray(old.modules) && old.modules.includes('accounts');
    const hasAccounts = Array.isArray(e.modules) && e.modules.includes('accounts');
    if (hadAccounts !== hasAccounts) throw httpError(403, 'Only leadership can grant or remove Accounts access');
    if (old && e.id === who.empId && roleChanged) throw httpError(403, 'You cannot change your own role');
    if (old && isLeadershipEmp(old) && (old.role !== e.role || (old.access || '') !== (e.access || '') || e.employmentStatus !== old.employmentStatus))
      throw httpError(403, 'Only leadership can modify a leadership account');
  }
  for (const old of existing) {
    if (isLeadershipEmp(old) && !incoming.some(e => e.id === old.id)) throw httpError(403, 'Only leadership can remove a leadership account');
    if (old.id === who.empId && !incoming.some(e => e.id === old.id)) throw httpError(403, 'You cannot delete your own account');
  }
}

export function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

// Who may manage staff/student logins and delete employees: HR, leadership, or anyone given the HR module.
export const canManageStaff = who => who.access === 'leadership' || who.access === 'hr' || (who.access === 'custom' && who.rules.modules.includes('hr'));
export const canManageStudents = who => ['leadership', 'sales', 'staff'].includes(who.access) || (who.access === 'custom' && who.rules.modules.includes('students'));
