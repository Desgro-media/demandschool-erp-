import { route, send, readJson } from '../lib/http.js';
import { store } from '../lib/store.js';
import { requireWho } from '../lib/session.js';
import { hashPassword, verifyPassword, validatePassword } from '../lib/auth.js';
import { httpError, resolveAccess } from '../lib/policy.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST { action:'set', kind, refId, email, password }   create/reset a login for an employee or student
// POST { action:'change-own', current, password }        change your own password
export default route(['POST'], async (req, res) => {
  const { user: me, who, employees } = await requireWho(req);
  const body = await readJson(req);

  if (body.action === 'change-own') {
    if (!(await verifyPassword(String(body.current || ''), me.password_hash))) throw httpError(403, 'Current password is incorrect');
    const bad = validatePassword(body.password); if (bad) throw httpError(400, bad);
    await store.updateUser(me.id, { password_hash: await hashPassword(body.password) });
    await store.audit(me.id, 'password.change', me.email);
    return send(res, 200, { ok: true, reauth: true });   // token_version bumped: caller must sign in again
  }

  if (body.action !== 'set') throw httpError(400, 'Unknown action');
  const kind = body.kind === 'student' ? 'student' : 'staff';
  const refId = String(body.refId || '');
  const email = String(body.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 254) throw httpError(400, 'A valid email is required');
  const bad = validatePassword(body.password); if (bad) throw httpError(400, bad);

  if (kind === 'staff') {
    if (!['leadership', 'hr'].includes(who.access)) throw httpError(403, 'Only HR or leadership can set staff logins');
    const emp = employees.find(e => e.id === refId);
    if (!emp) throw httpError(404, 'Employee not found: save the employee first');
    if ((emp.email || '').toLowerCase() !== email) throw httpError(400, "Email must match the employee's email");
    // HR must not be able to take over a leadership account by resetting its password.
    const target = resolveAccess({ kind: 'staff', ref_id: refId }, employees);
    if (target && target.access === 'leadership' && who.access !== 'leadership' && refId !== who.empId) {
      throw httpError(403, 'Only leadership can reset a leadership login');
    }
  } else {
    if (!['leadership', 'sales', 'staff'].includes(who.access)) throw httpError(403, 'Not allowed to set student logins');
    const rows = await store.getState(['students']);
    const stu = ((rows[0] && rows[0].value) || []).find(s => s.id === refId);
    if (!stu) throw httpError(404, 'Student not found: save the student first');
    if ((stu.email || '').toLowerCase() !== email) throw httpError(400, "Email must match the student's email");
  }

  const password_hash = await hashPassword(body.password);
  const existing = await store.getUserByRef(kind, refId);
  try {
    if (existing) await store.updateUser(existing.id, { email, password_hash });
    else await store.createUser({ email, password_hash, kind, ref_id: refId });
  } catch (e) {
    if (e.code === '23505') throw httpError(409, 'That email already has a login');
    throw e;
  }
  await store.audit(me.id, existing ? 'password.reset' : 'user.create', `${kind}:${refId}`);
  send(res, 200, { ok: true });
});
