"""Applies the backend + security integration to a fresh copy of the UI file.

    python scripts/merge-ui.py "Dschool ERP.html"            # writes public/index.html
    python scripts/merge-ui.py new.html some/other/out.html

The integration lives in scripts/merge/ (helpers.js, backend-block.js); everything else here is small
find-and-replace steps. Each step asserts its anchor, so if the UI changed in a way that breaks one, the
script stops and says which - it never patches the wrong place silently."""
import os, re, sys

here = os.path.dirname(os.path.abspath(__file__))
new_path = sys.argv[1]
out_path = sys.argv[2] if len(sys.argv) > 2 else os.path.join(here, '..', 'public', 'index.html')
t = open(new_path, encoding='utf8').read()
HELPERS = open(os.path.join(here, 'merge', 'helpers.js'), encoding='utf8').read()
BLOCK = open(os.path.join(here, 'merge', 'backend-block.js'), encoding='utf8').read()
log = []

def must_replace(old, new, count=1, label=''):
    global t
    n = t.count(old)
    assert n >= 1, f'anchor not found: {label or old[:70]!r}'
    if count == 1:
        assert n == 1, f'anchor not unique ({n}): {label or old[:70]!r}'
    t = t.replace(old, new) if count == 'all' else t.replace(old, new, 1)
    log.append(f'ok  {label or old[:50]!r}')

def must_sub(pattern, repl, label, flags=re.S):
    global t
    t2, n = re.subn(pattern, repl, t, count=1, flags=flags)
    assert n == 1, f'regex anchor not found: {label}'
    t = t2
    log.append(f'ok  {label}')

# ---------- 1. helpers (jsq / safeUrl) ----------
must_replace('const inr = n =>', HELPERS + 'const inr = n =>', label='helpers jsq/safeUrl')

# ---------- 2. inline-handler string args: '${esc(x)}' -> ${jsq(x)} ----------
pat = re.compile(r"(on(?:click|change|input)=\"[^\"]*?)'\$\{esc\(([^)]*)\)\}'")
n_args = 0
while True:
    t2, n = pat.subn(lambda m: f"{m.group(1)}${{jsq({m.group(2)})}}", t)
    if n == 0: break
    n_args += n; t = t2
log.append(f'ok  handler args converted to jsq: {n_args}')

# ---------- 3. hrefs built from user URLs ----------
n_href = t.count('href="${esc(m.url)}" target="_blank" rel="noopener"')
assert n_href >= 1
t = t.replace('href="${esc(m.url)}" target="_blank" rel="noopener"', 'href="${esc(safeUrl(m.url))}" target="_blank" rel="noopener noreferrer"')
log.append(f'ok  hrefs via safeUrl: {n_href}')

# ---------- 4. login form ----------
must_sub(r'<label class="field-label">Sign in as <span class="faint">\(preview\)</span></label>\s*<select class="field-input" id="login-as-student"></select>',
         '<label class="field-label">Student email</label>\n          <input class="field-input" type="email" id="login-email-student" placeholder="you@example.com" autocomplete="username" maxlength="254">', 'login: student email field')
must_sub(r'\s*<div class="field-group" id="login-staffpicker-wrap">.*?</select>\s*</div>', '', 'login: remove "sign in as" picker')
must_sub(r'<label class="login-remember"><input type="checkbox" id="login-remember" checked>Remember me</label>\s*<a class="login-forgot"[^>]*>Forgot password\?</a>',
         '<span class="login-remember">Sessions expire after 8 hours.</span>\n        <a class="login-forgot" onclick="toast(\'Ask HR or an admin to reset your password\')">Forgot password?</a>', 'login: row')
must_sub(r'id="login-email" required placeholder', 'id="login-email" placeholder', 'login: email not required attr')
must_sub(r'id="login-email" placeholder="you@demandschool.in" autocomplete="username"', 'id="login-email" placeholder="you@demandschool.in" autocomplete="username" maxlength="254"', 'login: email maxlength')
must_sub(r'autocomplete="current-password"', 'autocomplete="current-password" maxlength="200"', 'login: password maxlength')
must_sub(r'<div class="login-hint" id="login-hint">[^<]*</div>', '<div class="login-hint" id="login-hint">Sign in with the email and password HR gave you.</div>', 'login: hint')

