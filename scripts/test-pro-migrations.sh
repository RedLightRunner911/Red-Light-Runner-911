#!/usr/bin/env bash
# Applies the Pro billing migrations to a throwaway local Postgres (with a minimal auth/roles stub)
# and checks ownership, relink, founder-claim and delete-restrict behavior. Never touches Supabase.
set -euo pipefail
PGBIN=${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)}
DIR=$(mktemp -d); PORT=${PORT:-55439}
trap '"$PGBIN/pg_ctl" -D "$DIR" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
"$PGBIN/initdb" -D "$DIR" -A trust -U postgres >/dev/null
"$PGBIN/pg_ctl" -D "$DIR" -o "-p $PORT -k $DIR -c listen_addresses=''" -l "$DIR/log" start >/dev/null
q() { psql -X -q -v ON_ERROR_STOP=1 -h "$DIR" -p "$PORT" -U postgres -d postgres "$@"; }
q <<'SQL'
create role anon; create role authenticated; create role service_role;
create schema auth; create table auth.users (id uuid primary key);
SQL
for f in supabase/migrations/20261117000000_play_pro_entitlements.sql \
         supabase/migrations/20261118000000_pro_purchase_owner_immutable.sql \
         supabase/migrations/20261119000000_pro_founder_auto_claim_and_relink.sql; do q -f "$f"; done
q -f scripts/pro-migrations-check.sql
