import { route, send, readJson, clientIp } from '../lib/http.js';
import { store } from '../lib/store.js';
import { verifyPassword, burnTime, sessionCookie, hashPassword, validatePassword } from '../lib/auth.js';
import { resolveAccess, writableKeys } from '../lib/policy.js';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_PER_IP_EMAIL = 5;
const MAX_PER_EMAIL = 15;

async function locked(key, max) {
  const a = await store.getAttempt(key);
  return !!a && a.fails >= max && Date.now() - new Date(a.first_at).getTime() < WINDOW_MS;
}

export default route(['POST'], async (req, res) => {
  const body = await readJson(req);
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const kind = body.kind === 'student' ? 'student' : 'staff';
  if (!email || !password || email.length > 254 || password.length > 200) return send(res, 400, { error: 'Enter your email and password' });

  const k1 = `${email}|${clientIp(req)}`, k2 = `${email}|*`;
  if (await locked(k1, MAX_PER_IP_EMAIL) || await locked(k2, MAX_PER_EMAIL)) {
    return send(res, 429, { error: 'Too many failed attempts. Try again in 15 minutes.' }, { 'Retry-After': '900' });
  }

  // First-run bootstrap: only while there are ZERO users and ADMIN_INITIAL_PASSWORD is set. Once any
  // user exists this does nothing, so remove that variable after the first sign-in.
  if (process.env.ADMIN_INITIAL_PASSWORD && !validatePassword(process.env.ADMIN_INITIAL_PASSWORD) && await store.countUsers() === 0) {
    const adminEmail = String(process.env.ADMIN_EMAIL || 'thanseemca@gmail.com').toLowerCase();
    try { await store.createUser({ email: adminEmail, password_hash: await hashPassword(process.env.ADMIN_INITIAL_PASSWORD), kind: 'staff', ref_id: 'EMP-101', bootstrap: 'leadership' }); }
    catch (e) { if (e.code !== '23505') throw e; }
  }

  const user = await store.getUserByEmail(email);
  const ok = user ? await verifyPassword(password, user.password_hash) : await burnTime(password);
  const rows = user ? await store.getState(['employees']) : [];
  const who = user && ok && user.kind === kind && !user.disabled ? resolveAccess(user, rows[0] ? rows[0].value : []) : null;

  if (!who) {
    await Promise.all([store.recordFail(k1, WINDOW_MS), store.recordFail(k2, WINDOW_MS)]);
    await store.audit(user ? user.id : null, 'login.fail', email);
    // Same message for wrong email, wrong password, wrong tab, archived or disabled account.
    return send(res, 401, { error: 'Incorrect email or password' });
  }
  await store.clearAttempts(k1);
  await store.audit(user.id, 'login.ok', email);
  send(res, 200, { user: { kind: user.kind, refId: user.ref_id, access: who.access }, writable: writableKeys(who) }, { 'Set-Cookie': sessionCookie(user) });
});
