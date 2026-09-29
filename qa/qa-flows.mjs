import { chromium } from 'playwright-core';
import { execSync } from 'node:child_process';

const BASE = (process.env.BASE || 'http://127.0.0.1:3000/').replace(/\/$/, '');
const PROJECT = process.env.PROJECT || process.cwd();   // where scripts/set-password.js lives
const ADMIN = { email: 'thanseemca@gmail.com', pw: 'Demand2026!Admin' };
const PW = 'QaPassw0rd1';
const CAN_CLI = process.env.CLI !== '0';      // set-password CLI only works against the file store

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  -> ' + extra}`); if (!cond) failed++; };
const errors = [];
const IGNORE = /status of (401|404|500)|favicon|Failed to load resource|net::ERR/;

async function session(label) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(`[${label}] pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(`[${label}] console: ${m.text()}`); });
  page.on('dialog', d => { errors.push(`[${label}] UNEXPECTED DIALOG (script executed?): ${d.message()}`); d.dismiss(); });
  return { ctx, page };
}
async function login(page, tab, email, pw) {
  await page.goto(BASE + '/');
  await page.waitForSelector('#login-screen:not([hidden])');
  if (tab === 'student') await page.click('#login-tab-student');
  await page.fill(tab === 'student' ? '#login-email-student' : '#login-email', email);
  await page.fill('#login-password', pw);
  await page.click('.login-submit');
  await page.waitForSelector(tab === 'student' ? '#student-shell:not([hidden])' : '#app-shell:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(1200);
}
async function apiLogin(email, password, kind = 'staff') {
  const r = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'demand-erp' }, body: JSON.stringify({ email, password, kind }) });
  return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}
const apiState = async cookie => (await (await fetch(BASE + '/api/state', { headers: { Cookie: cookie } })).json()).state;
async function fillForm(page, sel, over = {}) {
  await page.evaluate(([sel, over]) => {
    const form = document.querySelector(sel);
    for (const el of form.querySelectorAll('input, select, textarea')) {
      const name = el.name; if (!name) continue;
      let v;
      if (name in over) v = over[name];
      else if (el.tagName === 'SELECT') continue;
      else if (el.type === 'number') v = el.min ? String(Math.max(Number(el.min), 1000)) : '30000';
      else if (el.type === 'date') { if (el.value) continue; v = '2026-09-15'; }
      else if (el.type === 'email') v = 'qa@example.com';
      else if (el.type === 'password') v = 'QaPassw0rd1';
      else if (['checkbox', 'radio', 'file'].includes(el.type)) continue;
      else { if (el.value) continue; v = 'QA ' + name; }
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }, [sel, over]);
}

/* ============ setup: admin session, make sure role logins exist ============ */
const admin = await session('admin');
await login(admin.page, 'staff', ADMIN.email, ADMIN.pw);
const ensure = await admin.page.evaluate(async pw => {
  const out = {};
  for (const id of ['EMP-104', 'EMP-115']) {
    const e = employees.find(x => x.id === id);
    try { await api('users', { method: 'POST', body: { action: 'set', kind: 'staff', refId: id, email: e.email, password: pw } }); out[id] = e.email; } catch (err) { out[id] = 'ERR ' + err.message; }
  }
  return out;
}, PW);
const TRAINER = ensure['EMP-104'], HR = ensure['EMP-115'];
console.log('trainer:', TRAINER, ' hr:', HR, '\n');

/* ============ A. add employee through the real form, then that person signs in ============ */
console.log('--- A. Add employee (with login) ---');
await admin.page.evaluate(() => { nav.module = 'hr'; nav.sub.hr = 'directory'; render(); openAddEmployee(); });
await fillForm(admin.page, '#f-add-employee', { name: 'Qa Newhire', email: 'qa.newhire@demandschool.in', password: 'NewHire12345', role: 'Video Editor', dept: 'Marketing', empType: 'Permanent', salary: '25000' });
await admin.page.click('#f-add-employee button[type=submit]');
await admin.page.waitForTimeout(3500);
let r = await apiLogin('qa.newhire@demandschool.in', 'NewHire12345');
ok('new employee can sign in with the password set in the form', r.status === 200, String(r.status));
const empRow = (await apiState((await apiLogin(ADMIN.email, ADMIN.pw)).cookie)).employees.value.find(e => e.email === 'qa.newhire@demandschool.in');
ok('employee record saved on server without any password field', !!empRow && empRow.password === undefined);
ok('wrong password for new employee rejected', (await apiLogin('qa.newhire@demandschool.in', 'wrong-pass-123')).status === 401);

/* ============ B. add student with portal password, student signs in ============ */
console.log('\n--- B. Register student (with portal login) ---');
await admin.page.evaluate(() => { nav.module = 'students'; nav.sub.students = 'all'; render(); openAddStudent(); });
await fillForm(admin.page, '#f-add-student', { name: 'Qa Learner', email: 'qa.learner@example.com', phone: '9847000000', portalPassword: 'Learner12345' });
await admin.page.click('#f-add-student button[type=submit]');
await admin.page.waitForTimeout(3500);
r = await apiLogin('qa.learner@example.com', 'Learner12345', 'student');
ok('student can sign in with the portal password set at registration', r.status === 200, String(r.status));
if (r.status === 200) {
  const st = await apiState(r.cookie);
  ok('student sees exactly their own record', st.students.value.length === 1 && st.students.value[0].email === 'qa.learner@example.com');
  const stu = await session('new-student');
  await login(stu.page, 'student', 'qa.learner@example.com', 'Learner12345');
  const who = await stu.page.evaluate(() => currentStudent.name);
  ok('student portal opens for the new student', who === 'Qa Learner', who);
  for (const t of await stu.page.evaluate(() => STUDENT_NAV.map(t => t.id))) { await stu.page.evaluate(id => setStudentTab(id), t); }
  await stu.ctx.close();
}

/* ============ C. leave request (staff) -> approval (HR) -> visible to staff ============ */
console.log('\n--- C. Leave request lifecycle across two roles ---');
const trainer = await session('trainer');
await login(trainer.page, 'staff', TRAINER, PW);
const before = await trainer.page.evaluate(() => leaveRequests.length);
await trainer.page.evaluate(() => { nav.module = 'workspace'; nav.sub.workspace = 'leave'; render(); openApplyLeave(); });
await fillForm(trainer.page, '#f-apply-leave', { reason: 'QA flow: family function' });
await trainer.page.click('#f-apply-leave button[type=submit]');
await trainer.page.waitForTimeout(2500);
const mine = await trainer.page.evaluate(() => leaveRequests.filter(l => l.reason === 'QA flow: family function'));
ok('trainer sees their new request', mine.length === 1 && mine[0].status === 'Pending', JSON.stringify(mine));
const totalOnServer = async () => (await apiState((await apiLogin(HR, PW)).cookie)).leaveRequests.value;
let all = await totalOnServer();
ok('request stored on the server alongside everyone else\'s (HR sees all)', all.length >= before + 1 && all.some(l => l.reason === 'QA flow: family function'), `count=${all.length}`);
ok('all request ids are unique', new Set(all.map(l => l.id)).size === all.length);

const hr = await session('hr');
await login(hr.page, 'staff', HR, PW);
const reqId = await hr.page.evaluate(() => leaveRequests.find(l => l.reason === 'QA flow: family function').id);
await hr.page.evaluate(id => { nav.module = 'hr'; nav.sub.hr = 'leave'; render(); decideLeave(id, 'Approved'); }, reqId);
await hr.page.waitForTimeout(2500);
all = await totalOnServer();
const decided = all.find(l => l.id === reqId);
ok('HR approval saved', decided && decided.status === 'Approved', JSON.stringify(decided));
ok('HR approval did not lose other people\'s requests', all.length >= before + 1);
await trainer.page.reload(); await trainer.page.waitForSelector('#app-shell:not([hidden])'); await trainer.page.waitForTimeout(1200);
const seen = await trainer.page.evaluate(() => (leaveRequests.find(l => l.reason === 'QA flow: family function') || {}).status);
ok('trainer sees "Approved" after reload', seen === 'Approved', String(seen));
ok('trainer only ever holds their own leave requests', await trainer.page.evaluate(() => leaveRequests.every(l => l.empId === currentUser.id)));
await hr.ctx.close();

/* ============ D. two people edit the same collection at once ============ */
console.log('\n--- D. Simultaneous edits (conflict handling) ---');
const a = await session('admin-A'), b = await session('admin-B');
await login(a.page, 'staff', ADMIN.email, ADMIN.pw);
await login(b.page, 'staff', ADMIN.email, ADMIN.pw);
const postNotice = async (p, title) => {
  await p.evaluate(() => { nav.module = 'hr'; nav.sub.hr = 'notices'; render(); openPostNotice(); });
  await fillForm(p, '#f-post-notice', { title, message: 'body' });
  await p.click('#f-post-notice button[type=submit]');
};
await postNotice(a.page, 'Notice from A');
await a.page.waitForTimeout(2000);
await postNotice(b.page, 'Notice from B (stale)');
await b.page.waitForTimeout(3500);
const bNotices = await b.page.evaluate(() => notices.map(n => n.title));
ok('stale editor sees the teammates notice AND keeps their own (merged, nothing lost)', bNotices.includes('Notice from A') && bNotices.includes('Notice from B (stale)'), JSON.stringify(bNotices));
const finalNotices = (await apiState((await apiLogin(ADMIN.email, ADMIN.pw)).cookie)).notices.value.map(n => n.title);
ok('server holds both edits, no duplicates', finalNotices.includes('Notice from A') && finalNotices.includes('Notice from B (stale)') && new Set(finalNotices).size === finalNotices.length, JSON.stringify(finalNotices));

// two people editing DIFFERENT records of the same collection while both are stale
await a.page.evaluate(() => { students[0].city = 'CityFromA'; render(); });
await a.page.waitForTimeout(2200);
await b.page.evaluate(() => { students[1].city = 'CityFromB'; render(); });
await b.page.waitForTimeout(3500);
const cities = (await apiState((await apiLogin(ADMIN.email, ADMIN.pw)).cookie)).students.value.map(s => s.city);
ok('edits to different students by two stale editors both survive', cities.includes('CityFromA') && cities.includes('CityFromB'), JSON.stringify(cities.slice(0, 3)));

// H. teammates' changes appear without a reload, but never under an open dialog
await a.page.evaluate(() => { nav.module = 'hr'; nav.sub.hr = 'notices'; render(); });
await postNotice(a.page, 'Live update notice');
await a.page.waitForTimeout(2200);
await b.page.evaluate(() => { nav.module = 'hr'; nav.sub.hr = 'notices'; render(); openPostNotice(); });
await b.page.evaluate(() => pullUpdates());
await b.page.waitForTimeout(800);
ok('background refresh does NOT run while a dialog is open', !(await b.page.evaluate(() => notices.some(n => n.title === 'Live update notice'))));
await b.page.evaluate(() => closeModal());
await b.page.evaluate(() => pullUpdates());
await b.page.waitForTimeout(800);
ok('background refresh picks up the teammates notice once idle', await b.page.evaluate(() => notices.some(n => n.title === 'Live update notice')));
await b.ctx.close();

/* ============ E. network / server failures ============ */
console.log('\n--- E. Failure handling ---');
await a.page.route('**/api/state', route => route.request().method() === 'PUT' ? route.abort() : route.continue());
await postNotice(a.page, 'Offline notice');
await a.page.waitForTimeout(2500);
const toast1 = await a.page.textContent('#toast-root').catch(() => '');
ok('offline: user is told saving failed and will retry', /Couldn.t save/.test(toast1 || ''), toast1);
await a.page.unroute('**/api/state');
await a.page.evaluate(() => queueSave());
await a.page.waitForTimeout(2500);
ok('after reconnect the offline change is saved', (await apiState((await apiLogin(ADMIN.email, ADMIN.pw)).cookie)).notices.value.some(n => n.title === 'Offline notice'));

await a.page.route('**/api/state', route => route.request().method() === 'PUT' ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Server error"}' }) : route.continue());
await postNotice(a.page, 'Server-error notice');
await a.page.waitForTimeout(2500);
await a.page.unroute('**/api/state');
await a.page.evaluate(() => queueSave());
await a.page.waitForTimeout(2500);
ok('after a 500 the change is retried and saved', (await apiState((await apiLogin(ADMIN.email, ADMIN.pw)).cookie)).notices.value.some(n => n.title === 'Server-error notice'));

/* ============ F. password reset revokes live sessions ============ */
console.log('\n--- F. Session revocation ---');
if (CAN_CLI) {
  execSync(`node scripts/set-password.js ${TRAINER} "${PW}"`, { cwd: PROJECT, stdio: 'pipe' });
  await trainer.page.evaluate(() => { nav.module = 'workspace'; nav.sub.workspace = 'leave'; render(); openApplyLeave(); });
  await fillForm(trainer.page, '#f-apply-leave', { reason: 'after revoke' });
  await trainer.page.click('#f-apply-leave button[type=submit]');
  await trainer.page.waitForSelector('#login-screen:not([hidden])', { timeout: 8000 }).then(() => ok('revoked session is sent back to the login screen', true)).catch(() => ok('revoked session is sent back to the login screen', false, 'still logged in'));
} else console.log('skipped (CLI=0)');
await trainer.ctx.close();

/* ============ G. injection attempts ============ */
console.log('\n--- G. Injection attempts ---');
await a.page.evaluate(() => { nav.module = 'hr'; nav.sub.hr = 'notices'; render(); });
await postNotice(a.page, '<img src=x onerror="window.__xss=1">');
await a.page.waitForTimeout(800);
await a.page.evaluate(() => { nav.module = 'hr'; nav.sub.hr = 'notices'; render(); });
await a.page.waitForTimeout(400);
ok('HTML in a notice title is shown as text, not executed', (await a.page.evaluate(() => window.__xss)) === undefined);
const g = await a.page.evaluate(() => {
  materials.unshift({ id: 'MAT-XSS', course: COURSES[0], title: 'evil link', type: 'Link', url: 'javascript:window.__xss2=1', addedDate: TODAY });
  nav.module = 'students'; nav.sub.students = 'materials'; nav.detail = null; render();
  const link = Array.from(document.querySelectorAll('#content a')).find(x => x.textContent.trim() || true && x.closest('tr') && x.closest('tr').textContent.includes('evil link'));
  const href = link ? link.getAttribute('href') : null;
  if (link) link.click();
  materials.shift(); render();
  return { href, executed: window.__xss2 };
});
ok('javascript: link is neutralised', g.href === '#' && g.executed === undefined, JSON.stringify(g));
const g3 = await a.page.evaluate(async () => {
  const orig = COURSES[3];
  renameCourse(orig, "Evil');window.__xss3=1;('");
  nav.module = 'students'; nav.sub.students = 'courses'; nav.detail = null; render();
  Array.from(document.querySelectorAll('#content [onclick]')).forEach(el => { try { el.click(); } catch (e) {} });
  const res = window.__xss3;
  renameCourse("Evil');window.__xss3=1;('", orig); nav.detail = null; render();
  return res;
});
ok('quote characters in a course name cannot break out of click handlers', g3 === undefined, String(g3));
await a.ctx.close();
await admin.ctx.close();

console.log('\nJS errors during all flows:', errors.length ? '\n' + [...new Set(errors)].join('\n') : 'none');
console.log(failed ? `\n${failed} FLOW CHECK(S) FAILED` : '\nAll flow checks passed');
await browser.close();
process.exit(failed ? 1 : 0);
