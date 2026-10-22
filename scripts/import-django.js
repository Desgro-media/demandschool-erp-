// Converts a Django `dumpdata` export of the old ERP into this app's collections.
//   Dry run (default):  node scripts/import-django.js live_dump.json [--out preview.json]
//   Write to storage:   node --env-file=.env.local scripts/import-django.js live_dump.json --apply
// --apply backs up the current app_state to backup-app_state-<time>.json first, then merges by id:
// records already in the app are kept, imported ones are only added. Logins are NOT imported.
import fs from 'node:fs';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const apply = args.includes('--apply');
const outIdx = args.indexOf('--out');
const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
if (!file) { console.error('Usage: node scripts/import-django.js <dump.json> [--out preview.json] [--apply]'); process.exit(1); }

const dump = JSON.parse(fs.readFileSync(file, 'utf8'));
const of = m => dump.filter(x => x.model === m);
const byPk = m => new Map(of(m).map(x => [x.pk, x]));
const f = x => x.fields;
const num = v => Number(v) || 0;
const day = v => (v ? String(v).slice(0, 10) : '');
const pad = (n, w = 2) => String(n).padStart(w, '0');
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);
const warnings = [];

/* ---------- courses & batches ---------- */
const courseRows = of('masters.course').filter(c => f(c).is_active !== false);
const courseName = new Map(courseRows.map(c => [c.pk, f(c).name]));
const COURSES = courseRows.map(c => f(c).name);
const courseSettings = {};
for (const c of courseRows) courseSettings[f(c).name] = { price: num(f(c).fees), duration: '', mode: '', description: f(c).description || '', syllabus: [] };

const plansByCourse = new Map();   // course pk -> sorted installment plan rows
for (const inst of of('masters.courseinstallment')) {
  const rows = of('masters.courseinstallmentplan').filter(p => f(p).course_installment === inst.pk)
    .sort((a, b) => f(a).installment_no - f(b).installment_no);
  const cur = plansByCourse.get(f(inst).course);
  if (!cur || rows.length > cur.length) plansByCourse.set(f(inst).course, rows);
}

const feeRows = of('admissions.feestructure');
const admissionRows = of('admissions.admission');
const batchId = b => 'BATCH-' + b.pk;
const batches = of('masters.batch').map(b => {
  const students = admissionRows.filter(a => f(a).batch === b.pk).map(a => a.pk);
  const plan = plansByCourse.get(f(b).course) || [];
  const dueFor = no => { // most common due date other students in this batch have for this installment number
    const dates = feeRows.filter(x => students.includes(f(x).student) && f(x).installment_no === no).map(x => day(f(x).due_date));
    const counts = {}; dates.forEach(d => { counts[d] = (counts[d] || 0) + 1; });
    return Object.keys(counts).sort((a, c) => counts[c] - counts[a])[0] || day(f(b).starting_date);
  };
  const installments = plan.map(p => ({ label: f(p).label || ('Installment ' + f(p).installment_no), amount: num(f(p).amount), dueDate: dueFor(f(p).installment_no) }));
  return { id: batchId(b), course: courseName.get(f(b).course) || '', label: f(b).batch_name, startDate: day(f(b).starting_date), endDate: day(f(b).ending_date) || null, schedule: { installments } };
});

