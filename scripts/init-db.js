// Creates tables (Neon) and the first admin login. Safe to re-run.
//   local (file store):  ADMIN_INITIAL_PASSWORD=... node scripts/init-db.js
//   Neon:                vercel env pull .env.local && node --env-file=.env.local scripts/init-db.js
import { store, storeKind } from '../lib/store.js';
import { hashPassword, validatePassword } from '../lib/auth.js';

await store.init();
console.log(`Storage ready (${await storeKind()}).`);

const email = String(process.env.ADMIN_EMAIL || 'thanseemca@gmail.com').toLowerCase();
const existing = await store.getUserByRef('staff', 'EMP-101');
if (existing) {
  console.log(`Admin already exists (${existing.email}). Use "npm run set-password" to reset it.`);
} else {
  const pw = process.env.ADMIN_INITIAL_PASSWORD;
  const bad = validatePassword(pw);
  if (bad) { console.error(`Set ADMIN_INITIAL_PASSWORD first: ${bad}`); process.exit(1); }
  await store.createUser({ email, password_hash: await hashPassword(pw), kind: 'staff', ref_id: 'EMP-101', bootstrap: 'leadership' });
  console.log(`Created admin ${email} (EMP-101).`);
}
process.exit(0);
