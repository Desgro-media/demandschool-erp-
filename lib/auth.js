import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { parseCookies } from './http.js';
import { store } from './store.js';

const scrypt = promisify(crypto.scrypt);
const SESSION_HOURS = 8;
const COOKIE = 'sid';
const isProd = () => !!process.env.VERCEL || process.env.NODE_ENV === 'production';

function secret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (isProd()) throw new Error('SESSION_SECRET (>=32 chars) must be set in production');
  return 'dev-only-insecure-secret-do-not-use-in-production';
}

/* ---------- passwords: scrypt, per-user random salt, constant-time compare ---------- */
const N = 16384, R = 8, P = 1, KEYLEN = 64;
export async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}
export async function verifyPassword(pw, stored) {
  const [alg, n, r, p, salt, hash] = String(stored || '').split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scrypt(pw, Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p });
  return crypto.timingSafeEqual(key, expected);
}
// Burn comparable time when the account doesn't exist, so response time doesn't reveal valid emails.
const DUMMY = await hashPassword('dummy-password-for-timing');
export const burnTime = pw => verifyPassword(pw, DUMMY).catch(() => false);

export function validatePassword(pw) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Password must be at least 8 characters';
  if (pw.length > 200) return 'Password is too long';
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return 'Password must contain letters and numbers';
  return null;
}

/* ---------- signed session cookie (HMAC-SHA256); tv = user's token_version for revocation ---------- */
const b64 = b => Buffer.from(b).toString('base64url');
const sign = data => crypto.createHmac('sha256', secret()).update(data).digest('base64url');

export function sessionCookie(user) {
  const payload = b64(JSON.stringify({ u: user.id, tv: user.token_version, exp: Date.now() + SESSION_HOURS * 3600e3 }));
  const attrs = ['HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${SESSION_HOURS * 3600}`];
  if (isProd()) attrs.push('Secure');
  return `${COOKIE}=${payload}.${sign(payload)}; ${attrs.join('; ')}`;
}
export function clearCookie() {
  return `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${isProd() ? '; Secure' : ''}`;
}

export async function currentUser(req) {
  const tok = parseCookies(req)[COOKIE];
  if (!tok) return null;
  const [payload, sig] = tok.split('.');
  if (!payload || !sig) return null;
  const good = sign(payload);
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  let data; try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { return null; }
  if (!data.exp || data.exp < Date.now()) return null;
  const user = await store.getUserById(data.u);
  if (!user || user.disabled || user.token_version !== data.tv) return null;
  return user;
}

export async function requireUser(req) {
  const u = await currentUser(req);
  if (!u) { const e = new Error('Not signed in'); e.status = 401; throw e; }
  return u;
}
