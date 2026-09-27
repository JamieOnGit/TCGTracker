#!/usr/bin/env bash
# Applies every migration to a fresh database and runs the SQL test suite.
#   PGHOST/PGPORT/PGUSER select the server (defaults: local socket, postgres).
# Used locally and in CI (.github/workflows/tcg-ci.yml).
set -euo pipefail
cd "$(dirname "$0")/.."
DB="${TEST_DB:-tcg_test}"
export PGUSER="${PGUSER:-postgres}"
psql -q -v ON_ERROR_STOP=1 -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f tests/supabase_stub.sql
for f in migrations/*.sql; do
  echo "applying $f"
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done
psql -v ON_ERROR_STOP=1 -d "$DB" -f tests/rls.test.sql 2>&1 | sed -n 's/^psql:[^N]*NOTICE:  //p; /All database tests passed/p; /ERROR/p'
test "${PIPESTATUS[0]}" -eq 0
