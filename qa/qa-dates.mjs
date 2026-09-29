// Date behaviour: runs the app under a fake browser clock (Asia/Kolkata) at awkward dates and checks that
// "today", month labels, payroll sheets, dashboard and every leadership screen follow the clock; then tests the
// overnight rollover. Needs a scratch database:  delete .data, npm run init-db, npm run dev.
import { chromium } from 'playwright-core';

const BASE = (process.env.BASE || 'http://127.0.0.1:3000').replace(/\/$/, '');
const ADMIN = { email: 'thanseemca@gmail.com', pw: 'Demand2026!Admin' };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
let failed = 0;
const ok = (name, cond, extra = '') => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  -> ' + extra}`); if (!cond) failed++; };
const IGNORE = /status of (401|404)|favicon/;

async function open(time) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, timezoneId: 'Asia/Kolkata' });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', e => errs.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !IGNORE.test(m.text())) errs.push('console: ' + m.text()); });
  await page.addInitScript(() => {
    window.__errs = [];
    window.addEventListener('error', e => window.__errs.push('error: ' + e.message));
    window.addEventListener('unhandledrejection', e => window.__errs.push('rejection: ' + (e.reason && e.reason.message || e.reason)));
  });
  await page.clock.install({ time: new Date(time) });
  await page.goto(BASE + '/');
  await page.waitForSelector('#login-screen:not([hidden])');
  await page.fill('#login-email', ADMIN.email);
  await page.fill('#login-password', ADMIN.pw);
  await page.click('.login-submit');
  await page.waitForSelector('#app-shell:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(1500);
  return { ctx, page, errs };
}

const walk = async page => page.evaluate(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let views = 0;
  for (const m of visibleModules()) for (const sub of (m.sub && m.sub.length ? m.sub.map(s => s.id) : [null])) {
    nav.module = m.id; if (sub) nav.sub[m.id] = sub; nav.detail = null; render(); views++;
    const els = Array.from(document.querySelectorAll('#content [onclick]')).slice(0, 25);
    for (let i = 0; i < els.length; i++) {
      nav.module = m.id; if (sub) nav.sub[m.id] = sub; nav.detail = null; render();
      const el = document.querySelectorAll('#content [onclick]')[i]; if (!el) break;
      const code = el.getAttribute('onclick') || '';
      if (/logout|signOut|delete|remove|Delete|Remove|window\.open|window\.print/.test(code)) continue;
      try { el.click(); } catch (e) { window.__errs.push('click threw: ' + e.message); }
      await sleep(15);
      const ov = document.getElementById('overlay');
      if (ov && !ov.hidden) { const f = ov.querySelector('form'); if (f && f.checkValidity()) { try { f.requestSubmit(); } catch (e) { window.__errs.push('submit: ' + e.message); } await sleep(25); } closeModal(); }
    }
  }
  return { views, errs: window.__errs.slice() };
});

const ymd = t => t.slice(0, 10);
const prevMonth = ym => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 2, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
const monthsBetween = (a, b) => { const out = []; let [y, m] = a.split('-').map(Number); const [ey, em] = b.split('-').map(Number); while (y < ey || (y === ey && m <= em)) { out.push(y + '-' + String(m).padStart(2, '0')); if (++m > 12) { m = 1; y++; } } return out; };

const scenarios = [
  ['2026-09-29T10:00:00+05:30', 'today (real date when this was written)'],
  ['2026-10-05T10:00:00+05:30', 'a new month starts (payroll has no October sheet in the seed)'],
  ['2026-12-31T22:30:00+05:30', 'last evening of the year'],
  ['2027-03-15T10:00:00+05:30', 'six months later: gap of empty months'],
  ['2028-02-29T10:00:00+05:30', 'leap day'],
  ['2026-01-10T10:00:00+05:30', 'a date BEFORE the sample data (clock set wrong)'],
];
for (const [time, label] of scenarios) {
  console.log(`\n--- ${ymd(time)}: ${label}`);
  const { ctx, page, errs } = await open(time);
  const want = ymd(time), wantMonth = want.slice(0, 7);
  const info = await page.evaluate(() => ({
    today: TODAY, sel: payroll.selectedMonth, months: Object.keys(payroll.history).sort(), closed: closedPayrollMonth(),
    label: MONTH_LABEL[TODAY.slice(0, 7)], revenueLabel: (Array.from(document.querySelectorAll('.kpi-label')).map(x => x.textContent).find(t => /^Revenue/.test(t)) || null),
  }));
  ok('TODAY is the clock date', info.today === want, info.today);
  ok('payroll opens on the current month', info.sel === wantMonth, info.sel);
  const first = info.months[0];
  const expectMonths = monthsBetween(first < wantMonth ? first : wantMonth, wantMonth > info.months.at(-1) ? wantMonth : info.months.at(-1));
  ok('payroll has a sheet for every month up to now (no gaps)', JSON.stringify(info.months) === JSON.stringify(expectMonths), info.months.join(','));
  ok('month label works for any month', info.label === new Date(Number(wantMonth.slice(0, 4)), Number(wantMonth.slice(5)) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), info.label);
  ok('"closed payroll month" is last month', info.closed === prevMonth(wantMonth), info.closed);
  const chip = await page.evaluate(() => document.querySelector('#app-shell [data-date-chip]').textContent);
  ok('top bar shows the clock date', chip.includes(want.slice(0, 4)) && new RegExp('\\b' + Number(want.slice(8)) + '\\b').test(chip), chip);
  await page.evaluate(() => { nav.module = 'dashboard'; render(); });
  const rev = await page.evaluate(() => Array.from(document.querySelectorAll('.kpi-label')).map(x => x.textContent).find(t => /^Revenue/.test(t)));
  const monthName = new Date(Number(want.slice(0, 4)), Number(wantMonth.slice(5)) - 1, 1).toLocaleDateString('en-US', { month: 'long' });
  ok('dashboard revenue card names the current month', rev === `Revenue — ${monthName}`, String(rev));
  // payroll on the current month: add a person and record a payment
  const pay = await page.evaluate(async wantMonth => {
    payroll.selectedMonth = wantMonth; nav.module = 'hr'; nav.sub.hr = 'payroll'; render();
    const free = employees.find(e => !payroll.history[wantMonth].entries[e.id]) || employees[0];
    const id = free.id; delete payroll.history[wantMonth].entries[id];
    openAddPayrollEntry(id);
    const f = document.querySelector('#modal form'); if (!f) return 'no form';
    const g = f.querySelector('[name=gross]'); if (g) { g.value = '30000'; }
    f.requestSubmit(); await new Promise(r => setTimeout(r, 300));
    return payroll.history[wantMonth].entries[id] ? 'added' : 'not added';
  }, wantMonth);
  ok('HR can add someone to the current month\'s payroll', pay === 'added', pay);
  const w = await walk(page);
  ok(`all ${w.views} leadership screens render + controls click without errors`, w.errs.length === 0 && errs.length === 0, [...w.errs, ...errs].slice(0, 3).join(' | '));
  await ctx.close();
}

