// Second pass (leadership): every detail page / modal, plus every printable document and its popup window.
import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://127.0.0.1:3000/';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const problems = [];
const IGNORE = /status of (401|404)|favicon/;
page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) problems.push(`console: ${m.text()}`); });
await page.addInitScript(() => {
  window.__errs = [];
  window.addEventListener('error', e => window.__errs.push('error: ' + e.message));
  window.addEventListener('unhandledrejection', e => window.__errs.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
  const ce = console.error; console.error = (...a) => { window.__errs.push('console.error: ' + a.join(' ')); ce.apply(console, a); };
});

await page.goto(BASE);
await page.waitForSelector('#login-screen:not([hidden])');
await page.fill('#login-email', 'thanseemca@gmail.com');
await page.fill('#login-password', 'Demand2026!Admin');
await page.click('.login-submit');
await page.waitForSelector('#app-shell:not([hidden])');
await page.waitForTimeout(1500);

const crawl = async ({ setupSrc, scope, cap }) => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const setup = new Function(setupSrc);
  const list = () => Array.from(document.querySelectorAll(scope + ' [onclick]'));
  setup();
  const total = list().length;
  const out = [];
  for (let i = 0; i < Math.min(total, cap); i++) {
    setup();
    const el = list()[i]; if (!el) break;
    const code = el.getAttribute('onclick') || '';
    if (/logout|signOut|delete|remove|Delete|Remove|window\.open|window\.print/.test(code)) continue;
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
  closeModal();
  return { total, out };
};

const ids = await page.evaluate(() => ({
  students: students.map(s => s.id), batches: batches.map(b => b.id), courses: COURSES.slice(),
  employees: employees.map(e => e.id), quotes: quotes.map(q => q.id), invoices: invoices.map(i => i.id),
  candidates: candidates.map(c => c.id),
}));
console.log('entities:', Object.entries(ids).map(([k, v]) => `${k}=${v.length}`).join(' '));

const findings = []; let views = 0, controls = 0;
const run = async (label, setupSrc, scope) => {
  const r = await page.evaluate(crawl, { setupSrc, scope, cap: 60 });
  views++; controls += r.total;
  for (const f of r.out) findings.push({ label, control: f.control, errs: f.errs });
};
for (const id of ids.students) await run(`student ${id}`, `nav.module='students'; nav.sub.students='all'; nav.detail=null; openStudentDetail('${id}');`, '#content');
for (const c of ids.courses) await run(`course ${c}`, `nav.module='students'; nav.sub.students='courses'; nav.detail=null; openCourseDetail(${JSON.stringify(c)});`, '#content');
for (const id of ids.batches) await run(`batch ${id}`, `nav.module='students'; nav.sub.students='batches'; nav.detail=null; render(); openBatchDetail('${id}');`, '#modal');
for (const id of ids.employees) await run(`employee ${id}`, `nav.module='hr'; nav.sub.hr='directory'; nav.detail=null; render(); openEmployeeDetail('${id}');`, '#modal');
for (const id of ids.invoices) await run(`invoice payments ${id}`, `nav.module='accounts'; nav.detail=null; render(); openInvoicePayments('${id}');`, '#modal');
console.log(`detail views=${views} controls=${controls}`);

// printable documents open a popup under the same CSP: check each one renders and is error-free
const docs = [
  ...ids.quotes.map(id => `downloadQuote('${id}')`),
  ...ids.invoices.map(id => `downloadInvoice('${id}')`),
  ...ids.invoices.slice(0, 4).map(id => `downloadReceipt('${id}', 0)`),
  ...ids.candidates.map(id => `openOfferLetter('${id}')`),
];
let docOk = 0; const docFail = [];
for (const call of docs) {
  const popupP = ctx.waitForEvent('page', { timeout: 4000 }).catch(() => null);
  const errBefore = problems.length;
  const threw = await page.evaluate(src => { try { new Function(src)(); return null; } catch (e) { return e.message; } }, call);
  const pop = await popupP;
  if (threw) { docFail.push(`${call}: threw ${threw}`); continue; }
  if (!pop) { // offer letters open a modal instead of a popup
    const modalOpen = await page.evaluate(() => !document.getElementById('overlay').hidden);
    if (modalOpen) { await page.evaluate(() => closeModal()); docOk++; } else docFail.push(`${call}: neither popup nor modal`);
    continue;
  }
  pop.on('pageerror', e => problems.push(`popup pageerror: ${e.message}`));
  await pop.waitForLoadState('domcontentloaded').catch(() => {});
  await pop.waitForTimeout(150);
  const info = await pop.evaluate(() => ({ len: document.body.innerText.length, hasPrint: !!document.querySelector('.print-bar button'), title: document.title }));
  if (info.len < 50 || !info.hasPrint) docFail.push(`${call}: popup looks empty (${JSON.stringify(info)})`); else docOk++;
  await pop.close();
  if (problems.length > errBefore) docFail.push(`${call}: ${problems.slice(errBefore).join(' | ')}`);
}
console.log(`documents: ${docOk}/${docs.length} rendered OK`);
docFail.forEach(f => console.log('  DOC FAIL', f));

console.log('\n=== FINDINGS ===');
const seen = new Set();
for (const f of findings) { const k = `${f.label}|${f.control}|${f.errs[0]}`; if (seen.has(k)) continue; seen.add(k); console.log(`${f.label}  ${f.control}\n    -> ${f.errs.join(' || ').slice(0, 300)}`); }
if (!findings.length) console.log('none');
console.log('\n=== UNATTRIBUTED ERRORS ===');
console.log(problems.length ? [...new Set(problems)].join('\n') : 'none');
await browser.close();