/* ---------- employees ---------- */
// People who already exist in the app (matched by email) keep their current id, so nothing is duplicated
// and their leave/attendance/payroll history attaches to the right person.
const { store: liveStore } = await import('../lib/store.js');
await liveStore.init();
const liveEmployees = ((await liveStore.getState(['employees'])).find(r => r.key === 'employees') || { value: [] }).value;
const existingIdByEmail = new Map(liveEmployees.filter(e => e.email).map(e => [String(e.email).trim().toLowerCase(), e.id]));
const DEPT = { MANAGEMENT: 'Administrative', SALES: 'Sales', ACADEMIC: 'Academics', ADMINISTRATION: 'Administrative', FINANCE: 'Administrative', COMMUNICATION: 'Marketing', 'MULTI MEDIA': 'Marketing' };
const depts = byPk('employees.department'), desigs = byPk('employees.designation');
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'thanseemca@gmail.com').toLowerCase(); // already EMP-101 in the app
const emailOf = e => (f(e).official_email || f(e).personal_email || '').trim().toLowerCase();
const empId = e => existingIdByEmail.get(emailOf(e)) || (emailOf(e) === ADMIN_EMAIL ? 'EMP-101' : 'EMP-' + (200 + (parseInt(f(e).employee_id, 10) || e.pk)));
const empById = new Map(of('employees.employee').map(e => [e.pk, e]));
const empIdOf = pk => (empById.has(pk) ? empId(empById.get(pk)) : null);
const empNameOf = pk => { const e = empById.get(pk); return e ? `${f(e).first_name} ${f(e).last_name || ''}`.trim() : ''; };
const salaryHist = new Map();
for (const h of of('employees.employeesalaryhistory')) {
  const a = salaryHist.get(f(h).employee) || []; a.push(h); salaryHist.set(f(h).employee, a);
}
const employees = of('employees.employee').filter(e => !existingIdByEmail.has(emailOf(e))).map(e => {
  const x = f(e);
  const hist = (salaryHist.get(e.pk) || []).sort((a, b) => day(f(a).effective_date).localeCompare(day(f(b).effective_date)))
    .map(h => ({ amount: num(f(h).basic_salary) + num(f(h).hra) + num(f(h).other_allowance) + num(f(h).transportation_allowance), effectiveDate: day(f(h).effective_date), note: f(h).reason || '' }));
  const salary = num(x.basic_salary) + num(x.hra) + num(x.other_allowance) + num(x.transportation_allowance) || (hist.length ? hist[hist.length - 1].amount : 0);
  const dname = depts.get(x.department) ? f(depts.get(x.department)).name : '';
  const rec = {
    id: empId(e), name: `${x.first_name} ${x.last_name || ''}`.trim(),
    dept: DEPT[dname.toUpperCase()] || 'Administrative', role: desigs.get(x.designation) ? f(desigs.get(x.designation)).name : '',
    joined: day(x.date_of_joining) || day(x.date_of_confirmation) || day(x.created),
    dob: day(x.date_of_birth) || undefined, email: (x.official_email || x.personal_email || '').toLowerCase(), phone: x.mobile || x.whatsapp || '',
    salary, empType: x.employment_type === 'TEMPORARY' ? 'Probation' : 'Permanent',
    employmentStatus: x.status === 'Resigned' ? 'Left' : 'Active',
  };
  if (hist.length) rec.salaryHistory = hist;
  if (x.status === 'Resigned') rec.leavingDate = day(x.resigned_date || x.termination_date);
  return rec;
});

/* ---------- leave, advances, attendance ---------- */
const DUR = { full_day: 'Full Day', half_day: 'Half Day', quarter_day: 'Quarter Day' };
const leaveRequests = of('employees.employeeleaverequest').map(l => {
  const x = f(l), from = day(x.start_date), to = day(x.end_date) || from;
  let days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  if (from === to && x.leave_day_type === 'half_day') days = 0.5;
  if (from === to && x.leave_day_type === 'quarter_day') days = 0.25;
  return { id: 'LR-D' + l.pk, empId: empIdOf(x.employee), type: /wfh/.test(x.leave_type) ? 'WFH' : 'Casual/Sick', duration: from === to ? (DUR[x.leave_day_type] || 'Full Day') : 'Full Day', from, to, days, reason: x.reason || '', status: cap(x.status), applied: day(x.created) };
}).filter(l => l.empId).sort((a, b) => b.applied.localeCompare(a.applied));

// Django links an advance payment to the employee (and a payroll month), not to one request, so spread each
// employee's payments over their PAID requests oldest-first, never more than a request's amount. (Attaching
// every payment to every request counted the same money repeatedly.)
const advPaid = new Map();
for (const p of of('employees.advancesalarypayment')) { const a = advPaid.get(f(p).employee) || []; a.push(p); advPaid.set(f(p).employee, a); }
for (const a of advPaid.values()) a.sort((p, q) => day(f(p).payment_date).localeCompare(day(f(q).payment_date)));
const advLeft = new Map([...advPaid].map(([emp, ps]) => [emp, ps.map(p => ({ amount: num(f(p).amount_paid), date: day(f(p).payment_date), note: f(p).remarks || 'Advance paid' }))]));
const advances = of('employees.advancesalaryrequest').slice().sort((a, b) => day(f(a).created).localeCompare(day(f(b).created))).map(a => {
  const x = f(a);
  const rec = { id: 'ADV-D' + a.pk, empId: empIdOf(x.employee), amount: num(x.requested_amount), reason: x.reason || '', requested: day(x.created), status: cap(x.status), payments: [] };
  if (x.status === 'PAID') {
    const queue = advLeft.get(x.employee) || [];
    let need = rec.amount;
    while (need > 0 && queue.length) {
      const take = Math.min(need, queue[0].amount);
      rec.payments.push({ ...queue[0], amount: take });
      need -= take; queue[0].amount -= take;
      if (queue[0].amount <= 0) queue.shift();
    }
  }
  return rec;
}).filter(a => a.empId);

