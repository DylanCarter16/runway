#!/usr/bin/env bash
# Runs the schema checks against a scratch Postgres 15+ (not your Supabase project).
# Usage: PGURL=postgres://postgres@localhost:5432/postgres tests/db/run.sh
# Needs psql and the pg_trgm extension (ships with Postgres contrib).
set -euo pipefail
: "${PGURL:?set PGURL to a scratch Postgres superuser connection}"
DB=runway_schema_check
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
psql "$PGURL" -q -c "drop database if exists $DB" -c "create database $DB"
url="${PGURL%/*}/$DB"
psql "$url" -v ON_ERROR_STOP=1 -q -f "$here/supabase-stub.sql"
for f in "$root"/supabase/migrations/*.sql; do
  psql "$url" -v ON_ERROR_STOP=1 -q -f "$f"
done
psql "$url" -q -c "grant usage on schema extensions to anon, authenticated, service_role;"
out="$(psql "$url" -v ON_ERROR_STOP=1 -f "$here/schema-checks.sql" 2>&1)"
echo "$out" | grep -E "T[0-9]+" | sed 's/psql:.*NOTICE:  //'
if echo "$out" | grep -q "FAIL"; then
  echo "Schema checks failed"; exit 1
fi
echo "Schema checks passed"
