// Storage abstraction: Neon Postgres when DATABASE_URL is set, otherwise a JSON file in .data/
// (local development only — it is refused in production).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCHEMA } from './schema.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const isProd = !!process.env.VERCEL || process.env.NODE_ENV === 'production';

/* ============================== Neon ============================== */
async function neonStore() {
  const { neon } = await import('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL);
  return {
    kind: 'neon',
    async init() {
      // audit_log is the last table created, so its presence means the schema is complete: skip the DDL.
      const [{ t }] = await sql`SELECT to_regclass('public.audit_log') AS t`;
      if (t) return;
      for (const stmt of SCHEMA) await sql.query(stmt);
    },
    countUsers: async () => Number((await sql`SELECT count(*)::int AS n FROM users`)[0].n),
    getUserByEmail: async email => (await sql`SELECT * FROM users WHERE email=${email}`)[0] || null,
    getUserById: async id => (await sql`SELECT * FROM users WHERE id=${id}`)[0] || null,
    getUserByRef: async (kind, ref) => (await sql`SELECT * FROM users WHERE kind=${kind} AND ref_id=${ref}`)[0] || null,
    async createUser({ email, password_hash, kind, ref_id, bootstrap = null }) {
      return (await sql`INSERT INTO users (email,password_hash,kind,ref_id,bootstrap)
        VALUES (${email},${password_hash},${kind},${ref_id},${bootstrap}) RETURNING *`)[0];
    },
    async updateUser(id, { email, password_hash }) {
      // Changing the password/email bumps token_version, which signs the user out everywhere.
      return (await sql`UPDATE users SET email=COALESCE(${email ?? null},email),
        password_hash=COALESCE(${password_hash ?? null},password_hash), token_version=token_version+1
        WHERE id=${id} RETURNING *`)[0];
    },
    async bumpToken(id) { await sql`UPDATE users SET token_version=token_version+1 WHERE id=${id}`; },
    async getState(keys) {
      return keys
        ? await sql`SELECT key,value,version FROM app_state WHERE key = ANY(${keys})`
        : await sql`SELECT key,value,version FROM app_state`;
    },
    // Compare-and-set: returns the new version, or null when someone else saved first.
    async setState(key, value, expected, by) {
      const json = JSON.stringify(value);
      if (expected === 0) {
        const r = await sql`INSERT INTO app_state (key,value,version,updated_by) VALUES (${key},${json}::jsonb,1,${by})
          ON CONFLICT (key) DO NOTHING RETURNING version`;
        return r[0]?.version ?? null;
      }
      const r = await sql`UPDATE app_state SET value=${json}::jsonb, version=version+1, updated_at=now(), updated_by=${by}
        WHERE key=${key} AND version=${expected} RETURNING version`;
      return r[0]?.version ?? null;
    },
    async getAttempt(key) { return (await sql`SELECT fails, first_at FROM login_attempts WHERE key=${key}`)[0] || null; },
    async recordFail(key, windowMs) {
      await sql`INSERT INTO login_attempts (key,fails,first_at) VALUES (${key},1,now())
        ON CONFLICT (key) DO UPDATE SET
          fails    = CASE WHEN login_attempts.first_at < now() - (${windowMs} * interval '1 millisecond') THEN 1 ELSE login_attempts.fails + 1 END,
          first_at = CASE WHEN login_attempts.first_at < now() - (${windowMs} * interval '1 millisecond') THEN now() ELSE login_attempts.first_at END`;
    },
    async clearAttempts(key) { await sql`DELETE FROM login_attempts WHERE key=${key}`; },
    async audit(user_id, action, detail = '') {
      await sql`INSERT INTO audit_log (user_id,action,detail) VALUES (${user_id},${action},${String(detail).slice(0, 500)})`;
    },
  };
}

/* ============================== File (dev only) ============================== */
function fileStore() {
  const dir = path.join(root, '.data');
  const file = path.join(dir, 'store.json');
  const load = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { users: [], state: {}, attempts: {}, seq: 0, audit: [] }; } };
  const save = db => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(db)); fs.renameSync(file + '.tmp', file); };
  const copy = u => (u ? { ...u } : null);
  const find = (db, id) => db.users.find(u => String(u.id) === String(id));
  return {
    kind: 'file',
    async init() { save(load()); },
    countUsers: async () => load().users.length,
    getUserByEmail: async email => copy(load().users.find(u => u.email === email)),
    getUserById: async id => copy(find(load(), id)),
    getUserByRef: async (kind, ref) => copy(load().users.find(u => u.kind === kind && u.ref_id === ref)),
    async createUser({ email, password_hash, kind, ref_id, bootstrap = null }) {
      const db = load();
      if (db.users.some(u => u.email === email || (u.kind === kind && u.ref_id === ref_id))) { const e = new Error('duplicate'); e.code = '23505'; throw e; }
      const u = { id: ++db.seq, email, password_hash, kind, ref_id, bootstrap, token_version: 0, disabled: false };
      db.users.push(u); save(db); return { ...u };
    },
    async updateUser(id, { email, password_hash }) {
      const db = load(); const u = find(db, id); if (!u) return null;
      if (email) u.email = email;
      if (password_hash) u.password_hash = password_hash;
      u.token_version++;
      save(db); return { ...u };
    },
    async bumpToken(id) { const db = load(); const u = find(db, id); if (u) { u.token_version++; save(db); } },
    async getState(keys) {
      const db = load();
      return Object.entries(db.state).filter(([k]) => !keys || keys.includes(k)).map(([key, s]) => ({ key, value: s.value, version: s.version }));
    },
    async setState(key, value, expected, by) {
      const db = load(); const cur = db.state[key];
      if ((cur?.version ?? 0) !== expected) return null;
      db.state[key] = { value, version: expected + 1, by }; save(db); return expected + 1;
    },
    async getAttempt(key) { const a = load().attempts[key]; return a ? { fails: a.fails, first_at: new Date(a.first_at) } : null; },
    async recordFail(key, windowMs) {
      const db = load(); const a = db.attempts[key];
      if (!a || Date.now() - a.first_at > windowMs) db.attempts[key] = { fails: 1, first_at: Date.now() }; else a.fails++;
      save(db);
    },
    async clearAttempts(key) { const db = load(); delete db.attempts[key]; save(db); },
    async audit(user_id, action, detail = '') {
      const db = load(); db.audit.push({ at: Date.now(), user_id, action, detail: String(detail).slice(0, 500) });
      db.audit = db.audit.slice(-500); save(db);
    },
  };
}

let impl;
async function get() {
  if (impl) return impl;
  if (process.env.DATABASE_URL || process.env.POSTGRES_URL) {
    process.env.DATABASE_URL ||= process.env.POSTGRES_URL;
    impl = await neonStore();
    // CREATE TABLE IF NOT EXISTS: makes a fresh Neon database usable without a manual setup step.
    try { await impl.init(); } catch (e) { console.error('schema init failed', e.message); }
  } else {
    if (isProd) throw new Error('DATABASE_URL is not set — connect a Neon database in Vercel > Storage');
    impl = fileStore();
  }
  return impl;
}

// Lazy proxy so serverless cold-starts only connect when a request actually needs the DB.
export const store = new Proxy({}, { get: (_, name) => async (...a) => (await get())[name](...a) });
export const storeKind = async () => (await get()).kind;