# ---------- 5. login gate + sync layer ----------
a = t.index('/* ===================== LOGIN GATE ===================== */')
b = t.index('// Left-nav sections of the student portal')
t = t[:a] + BLOCK + t[b:]
log.append('ok  login gate + api + sync block replaced')

# ---------- 6. startup: resume session ----------
must_replace('populateLoginAs();\npopulateLoginAsStudent();',
             "// Resume an existing session (cookie still valid) instead of asking for the password again.\napi('me').then(res=>bootSession(res.user, res.writable, res.readable)).catch(()=>{ /* not signed in: the login screen stays up */ });",
             label='startup session resume')

# ---------- 7. passwords never enter client state ----------
must_replace(',password:f.get("password"),employmentStatus:"Active"});',
             ',employmentStatus:"Active"});\n    grantLogin("staff", id, String(f.get("email")||"").trim(), f.get("password"));', label='add employee: no password in state')
must_replace('name="password" required minlength="4" placeholder="Choose a password for their sign-in"',
             'name="password" required minlength="8" maxlength="200" autocomplete="new-password" placeholder="At least 8 characters, letters and numbers"', label='add employee: password input')
must_sub(r'<div>\$\{e\.password \? "A password is already set\. Leave this blank to keep it unchanged\." : "No password set yet[^"]*"\}</div>',
         '<div>Set or reset their ERP password here. Leave it blank to keep the current one. Passwords are stored only as a salted hash.</div>', 'edit employee: banner')
must_sub(r'<label class="field-label">\$\{e\.password \? "Reset ERP password" : "Set ERP password"\}</label><input class="field-input" type="password" name="password" minlength="4" placeholder="\$\{e\.password \? "Leave blank to keep current password" : "Choose a password for their sign-in"\}">',
         '<label class="field-label">ERP password</label><input class="field-input" type="password" name="password" minlength="8" maxlength="200" autocomplete="new-password" placeholder="Leave blank to keep current password">', 'edit employee: input')
must_replace('    if(newPw) e.password = newPw;\n    toast("Employee details updated"); closeModal(); render();',
             '    toast("Employee details updated"); closeModal(); render();\n    grantLogin("staff", e.id, String(f.get("email")||"").trim(), newPw);', label='edit employee: grantLogin')
must_replace('''      <div><label class="field-label">Sales Person</label><select class="field-input" name="salesPerson">${salesTeamOptions()}</select></div>
      <div class="subtext">Fee plan follows''',
             '''      <div><label class="field-label">Sales Person</label><select class="field-input" name="salesPerson">${salesTeamOptions()}</select></div>
      <div><label class="field-label">Student portal password <span class="faint">(optional — needs an email)</span></label><input class="field-input" type="password" name="portalPassword" minlength="8" maxlength="200" autocomplete="new-password" placeholder="At least 8 characters, letters and numbers"></div>
      <div class="subtext">Fee plan follows''', label='add student: portal password field')
must_replace('''inv.length>1?'s':'')+" raised":"")); closeModal(); render();
  });''', '''inv.length>1?'s':'')+" raised":"")); closeModal(); render();
    const portalPw = f.get("portalPassword");
    if(portalPw){
      if(student.email) grantLogin("student", student.id, String(student.email).trim(), portalPw);
      else toast("Student registered — add an email to give them a portal login");
    }
  });''', label='add student: grantLogin')

# ---------- 8. print window ----------
must_replace('  w.document.close();', '  w.document.close();\n  try{ w.opener = null; }catch(_){}   // the print tab must not be able to navigate this one', label='print window opener')

