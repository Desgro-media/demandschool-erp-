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

  const ctx = {};
  const results = {};
  for (const key of keys) {
    const { base, value } = changes[key];
    const mode = writeMode(who, key);
    for (let attempt = 0; attempt < 5; attempt++) {
      const row = (await store.getState([key]))[0];
      const existing = row ? row.value : null;
      const expected = mode === 'full' ? Number(base) || 0 : (row ? row.version : 0);
      const applied = applyWrite(who, key, value, existing);
      const version = await store.setState(key, applied.value, expected, user.id);
      if (version != null) {
        if (key === 'students' && who.access === 'student') ctx.courses = studentCourses(who, applied.value);
        results[key] = { version, ...(applied.merged ? { value: readView(who, key, applied.value, ctx) } : {}) };
        await store.audit(user.id, 'state.write', key);
        break;
      }
      if (mode === 'full') break;   // someone else saved first: report a conflict
      // scoped write lost a race with another user: loop re-reads and re-merges
    }
    if (!results[key]) results[key] = { conflict: true };
  }
  send(res, 200, { results });
});
