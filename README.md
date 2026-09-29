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
| Storage | `lib/store.js`: Neon in production, JSON file locally; schema in `lib/schema.js` (embedded in code, created automatically on first use) |
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

## When the UI file is updated (by anyone else)

`public/index.html` is the UI with the backend/security integration merged in. If someone delivers a new
copy of the original UI (e.g. `Dschool ERP.html`), do **not** copy it over `public/index.html`; that would
drop the login, sync and security fixes. Instead run:

```bash
python scripts/merge-ui.py "Dschool ERP.html"    # needs Python 3; rewrites public/index.html
```

The integration itself lives in `scripts/merge/`. Every step checks its anchor and stops with a clear
message if the new UI changed something it depends on.

## Sample data

The UI ships with built-in sample data (employees, students, invoices...). On the first sign-in by someone
allowed to write a collection, anything the server has never stored is uploaded, so the database starts as a
copy of that sample data. Restricted roles never see collections they cannot read. To start clean, empty
the arrays in the UI file and run `DELETE FROM app_state;` in the Neon SQL editor. Note the sample data is
also visible to anyone in the page source.

## Known limits

- Each collection is stored and saved as a whole; two people editing the same collection at once get a conflict and their screen refreshes (last-save-wins is deliberately not used).
- Requests are capped at ~4 MB (Vercel limit). Task/assignment attachments currently record only the file name and size, not the file itself; real file storage (e.g. Vercel Blob) would be a separate addition.
- Dates: "today" is the real local date (shown in the top bar). It is read when the page loads; a tab left open past midnight saves and reloads itself. Payroll month sheets are created automatically up to the current month. The built-in sample data keeps its own Aug/Sep 2026 dates, so it ages as time passes.
- Two people editing the *same record* at the same moment: the last save wins for that record (edits to different records are merged, nothing is lost).

## Testing

```bash
npm i --no-save playwright-core          # once (uses your installed Chrome; set CHROME_PATH if it is elsewhere)
npm run dev                              # in one terminal, on a scratch database (delete .data first, then init-db)

ADMIN_PW='<admin password>' node scripts/smoke-test.mjs      # 47 API/security checks
node qa/qa-crawl.mjs                                          # every screen x every role, clicks every control
node qa/qa-detail.mjs                                         # every detail page + all printable documents
node qa/qa-flows.mjs                                          # create employee/student logins, leave approval,
                                                              # simultaneous edits, offline/500, revocation, injection
node qa/qa-dates.mjs                                          # fake clock: new month, year-end, leap day, overnight rollover
```

To test against real PostgreSQL semantics without a Neon database: `bash qa/neon-sim/run.sh`, then repeat the
commands above with `BASE=http://127.0.0.1:3100` (add `CLI=0` for `qa-flows.mjs`).
