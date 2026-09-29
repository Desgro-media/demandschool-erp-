#!/usr/bin/env bash
# Runs the app on http://127.0.0.1:3100 with the REAL lib/store.js Neon code path, but with the Neon driver
# swapped for PGlite (genuine PostgreSQL compiled to WebAssembly, in memory). Lets you test the SQL and the
# first-run bootstrap without a Neon database:   bash qa/neon-sim/run.sh   (then run qa scripts with BASE=http://127.0.0.1:3100)
set -e
SIM="$(cd "$(dirname "$0")" && pwd)"
PROJ="$(cd "$SIM/../.." && pwd)"
APP="$SIM/app"
mkdir -p "$APP"
if [ ! -d "$APP/node_modules/@electric-sql/pglite" ]; then
  (cd "$APP" && echo '{"name":"neon-sim","private":true,"type":"module"}' > package.json && npm i @electric-sql/pglite --silent)
fi
for d in lib api scripts public; do rm -rf "$APP/$d"; cp -r "$PROJ/$d" "$APP/$d"; done
cp "$PROJ/dev-server.js" "$PROJ/vercel.json" "$APP/"
mkdir -p "$APP/node_modules/@neondatabase/serverless"
cp "$SIM/shim-index.mjs" "$APP/node_modules/@neondatabase/serverless/index.mjs"
echo '{ "name": "@neondatabase/serverless", "type": "module", "main": "index.mjs", "exports": "./index.mjs" }' > "$APP/node_modules/@neondatabase/serverless/package.json"
cd "$APP"
DATABASE_URL="postgres://sim" ADMIN_INITIAL_PASSWORD="${ADMIN_INITIAL_PASSWORD:-Demand2026!Admin}" PORT=3100 exec node dev-server.js