/* ---------- overnight rollover ---------- */
// A reload wipes window.__mark, so that is how we tell whether the page reloaded itself.
const marked = page => page.evaluate(() => { window.__mark = 1; });
const reloaded = async (page, ms = 15000) => page.waitForFunction(() => window.__mark === undefined, null, { timeout: ms }).then(() => true).catch(() => false);
console.log('\n--- overnight rollover (clock starts 23:58:30 on 31 Dec)');
{
  const { ctx, page } = await open('2026-12-31T23:58:30+05:30');
  await marked(page);
  await page.clock.runFor(30000);                       // 23:59:00 - still the same day
  await page.waitForTimeout(500);
  ok('no reload before midnight', await page.evaluate(() => window.__mark === 1));
  await page.evaluate(() => openPostNotice());          // a dialog is open across midnight
  await page.clock.runFor(150000);
  await page.waitForTimeout(800);
  ok('no reload while a dialog is open at midnight', await page.evaluate(() => window.__mark === 1 && !document.getElementById('overlay').hidden));
  await page.evaluate(() => closeModal());
  await page.clock.runFor(70000);
  ok('page reloads itself after midnight once the dialog is closed', await reloaded(page));
  await page.waitForSelector('#app-shell:not([hidden])', { timeout: 15000 });
  ok('...and comes back signed in on the new date', (await page.evaluate(() => TODAY)) === '2027-01-01', await page.evaluate(() => TODAY));
  await ctx.close();
}
{
  const { ctx, page } = await open('2026-12-31T23:58:30+05:30');
  await marked(page);
  // an unsaved change at midnight is saved first, then the page reloads and the change is still there
  await page.evaluate(() => { notices.unshift({ id: 'NTC-MIDNIGHT', title: 'written just before midnight', message: 'x', postedBy: 'x', postedDate: TODAY }); });
  await page.clock.runFor(120000);
  ok('page reloads itself at midnight with an unsaved change pending', await reloaded(page, 20000));
  await page.waitForSelector('#app-shell:not([hidden])', { timeout: 15000 });
  await page.waitForTimeout(1200);
  ok('the change made just before midnight was saved, not lost', await page.evaluate(() => notices.some(n => n.id === 'NTC-MIDNIGHT')));
  await ctx.close();
}
{
  // login screen left open overnight: signing in must land on today's date, not yesterday's
  const ctx = await browser.newContext({ timezoneId: 'Asia/Kolkata' });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date('2026-12-31T23:59:00+05:30') });
  await page.goto(BASE + '/');
  await page.waitForSelector('#login-screen:not([hidden])');
  await marked(page);
  await page.clock.runFor(180000);                      // sits on the login page past midnight
  await page.waitForTimeout(500);
  // the sign-in handler notices the stale date and reloads; the session cookie then restores the session
  await page.fill('#login-email', ADMIN.email); await page.fill('#login-password', ADMIN.pw);
  await page.click('.login-submit');
  await page.waitForSelector('#app-shell:not([hidden])', { timeout: 20000 });
  await page.waitForTimeout(1500);
  ok('signing in after a login page sat open overnight uses the new date', (await page.evaluate(() => TODAY)) === '2027-01-01', await page.evaluate(() => TODAY));
  await ctx.close();
}

console.log(failed ? `\n${failed} DATE CHECK(S) FAILED` : '\nAll date checks passed');
await browser.close();
process.exit(failed ? 1 : 0);
