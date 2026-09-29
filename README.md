# Demand School ERP

Single-page ERP (`public/index.html`) with a Vercel serverless backend (`api/`) and Neon Postgres storage.

## Run locally

```bash
npm install
ADMIN_INITIAL_PASSWORD='ChooseSomething1' npm run init-db   # creates the first admin (EMP-101)
npm run dev                                                  # http://localhost:3000
```

Without `DATABASE_URL`, data is kept in `.data/store.json` (development only; refused in production).
To develop against Neon instead: `vercel env pull .env.local` then `node --env-file=.env.local dev-server.js`.

Sign in as `ADMIN_EMAIL` (default `thanseemca@gmail.com`) with the password you set. Add staff in
HR > Directory (the form's password field creates their login) and students in Admissions (optional portal password).

## Deploy to Vercel + Neon

1. Push this folder to a Git repo and import it in Vercel.
2. Vercel project > **Storage** > add **Neon**. This injects `DATABASE_URL`.
3. Project > Settings > Environment Variables: add `SESSION_SECRET` (48+ random chars):
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
4. Deploy, then create tables and the admin once from your machine:
   ```bash
   vercel env pull .env.local
   ADMIN_INITIAL_PASSWORD='ChooseSomething1' node --env-file=.env.local scripts/init-db.js
   ```
5. Sign in, then rotate the password: `npm run set-password -- you@x.com "NewPassw0rd"`.

## Architecture

| Piece | Where |
|---|---|
| UI | `public/index.html` (in-memory model, hydrated from / synced to the API) |
| Auth | `api/login.js`, `logout.js`, `me.js`, `users.js`; scrypt hashes, signed HttpOnly `sid` cookie (8h) |
| Data | `api/state.js`: one JSON document per collection in `app_state`, versioned (optimistic concurrency) |
| Authorization | `lib/policy.js`: per-role read/write sets, per-record scoping, anti-escalation rules |
| Storage | `lib/store.js`: Neon in production, JSON file locally; schema in `db/schema.sql` |
| Headers / CSP | `vercel.json` (dev server applies the same) |

## Security notes

- Passwords: scrypt with per-user salt; never stored in app state, never returned by the API.
- Login: generic error for every failure, constant-ish timing for unknown emails, lockout after 5 failures per email+IP (15 min) or 15 per email.
- Sessions: HMAC-signed, `HttpOnly`, `SameSite=Strict`, `Secure` in production; changing a password revokes all of that user's sessions.
- CSRF: `SameSite=Strict` + required `X-Requested-With` header + JSON content type + Origin check.
- Roles are enforced on the server (leadership / HR / sales / staff / student); HR cannot grant leadership roles or reset a leadership password.
- Client: `javascript:` links blocked (`safeUrl`), inline-handler arguments encoded (`jsq`), print window detached from opener.
- CSP still needs `'unsafe-inline'` for scripts because the UI uses inline `onclick=` handlers; moving them to `addEventListener` would let you drop it.
- Every state write and login is recorded in `audit_log`.

## Known limits

- Each collection is stored and saved as a whole; two people editing the same collection at once get a conflict and their screen refreshes (last-save-wins is deliberately not used).
- Requests are capped at ~4 MB (Vercel limit); large base64 task attachments will hit this. Move files to Vercel Blob if that matters.
- Tests: with the dev server running, `ADMIN_PW=... node scripts/smoke-test.mjs` (it writes test users; run on a scratch `.data`).
