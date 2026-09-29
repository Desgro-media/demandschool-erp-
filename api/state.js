import { route, send, readJson } from '../lib/http.js';
import { store } from '../lib/store.js';
import { requireWho } from '../lib/session.js';
import { ALL_KEYS, ARRAY_KEYS, canRead, writeMode, readView, applyWrite, studentCourses, httpError } from '../lib/policy.js';

const MAX_KEY_BYTES = 3.5 * 1024 * 1024;
const isPlainObject = v => v && typeof v === 'object' && !Array.isArray(v);

export default route(['GET', 'PUT'], async (req, res) => {
  const { user, who } = await requireWho(req);

  if (req.method === 'GET') {
    const keys = ALL_KEYS.filter(k => canRead(who, k));
    const rows = await store.getState(keys);
    const ctx = {};
    if (who.access === 'student') ctx.courses = studentCourses(who, (rows.find(r => r.key === 'students') || {}).value);
    const state = {};
    for (const r of rows) state[r.key] = { version: r.version, value: readView(who, r.key, r.value, ctx) };
    return send(res, 200, { state });
  }

  const changes = (await readJson(req)).changes;
  if (!isPlainObject(changes)) throw httpError(400, 'changes required');
  const keys = Object.keys(changes);
  if (keys.length === 0 || keys.length > 60) throw httpError(400, 'Invalid number of changes');

  // Validate everything first so a bad key rejects the whole request before anything is written.
  for (const key of keys) {
    if (!ALL_KEYS.includes(key)) throw httpError(400, `Unknown collection: ${key}`);
    if (!writeMode(who, key)) throw httpError(403, `You can't modify ${key}`);
    const v = isPlainObject(changes[key]) ? changes[key].value : undefined;
    if (ARRAY_KEYS.has(key) ? !Array.isArray(v) : !isPlainObject(v)) throw httpError(400, `Bad shape for ${key}`);
    if (JSON.stringify(v).length > MAX_KEY_BYTES) throw httpError(413, `${key} is too large`);
    // Credentials never live in app state — they belong to the users table only.
    if (key === 'employees' || key === 'students') for (const r of v) if (r && typeof r === 'object') delete r.password;
  }

  // One read for every collection being written, then the writes run in parallel: a first sign-in uploads
  // ~35 collections, and doing that one query at a time would risk the serverless time limit.
  const current = new Map((await store.getState(keys)).map(r => [r.key, r]));

  // Policy checks (e.g. HR trying to grant a leadership role) run before ANY write, so a rejected request
  // never leaves other collections half-saved.
  for (const key of keys) {
    if (writeMode(who, key) === 'full') applyWrite(who, key, changes[key].value, (current.get(key) || {}).value || null);
  }

  const results = {};
  await Promise.all(keys.map(async key => {
    try {
      const { base, value } = changes[key];
      const mode = writeMode(who, key);
      let row = current.get(key);
      for (let attempt = 0; attempt < 5; attempt++) {
        const expected = mode === 'full' ? Number(base) || 0 : (row ? row.version : 0);
        const applied = applyWrite(who, key, value, row ? row.value : null);
        const version = await store.setState(key, applied.value, expected, user.id);
        if (version != null) {
          results[key] = { version, ...(applied.merged ? { value: readView(who, key, applied.value, {}) } : {}) };
          return;
        }
        if (mode === 'full') break;                       // someone else saved first: report a conflict
        row = (await store.getState([key]))[0];           // scoped write lost a race: re-read and re-merge
      }
      results[key] = { conflict: true };
    } catch (err) {
      if (err.status && err.status < 500) throw err;      // policy rejection (e.g. role escalation): fail the request
      console.error('state write failed', key, err);
      results[key] = { error: true };
    }
  }));

  const saved = Object.keys(results).filter(k => results[k].version != null);
  if (saved.length) await store.audit(user.id, 'state.write', saved.join(','));
  send(res, 200, { results });
});
