import { requireUser } from './auth.js';
import { store } from './store.js';
import { resolveAccess, httpError } from './policy.js';

// Signed-in user + resolved role. Role is derived from the stored employee record on every request, so
// demoting/archiving someone in HR takes effect immediately, not at their next login.
export async function requireWho(req) {
  const user = await requireUser(req);
  const rows = await store.getState(['employees']);
  const employees = rows[0] ? rows[0].value : [];
  const who = resolveAccess(user, employees);
  if (!who) throw httpError(401, 'Access revoked');
  return { user, who, employees };
}
