// Visits every screen for every role, clicks every non-destructive control, submits any modal form that is
// valid as-is, and reports JavaScript errors together with the control that caused them.
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:3000/';
const CAP = Number(process.env.CAP || 60);
const ADMIN = { email: 'thanseemca@gmail.com', pw: 'Demand2026!Admin' };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });

const findings = [];           // {role, view, control, errors}
const pageErrors = [];         // async errors that escaped attribution
const IGNORE = /status of (401|404)|favicon/;

async function newSession(role) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', e => pageErrors.push(`[${role}] ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) pageErrors.push(`[${role}] console: ${m.text()}`); });
  ctx.on('page', p => {   // print/download popups
    p.on('pageerror', e => pageErrors.push(`[${role}/popup] ${e.message}`));
    p.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) pageErrors.push(`[${role}/popup] console: ${m.text()}`); });
  });
  await page.addInitScript(() => {
    window.__errs = [];
    window.addEventListener('error', e => window.__errs.push('error: ' + e.message));
    window.addEventListener('unhandledrejection', e => window.__errs.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
    const ce = console.error; console.error = (...a) => { window.__errs.push('console.error: ' + a.join(' ')); ce.apply(console, a); };
  });
  return { ctx, page };
}

async function login(page, tab, email, pw) {
  await page.goto(BASE);
  await page.waitForSelector('#login-screen:not([hidden])');
  if (tab === 'student') await page.click('#login-tab-student');
  await page.fill(tab === 'student' ? '#login-email-student' : '#login-email', email);
  await page.fill('#login-password', pw);
  await page.click('.login-submit');
  await page.waitForSelector(tab === 'student' ? '#student-shell:not([hidden])' : '#app-shell:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(1500);
}

// runs inside the page: clicks controls of one view, returns [{control, errs}]
const crawlInPage = async ({ kind, mod, sub, tab, cap }) => {
  const out = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const setup = () => {
    if (kind === 'student') { studentTab = tab; renderStudentPortal(); }
    else { nav.module = mod; if (sub) nav.sub[mod] = sub; nav.detail = null; render(); }
  };
  const list = () => Array.from(document.querySelectorAll(kind === 'student' ? '#student-content [onclick]' : '#content [onclick]'));
  setup();
  const total = list().length;
  const emptyView = (document.getElementById(kind === 'student' ? 'student-content' : 'content').innerHTML.trim().length === 0);
  if (emptyView) out.push({ control: '(view rendered empty)', errs: ['empty view'] });
  const n = Math.min(total, cap);
  for (let i = 0; i < n; i++) {
    setup();
    const el = list()[i];
    if (!el) break;
    const code = el.getAttribute('onclick') || '';
    if (/logout|signOut|delete|remove|Delete|Remove/.test(code)) continue;
    const before = window.__errs.length;
    try { el.click(); } catch (e) { window.__errs.push('click threw: ' + e.message); }
    await sleep(25);
    const ov = document.getElementById('overlay');
    if (ov && !ov.hidden) {
      const form = ov.querySelector('form');
      if (form && form.checkValidity()) { try { form.requestSubmit(); } catch (e) { window.__errs.push('submit threw: ' + e.message); } await sleep(40); }
      closeModal();
    }
    if (window.__errs.length > before) out.push({ control: code.slice(0, 90), errs: window.__errs.slice(before) });
  }
  return { out, total };
};

async function crawlRole(role, page, kind) {
  let views = 0, clicks = 0;
  if (kind === 'student') {
    const tabs = await page.evaluate(() => STUDENT_NAV.map(t => t.id));
    for (const tab of tabs) {
      const r = await page.evaluate(crawlInPage, { kind: 'student', tab, cap: CAP });
      views++; clicks += r.total;
      for (const f of r.out) findings.push({ role, view: 'student:' + tab, control: f.control, errors: f.errs });
    }
  } else {
    const mods = await page.evaluate(() => visibleModules().map(m => ({ id: m.id, subs: (m.sub || []).map(s => s.id) })));
    for (const m of mods) {
      for (const sub of (m.subs.length ? m.subs : [null])) {
        const r = await page.evaluate(crawlInPage, { kind: 'staff', mod: m.id, sub, cap: CAP });
        views++; clicks += r.total;
        for (const f of r.out) findings.push({ role, view: `${m.id}/${sub}`, control: f.control, errors: f.errs });
      }
    }
    const search = await page.$('#global-search');
    if (search) { await search.fill('a'); await page.waitForTimeout(200); await search.fill(''); }
  }
  console.log(`${role.padEnd(22)} views=${String(views).padStart(2)}  controls seen=${String(clicks).padStart(4)}`);
}

/* ---------- admin first: uploads the sample data, then create a login per role ---------- */
const adminS = await newSession('admin');
await login(adminS.page, 'staff', ADMIN.email, ADMIN.pw);
await crawlRole('admin (leadership)', adminS.page, 'staff');

const PW = 'QaPassw0rd1';
const targets = [
  ['hr', 'EMP-115'], ['sales', 'EMP-108'], ['marketing staff', 'EMP-110'], ['trainer', 'EMP-104'],
  ['academic head', 'EMP-103'], ['guest trainer', 'EMP-117'], ['ops manager', 'EMP-102'],
];
const made = await adminS.page.evaluate(async ([targets, pw]) => {
  const res = {};
  for (const [name, id] of targets) {
    const e = employees.find(x => x.id === id);
    try { await api('users', { method: 'POST', body: { action: 'set', kind: 'staff', refId: id, email: e.email, password: pw } }); res[name] = e.email; }
    catch (err) { res[name] = 'ERR ' + err.message; }
  }
  // one seeded student gets an email so it can sign in
  const s0 = students[0]; s0.email = 'qa.student@example.com'; render(); await saveNow();
  try { await api('users', { method: 'POST', body: { action: 'set', kind: 'student', refId: s0.id, email: s0.email, password: pw } }); res.student = s0.email; }
  catch (err) { res.student = 'ERR ' + err.message; }
  return res;
}, [targets, PW]);
console.log('logins created:', JSON.stringify(made));
await adminS.ctx.close();

for (const [name] of targets) {
  const email = made[name];
  if (!email || email.startsWith('ERR')) { findings.push({ role: name, view: 'login-setup', control: '', errors: [String(email)] }); continue; }
  const s = await newSession(name);
  try {
    await login(s.page, 'staff', email, PW);
    await crawlRole(name, s.page, 'staff');
  } catch (e) { findings.push({ role: name, view: 'login', control: '', errors: [e.message] }); }
  await s.ctx.close();
}
if (made.student && !made.student.startsWith('ERR')) {
  const s = await newSession('student');
  try { await login(s.page, 'student', made.student, PW); await crawlRole('student', s.page, 'student'); }
  catch (e) { findings.push({ role: 'student', view: 'login', control: '', errors: [e.message] }); }
  await s.ctx.close();
}

console.log('\n=== FINDINGS (errors attributed to a control) ===');
if (!findings.length) console.log('none');
const seen = new Set();
for (const f of findings) {
  const key = `${f.view}|${f.control}|${f.errors[0]}`;
  if (seen.has(key)) continue; seen.add(key);
  console.log(`[${f.role}] ${f.view}  ${f.control}\n      -> ${f.errors.join(' || ').slice(0, 300)}`);
}
console.log('\n=== UNATTRIBUTED PAGE/CONSOLE ERRORS ===');
console.log(pageErrors.length ? [...new Set(pageErrors)].join('\n') : 'none');
await browser.close();
