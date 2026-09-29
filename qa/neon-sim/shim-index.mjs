// Stand-in for @neondatabase/serverless backed by PGlite (real PostgreSQL compiled to WASM).
// Purpose: run the project's real lib/store.js Neon code path (its SQL) against a genuine Postgres parser
// and planner. It mimics the driver's public surface: tagged-template calls, sql.query(text, params),
// rows returned as an array, and int8 (bigint) columns returned as strings like the real driver does.
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.waitReady;

const BIGINT = 20;
async function run(text, params = []) {
  const res = await db.query(text, params);
  return res.rows.map(row => {
    const out = { ...row };
    for (const f of res.fields) if (f.dataTypeID === BIGINT && out[f.name] != null) out[f.name] = String(out[f.name]);
    return out;
  });
}

export function neon() {
  const sql = (strings, ...values) => {
    if (!strings || !strings.raw) throw new Error('This driver version needs sql.query() for plain strings');
    let text = strings[0];
    for (let i = 0; i < values.length; i++) text += `$${i + 1}${strings[i + 1]}`;
    return run(text, values);
  };
  sql.query = (text, params) => run(text, params);
  return sql;
}