const ATT = { present: 'present', work_from_home: 'wfh', absent: 'absent', late: 'late', half_day: 'half', leave: 'leave' };
const attendanceByDate = {};
for (const r of of('employees.employeeattendanceregister')) {
  const id = empIdOf(f(r).employee), d = day(f(r).date);
  if (!id || !d) continue;
  (attendanceByDate[d] = attendanceByDate[d] || {})[id] = { status: ATT[f(r).status] || 'present', in: null };
}

/* ---------- payroll ---------- */
const payroll = { selectedMonth: new Date().toISOString().slice(0, 7), history: {} };
const payPay = new Map();
for (const p of of('employees.payrollpayment')) { const a = payPay.get(f(p).payroll) || []; a.push(p); payPay.set(f(p).payroll, a); }
for (const p of of('employees.payroll')) {
  const x = f(p), id = empIdOf(x.employee), month = `${x.payroll_year}-${pad(x.payroll_month)}`;
  if (!id) continue;
  const h = (payroll.history[month] = payroll.history[month] || { entries: {} });
  h.entries[id] = { gross: num(x.gross_salary), netOverride: num(x.net_salary), payments: (payPay.get(p.pk) || []).map(q => ({ amount: num(f(q).amount_paid), date: day(f(q).payment_date), note: f(q).remarks || 'Salary payment' })) };
}

/* ---------- students & invoices ---------- */
const sales = pk => empNameOf(pk) || '';
const receiptsByStudent = new Map();
const methods = of('admissions.paymentmethod');
for (const r of of('admissions.feereceipt')) {
  const amt = methods.filter(m => f(m).fee_receipt === r.pk).reduce((s, m) => s + num(f(m).amount), 0);
  const a = receiptsByStudent.get(f(r).student) || []; a.push({ amount: amt, date: day(f(r).date), note: f(r).note || cap(f(r).fee_type) + ' fee', approved: f(r).approval_status === 'approved' });
  receiptsByStudent.set(f(r).student, a);
}
const stuAtt = new Map();
for (const a of of('admissions.studentattendance')) { const l = stuAtt.get(f(a).student) || []; l.push({ date: day(f(a).date), status: cap(f(a).status) }); stuAtt.set(f(a).student, l); }

const students = [], invoices = [];
let invSeq = 1000;
for (const a of admissionRows) {
  const x = f(a), id = 'STU-' + pad(a.pk);
  const course = courseName.get(x.course) || '';
  students.push({ id, name: x.full_name, phone: x.contact_number || '', email: (x.personal_email || '').toLowerCase(), course, batch: x.batch ? 'BATCH-' + x.batch : '', batchId: x.batch ? 'BATCH-' + x.batch : '', city: x.city || '', coursesEnrolled: course ? [course] : [], status: 'Active', onboarded: day(x.joining_date) || day(x.admission_date), counsellor: '', salesPerson: sales(x.sales_person), attendance: (stuAtt.get(a.pk) || []).sort((p, q) => p.date.localeCompare(q.date)) });
  const fees = feeRows.filter(r => f(r).student === a.pk).sort((p, q) => f(p).installment_no - f(q).installment_no);
  const receipts = (receiptsByStudent.get(a.pk) || []).sort((p, q) => p.date.localeCompare(q.date));
  const approved = receipts.filter(r => r.approved).map(r => ({ ...r })), pending = receipts.filter(r => !r.approved);
  const mine = fees.map(r => {
    const seq = ++invSeq;
    return { id: 'INV-' + seq, studentId: id, items: [{ dept: course, amount: num(f(r).amount) }], invoiceNo: 'DS-2026-' + seq, issued: day(f(r).created), due: day(f(r).due_date), payments: [], scheduleLabel: f(r).name };
  });
  for (const inv of mine) { // apply approved receipts first-in-first-out against the installments
    let owed = inv.items[0].amount;
    while (owed > 0 && approved.length) {
      const r = approved[0], take = Math.min(owed, r.amount);
      if (take > 0) inv.payments.push({ amount: take, date: r.date, note: r.note });
      owed -= take; r.amount -= take;
      if (r.amount <= 0) approved.shift();
    }
  }
  for (const r of approved.filter(r => r.amount > 0)) { // money received with no installment left to apply it to
    const seq = ++invSeq;
    mine.push({ id: 'INV-' + seq, studentId: id, items: [{ dept: course, amount: r.amount }], invoiceNo: 'DS-2026-' + seq, issued: r.date, due: r.date, payments: [{ amount: r.amount, date: r.date, note: r.note }], scheduleLabel: r.note });
  }
  for (const r of pending) { // unapproved receipts wait for Finance, on the first installment still unpaid
    const inv = mine.find(i => i.payments.reduce((s, p) => s + p.amount, 0) < i.items[0].amount);
    if (inv) (inv.pendingPayments = inv.pendingPayments || []).push({ amount: r.amount, date: r.date, note: r.note, approved: false });
  }
  invoices.push(...mine);
}

