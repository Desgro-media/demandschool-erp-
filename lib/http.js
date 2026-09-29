const MAX_BODY = 4 * 1024 * 1024; // Vercel's own limit is 4.5 MB

export function send(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

export async function readJson(req) {
  if (req.body !== undefined && req.body !== null && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) { const e = new Error('Payload too large'); e.status = 413; throw e; }
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

export function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function clientIp(req) {
  return String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

// CSRF defence on top of SameSite=Strict: state-changing requests must be JSON, carry the custom
// header (which a cross-site form cannot set) and, when an Origin header is present, match our host.
export function assertSameOrigin(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const fail = () => { const e = new Error('Bad request origin'); e.status = 403; throw e; };
  if (req.headers['x-requested-with'] !== 'demand-erp') fail();
  if (!/^application\/json/i.test(req.headers['content-type'] || '')) fail();
  const origin = req.headers.origin;
  if (origin) {
    let host; try { host = new URL(origin).host; } catch { fail(); }
    if (host !== req.headers.host) fail();
  }
}

// Wraps a handler: method allow-list, CSRF check, uniform JSON errors (never leaks stack traces).
export function route(methods, fn) {
  return async (req, res) => {
    try {
      if (!methods.includes(req.method)) return send(res, 405, { error: 'Method not allowed' }, { Allow: methods.join(', ') });
      assertSameOrigin(req);
      await fn(req, res);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      send(res, status, { error: status >= 500 ? 'Server error' : err.message });
    }
  };
}
