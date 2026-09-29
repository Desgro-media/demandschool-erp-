import { route, send } from '../lib/http.js';
import { clearCookie } from '../lib/auth.js';

export default route(['POST'], async (req, res) => send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() }));
