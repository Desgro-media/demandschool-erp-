// Local server: serves /public and mounts the same handlers Vercel runs from /api.
// Uses the JSON-file store in .data/ unless DATABASE_URL is set.   npm run dev
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(root, 'public');
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };

// Same headers vercel.json applies in production, so local testing catches CSP breakage early.
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const secHeaders = vercel.headers[0].headers;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    for (const h of secHeaders) if (h.key !== 'Strict-Transport-Security') res.setHeader(h.key, h.value);

    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5).replace(/[^a-z-]/gi, '');
      const file = path.join(root, 'api', name + '.js');
      if (!name || !fs.existsSync(file)) { res.statusCode = 404; return res.end('{"error":"Not found"}'); }
      const mod = await import(`file://${file.replace(/\\/g, '/')}`);
      return mod.default(req, res);
    }

    let rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const file = path.normalize(path.join(pub, rel));
    if (!file.startsWith(pub + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.statusCode = 404; return res.end('Not found');
    }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(file).pipe(res);
  } catch (err) {
    console.error(err);
    res.statusCode = 500; res.end('Server error');
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`Demand School ERP running at http://localhost:${PORT}`));
