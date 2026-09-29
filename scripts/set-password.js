// Reset any login from the command line:  npm run set-password -- you@x.com "NewPassw0rd"
import { store } from '../lib/store.js';
import { hashPassword, validatePassword } from '../lib/auth.js';

const email = String(process.argv[2] || '').toLowerCase();
const pw = process.argv[3];
const bad = validatePassword(pw);
if (!email || bad) { console.error(bad || 'usage: set-password <email> <password>'); process.exit(1); }
const u = await store.getUserByEmail(email);
if (!u) { console.error('No such user'); process.exit(1); }
await store.updateUser(u.id, { password_hash: await hashPassword(pw) });
console.log('Password updated; existing sessions revoked.');
process.exit(0);