/* ---------- leads & content ---------- */
const sources = byPk('leads.leadsource'), statuses = byPk('leads.leadstatus');
const SRC = { meta: 'Meta', organic: 'Organic', website: 'Organic', instagram: 'Instagram', whatsapp: 'WhatsApp' };
const marketingLeads = of('leads.lead').map(l => {
  const x = f(l), s = sources.get(x.source) ? f(sources.get(x.source)).name.toLowerCase() : '';
  return { id: 'MLD-' + pad(l.pk), name: x.full_name, phone: x.phone || '', email: x.email || '', source: SRC[s] || 'Organic', courseInterested: x.course ? courseName.get(x.course) || '' : '', leadOwner: x.assigned_to ? (empNameOf(x.assigned_to) || null) : null, createdDate: day(x.created), status: statuses.get(x.status) ? cap(f(statuses.get(x.status)).name) : undefined, remarks: x.remarks || undefined };
});
const STAGE = { idea: 'Idea', scripting: 'Scripting', production: 'Production', graphic: 'Production', edit: 'Review', review: 'Review', scheduled: 'Scheduled', published: 'Published' };
const contentItems = of('marketing.contentitem').map((c, i) => {
  const x = f(c);
  return { id: 1000 + c.pk, title: x.title, type: cap(x.content_type), stage: STAGE[x.stage] || 'Idea', assignee: empNameOf(x.assignee), due: day(x.due_date), notes: x.notes || '', platforms: (x.platforms || '').split(',').map(s => s.trim()).filter(Boolean).map(cap).map(s => s === 'Linkedin' ? 'LinkedIn' : s) };
});

/* ---------- result ---------- */
const result = { COURSES, courseSettings, batches, employees, leaveRequests, advances, attendanceByDate, payroll, students, invoices, marketingLeads, contentItems };
const summary = Object.fromEntries(Object.entries(result).map(([k, v]) => [k, Array.isArray(v) ? v.length : Object.keys(v.history || v).length]));
console.log('Converted:', summary);
if (warnings.length) console.log('Warnings:\n  ' + warnings.join('\n  '));
if (outFile) { fs.writeFileSync(outFile, JSON.stringify(result, null, 1)); console.log('Preview written to', outFile); }

if (!apply) { console.log('\nDry run only. Nothing was written. Re-run with --apply to save.'); process.exit(0); }

const { store, storeKind } = await import('../lib/store.js');
await store.init();
const rows = await store.getState();
const backup = `backup-app_state-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
fs.writeFileSync(backup, JSON.stringify(rows, null, 1));
console.log(`Backed up ${rows.length} existing collections to ${backup} (storage: ${await storeKind()})`);
const cur = new Map(rows.map(r => [r.key, r]));
const idOf = r => (r && typeof r === 'object' ? r.id : r);
for (const [key, incoming] of Object.entries(result)) {
  const row = cur.get(key), existing = row ? row.value : null;
  let value;
  if (Array.isArray(incoming)) {
    const old = Array.isArray(existing) ? existing : [];
    const have = new Set(old.map(idOf));
    value = [...old, ...incoming.filter(r => !have.has(idOf(r)))];
    // Re-runs repair advances imported earlier (they used to carry duplicated payments); app-created ones are untouched.
    if (key === 'advances') { const fresh = new Map(incoming.map(r => [r.id, r])); value = value.map(r => (r && /^ADV-D/.test(r.id) && fresh.has(r.id)) ? { ...r, payments: fresh.get(r.id).payments } : r); }
  } else if (key === 'attendanceByDate') {
    value = { ...(existing || {}) };
    for (const [d, rec] of Object.entries(incoming)) value[d] = { ...rec, ...(value[d] || {}) };
  } else if (key === 'payroll') {
    value = { selectedMonth: (existing && existing.selectedMonth) || incoming.selectedMonth, history: { ...(existing && existing.history || {}) } };
    for (const [m, h] of Object.entries(incoming.history)) {
      const cur = (value.history[m] || {}).entries || {}, entries = { ...h.entries, ...cur };
      // Entries imported before netOverride existed get it now; everything else HR/Finance edited stays as it is.
      for (const [id, e] of Object.entries(cur)) if (e.netOverride == null && h.entries[id]) entries[id] = { ...e, netOverride: h.entries[id].netOverride };
      value.history[m] = { ...(value.history[m] || {}), entries };
    }
  } else value = { ...incoming, ...(existing || {}) };
  const ver = await store.setState(key, value, row ? row.version : 0, null);
  if (ver == null) { console.error(`Skipped ${key}: changed while importing, re-run`); continue; }
  console.log(`  saved ${key}`);
}
console.log('Done.');
process.exit(0);
