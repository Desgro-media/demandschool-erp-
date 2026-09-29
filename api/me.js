import { route, send } from '../lib/http.js';
import { requireWho } from '../lib/session.js';
import { writableKeys, readableKeys } from '../lib/policy.js';

export default route(['GET'], async (req, res) => {
  const { user, who } = await requireWho(req);
  send(res, 200, { user: { kind: user.kind, refId: user.ref_id, access: who.access }, writable: writableKeys(who), readable: readableKeys(who) });
});
