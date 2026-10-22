import crypto from 'node:crypto';
import { route, send, readJson } from '../lib/http.js';
import { store } from '../lib/store.js';
import { requireWho } from '../lib/session.js';
import { canRead, writeMode, studentCourses, httpError } from '../lib/policy.js';

// Vercel caps a request body at 4.5 MB and base64 adds a third, so ~2.8 MB of real file is the ceiling.
const MAX_FILE_BYTES = 2.8 * 1024 * 1024;

// Who may open a file: staff who can read assignments/submissions; a student only for their own course's
// reference files or their own submissions.
async function mayRead(who, id) {
  if (who.access !== 'student') return canRead(who, 'assignments') || canRead(who, 'submissions');
  const [asg, subs, studs] = await Promise.all(['assignments', 'submissions', 'students'].map(async k => ((await store.getState([k]))[0] || {}).value || []));
  const courses = studentCourses(who, studs);
  const has = r => (r.attachments || []).some(a => a && a.id === id);
  return asg.some(a => courses.has(a.course) && has(a)) || subs.some(s => s.studentId === who.studentId && has(s));
}

export default route(['GET', 'POST'], async (req, res) => {
  const { user, who } = await requireWho(req);

  if (req.method === 'POST') {
    if (!writeMode(who, 'assignments') && !writeMode(who, 'submissions')) throw httpError(403, "You can't upload files");
    const { name, type, data } = await readJson(req);
    if (typeof name !== 'string' || typeof data !== 'string' || !name.trim()) throw httpError(400, 'name and data required');
    const buf = Buffer.from(data, 'base64');
    if (!buf.length) throw httpError(400, 'Empty file');
    if (buf.length > MAX_FILE_BYTES) throw httpError(413, 'File is too large — the limit is 2.8 MB');
    const id = crypto.randomBytes(16).toString('hex');
    await store.putFile({ id, name: name.trim().slice(0, 200), mime: String(type || 'application/octet-stream').slice(0, 100), size: buf.length, data_b64: buf.toString('base64'), by: user.id });
    return send(res, 200, { id, name: name.trim().slice(0, 200), size: buf.length });
  }

  const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
  if (!/^[0-9a-f]{32}$/.test(id)) throw httpError(400, 'Bad file id');
  const file = await store.getFile(id);
  if (!file || !(await mayRead(who, id))) throw httpError(404, 'File not found');
  // Always a download, never rendered in our origin, so an uploaded .html can't run as the app.
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(Buffer.from(file.data_b64, 'base64'));
});
