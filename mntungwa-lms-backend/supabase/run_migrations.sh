#!/usr/bin/env bash
# Rebuild the verification database from zero and apply every migration in order.
# Exits non-zero on the first failure. Used for local verification only.
set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
export PGHOST=/tmp PGPORT=5433 PGUSER=postgres
HERE="$(cd "$(dirname "$0")" && pwd)"

# --- ensure server is up -----------------------------------------------------
if ! pg_isready -q 2>/dev/null; then
  chown -R postgres:postgres /home/claude/pgdata 2>/dev/null || true
  su postgres -c "$PGBIN/pg_ctl -D /home/claude/pgdata -l /tmp/pg.log -o '-p 5433 -k /tmp' start" >/dev/null 2>&1 || true
  for _ in $(seq 1 20); do pg_isready -q && break; sleep 0.5; done
fi
pg_isready -q || { echo "FATAL: postgres not reachable"; exit 1; }

# --- rebuild database --------------------------------------------------------
psql -q -c "DROP DATABASE IF EXISTS lms;" >/dev/null
psql -q -c "CREATE DATABASE lms;"        >/dev/null

run() {
  local f="$1"
  if psql -d lms -v ON_ERROR_STOP=1 -q -f "$f" 2>/tmp/err.txt; then
    printf '  ok   %s\n' "$(basename "$f")"
  else
    printf '  FAIL %s\n' "$(basename "$f")"
    sed 's/^/       /' /tmp/err.txt
    exit 1
  fi
}

echo "== shim (local only) =="
run "$HERE/tests/00_local_shim.sql"

echo "== migrations =="
for f in "$HERE"/migrations/*.sql; do run "$f"; done

if [ "${1:-}" = "--seed" ]; then
  echo "== seed =="
  run "$HERE/seed.sql"
fi

if [ "${1:-}" = "--test" ] || [ "${2:-}" = "--test" ]; then
  echo "== tests =="
  for f in "$HERE"/tests/[1-9]*.sql; do [ -e "$f" ] && run "$f"; done
fi

echo "ALL APPLIED CLEAN"
