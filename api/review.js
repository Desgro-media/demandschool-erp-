import { route, send, readJson, clientIp } from '../lib/http.js';
import { store } from '../lib/store.js';
import { httpError } from '../lib/policy.js';

// Public, login-free internship feedback. A placement carries two secret review tokens (one for the student to
// rate the partner, one for the partner to rate the student). Knowing a token is the only credential, so this
// endpoint exposes only the names needed to fill the form and accepts exactly one review per token.

const WINDOW_MS = 15 * 60 * 1000, MAX_BAD = 20;
const FIELD = { partner: 'partnerReview', student: 'studentReview' };
const today = () => new Date().toISOString().slice(0, 10);

async function guard(req) {
  const a = await store.getAttempt('review|' + clientIp(req));
  if (a && a.fails >= MAX_BAD && Date.now() - new Date(a.first_at).getTime() < WINDOW_MS) throw httpError(429, 'Too many attempts. Please try again later.');
}
const bad = async req => { await store.recordFail('review|' + clientIp(req), WINDOW_MS); throw httpError(404, 'This link is not valid'); };

function find(placements, token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9]{16,64}$/.test(token)) return null;
  for (const pl of placements) {
    const t = (pl && pl.reviewTokens) || {};
    for (const kind of ['partner', 'student']) if (t[kind] && t[kind] === token) return { pl, kind };
  }
  return null;
}
const value = (rows, key) => (rows.find(r => r.key === key) || {}).value;

export default route(['GET', 'POST'], async (req, res) => {
  await guard(req);
  const body = req.method === 'POST' ? await readJson(req) : {};
  const token = req.method === 'POST' ? body.token : new URL(req.url, 'http://x').searchParams.get('token');

  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await store.getState(['placements', 'placementPartners', 'students']);
    const placements = value(rows, 'placements') || [];
    const hit = find(placements, token);
    if (!hit) return bad(req);
    const { pl, kind } = hit;
    const partner = (value(rows, 'placementPartners') || []).find(p => p.id === pl.partnerId);
    const student = (value(rows, 'students') || []).find(s => s.id === pl.studentId);
    const pos = partner && (partner.positions || []).find(x => x.id === pl.positionId);
    if (!partner || !student) return bad(req);
    const info = { kind, partnerName: partner.name, studentName: student.name, role: pos ? pos.title : '', contactName: partner.contactName || '' };

    if (req.method === 'GET') return send(res, 200, { ...info, done: !!pl[FIELD[kind]] });

    if (pl[FIELD[kind]]) return send(res, 200, { ...info, done: true });
    const rating = Math.round(Number(body.rating));
    if (!(rating >= 1 && rating <= 5)) throw httpError(400, 'Please choose a star rating');
    pl[FIELD[kind]] = {
      rating,
      text: String(body.text || '').trim().slice(0, 1500),
      by: String(body.by || '').trim().slice(0, 80) || (kind === 'partner' ? student.name : partner.contactName || 'Partner'),
      date: today(),
    };
    const rec = rows.find(r => r.key === 'placements');
    const version = await store.setState('placements', placements, rec ? rec.version : 0, null);
    if (version != null) {
      await store.audit(null, 'review.submit', pl.id + ':' + kind);
      return send(res, 200, { ...info, done: true });
    }
    // someone saved the placements collection first: re-read and apply the review again
  }
  throw httpError(409, 'Please try again');
});
