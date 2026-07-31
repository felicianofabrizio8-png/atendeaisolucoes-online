#!/usr/bin/env bash
# Harness efêmero para provar o comportamento REAL da RPC
# submit_coach_suggestion_feedback_v2 (cross-tenant + metricsFailed).
#
# Requisitos: binários do PostgreSQL no PATH e execução como usuário
# não-root (initdb recusa root). Nada toca produção: o cluster é criado
# em diretório temporário e destruído ao final.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
DIR="$(mktemp -d)"
PGD="$DIR/data"

export PGPORT="${PGPORT:-54329}"
export PGHOST="$DIR/sock"
export PGDATABASE=postgres
unset PGPASSWORD || true
mkdir -p "$PGHOST" "$PGD"

export PGUSER=postgres
initdb -D "$PGD" -U postgres >/dev/null
pg_ctl -D "$PGD" -o "-k $PGHOST -p $PGPORT -c listen_addresses=''" -l "$DIR/pg.log" -w start >/dev/null
trap 'pg_ctl -D "$PGD" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT

psql -q -v ON_ERROR_STOP=1 -f "$HERE/base.sql"

# Extrai a definição REAL da RPC v2 da migration versionada — o teste
# nunca deve exercitar uma cópia divergente da função.
MIGRATION="$REPO/supabase/migrations/20260730181159_dfb384af-0926-4e9c-99a8-9810c8e7faaa.sql"
awk '/CREATE OR REPLACE FUNCTION public.submit_coach_suggestion_feedback_v2/,/^\$\$;$/' \
  "$MIGRATION" > "$DIR/v2.sql"
test -s "$DIR/v2.sql"
psql -q -v ON_ERROR_STOP=1 -f "$DIR/v2.sql"

psql -v ON_ERROR_STOP=1 -f "$HERE/scenarios.sql"