# ---------- 9. dark-mode colour fixes ----------
must_replace('--brand:#2AB460; --brand-strong:#15382E; --brand-soft:#E1F3E7;', '--brand:#2AB460; --brand-strong:#15382E; --brand-soft:#E1F3E7; --solid:#15382E;', label='token --solid (light)')
must_replace('--brand-soft:rgba(42,180,96,.18);', '--brand-soft:rgba(42,180,96,.18); --solid:#1E7A48;', count='all', label='token --solid (dark)')
must_replace('.avatar{width:34px;height:34px;border-radius:8px;background:var(--ink)', '.avatar{width:34px;height:34px;border-radius:8px;background:var(--solid)', label='avatar')
must_replace('.mini-avatar{width:26px;height:26px;border-radius:7px;background:var(--ink)', '.mini-avatar{width:26px;height:26px;border-radius:7px;background:var(--solid)', label='mini-avatar')
must_replace('.kpi-card.hero{background:var(--ink);border-color:var(--ink)', '.kpi-card.hero{background:var(--solid);border-color:var(--solid)', label='kpi hero')
must_replace('transform:translateX(-50%);background:var(--ink);color:#fff', 'transform:translateX(-50%);background:var(--solid);color:#fff', label='toast')
must_replace('.chip.active{background:var(--ink);border-color:var(--ink);color:#fff;}',
             '.chip.active{background:var(--solid);border-color:var(--solid);color:#fff;}\n  .chip:not(.active):hover{border-color:var(--brand);color:var(--ink);}', label='chip active')

# ---------- 10. bug fixes found by QA in the UI itself ----------
# Attendance history assumed every employee has a record for today; guest trainers do not, so the popup crashed.
# Default to "present" exactly like the attendance table beside it does.
must_replace('const e = byId(empId); const a = attendanceToday[empId];',
             'const e = byId(empId); const a = attendanceToday[empId] || {status:"present", in:null};', label='attendance history: missing today record')

# ---------- 11. real date instead of the fixed demo date ----------
# The UI was built around a hard-coded "today" (15 Sep 2026). Use the real local date, and make everything that
# hung off that fixed month (payroll sheets, month labels, dashboard filters, invoice year) follow it.
def snippet(name):
    return open(os.path.join(here, 'merge', name), encoding='utf8').read()

must_replace('const TODAY = "2026-09-15";', snippet('today.js').rstrip('\n'), label='TODAY = real local date')
must_replace('const MONTH_LABEL = {"2026-08":"August 2026","2026-09":"September 2026"};', snippet('month-label.js').rstrip('\n'), label='MONTH_LABEL for any month')
must_replace('const payroll = { selectedMonth:"2026-09", history:{ "2026-08":{entries:{}}, "2026-09":{entries:{}} } };',
             'const payroll = { selectedMonth:TODAY.slice(0,7), history:{ "2026-08":{entries:{}}, "2026-09":{entries:{}} } };', label='payroll default month')
WITHDRAWALS = "// Withdrawal requests — against a month that's already fully earned (closed) but not yet fully paid."
must_replace(WITHDRAWALS, snippet('ensure-payroll.js') + WITHDRAWALS, label='ensurePayrollMonths')
must_replace('i.issued.slice(0,7)==="2026-09"', 'i.issued.slice(0,7)===TODAY.slice(0,7)', label='dashboard revenue month')
must_replace('c.due.slice(0,7)==="2026-09"', 'c.due.slice(0,7)===TODAY.slice(0,7)', count='all', label='published-this-month filters')
must_replace('<span class="kpi-label">Revenue — September</span>', '<span class="kpi-label">Revenue — ${monthLabel(TODAY.slice(0,7)).split(" ")[0]}</span>', label='dashboard revenue label')
must_replace('"DS-2026-"+(1000+invoices.length+1)', '"DS-"+TODAY.slice(0,4)+"-"+(1000+invoices.length+1)', label='invoice number year')
must_replace('placeholder="DS-2026-1049"', 'placeholder="DS-${TODAY.slice(0,4)}-1049"', label='invoice number placeholder')

# ---------- 12. today's date, visible in the top bar of both shells ----------
must_replace('<div class="topbar-right"></div>', '<div class="topbar-right"><div class="date-chip" data-date-chip></div></div>', label='student top bar date chip')
must_replace('<div class="topbar-right">\n        <div class="search">', '<div class="topbar-right">\n        <div class="date-chip" data-date-chip></div>\n        <div class="search">', label='staff top bar date chip')
must_replace('  .select-sm{border:1px solid',
             '  .date-chip{font-size:12.5px;font-weight:600;color:var(--ink-soft);padding:6px 12px;border:1px solid var(--line);border-radius:100px;background:var(--surface);white-space:nowrap;}\n  @media (max-width:760px){ .date-chip{display:none;} }\n  .select-sm{border:1px solid', label='date chip css')

open(out_path, 'w', encoding='utf8').write(t)
print('\n'.join(log))
print('written', out_path, len(t.encode('utf8')), 'bytes')
