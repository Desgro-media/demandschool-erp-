// Undo an import: put the collections the importer touched back to a backup file's contents.
//   node --env-file=.env.local scripts/restore-backup.js backup-app_state-<time>.json [--apply]
// A collection is only restored if nobody has saved it since the import (live version == backup version + 1);
// otherwise it is skipped and reported, so work done in the app after the import is never overwritten.
import fs from 'node:fs';
import { store } from '../lib/store.js';

const file = process.argv.slice(2).find(a => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
if (!file) { console.error('Usage: node scripts/restore-backup.js <backup.json> [--apply]'); process.exit(1); }

const IMPORTED = ['COURSES', 'courseSettings', 'batches', 'employees', 'leaveRequests', 'advances', 'attendanceByDate',
  'payroll', 'students', 'invoices', 'marketingLeads', 'contentItems'];
const backup = new Map(JSON.parse(fs.readFileSync(file, 'utf8')).map(r => [r.key, r]));
await store.init();
const live = new Map((await store.getState(IMPORTED)).map(r => [r.key, r]));

for (const key of IMPORTED) {
  const b = backup.get(key), l = live.get(key);
  if (!b || !l) { console.log(`  ${key}: not in backup/live, skipped`); continue; }
  if (l.version !== b.version + 1) { console.log(`  ${key}: changed after the import (v${b.version} -> v${l.version}), skipped`); continue; }
  if (!apply) { console.log(`  ${key}: would restore v${b.version} contents`); continue; }
  const ver = await store.setState(key, b.value, l.version, null);
  console.log(`  ${key}: ${ver == null ? 'FAILED, changed while restoring' : 'restored'}`);
}
if (!apply) console.log('\nDry run only. Re-run with --apply to restore.');
process.exit(0);
