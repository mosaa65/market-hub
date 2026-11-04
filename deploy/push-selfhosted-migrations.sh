#!/usr/bin/env bash
set -Eeuo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly STACK_DIR="$REPO_ROOT/deploy/supabase-stack"
readonly COMPOSE_FILE="$STACK_DIR/docker-compose.yml"
readonly ENV_FILE="$STACK_DIR/.env"
readonly DATABASE_URL="postgresql://postgres@127.0.0.1:5433/postgres?sslmode=disable"
MODE="public"
if [[ "${1:-}" == "--local" ]]; then
  MODE="local"
  shift
fi
if [[ $# -ne 0 ]]; then
  echo "Usage: bash deploy/push-selfhosted-migrations.sh [--local]" >&2
  exit 2
fi
if [[ "$MODE" == "local" ]]; then
  readonly OVERRIDE_FILE="$STACK_DIR/docker-compose.local-production.override.yaml"
else
  readonly OVERRIDE_FILE="$STACK_DIR/docker-compose.production.override.yaml"
fi

# Supabase tracks applied migrations by the numeric filename prefix. Fail before
# connecting to production if a duplicate version could make the ledger ambiguous.
declare -A migration_versions=()
for migration_path in "$REPO_ROOT"/supabase/migrations/*.sql; do
  migration_name="${migration_path##*/}"
  if [[ ! "$migration_name" =~ ^([0-9]+)_[a-z0-9_]+\.sql$ ]]; then
    echo "Invalid migration filename: $migration_name" >&2
    exit 1
  fi
  migration_version="${BASH_REMATCH[1]}"
  if [[ -n "${migration_versions[$migration_version]:-}" ]]; then
    echo "Duplicate migration version $migration_version: ${migration_versions[$migration_version]} and $migration_name" >&2
    exit 1
  fi
  migration_versions[$migration_version]="$migration_name"
done

if [[ ! -f "$ENV_FILE" || ! -f "$COMPOSE_FILE" || ! -f "$OVERRIDE_FILE" ]]; then
  if [[ "$MODE" == "local" ]]; then
    echo "Local self-hosted Supabase is not prepared. Run deploy/bootstrap-self-hosted-supabase.sh --local from WSL first." >&2
  else
    echo "Self-hosted Supabase is not prepared. Run deploy/bootstrap-self-hosted-supabase.sh on the Linux server first." >&2
  fi
  exit 1
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "Node.js/npm is required on the Linux server. Install dependencies with npm ci first." >&2
  exit 1
fi

postgres_password="$(awk -F= '$1 == "POSTGRES_PASSWORD" { sub(/^[^=]*=/, ""); value=$0; count++ } END { if (count != 1) exit 1; print value }' "$ENV_FILE" | tr -d '\r')"
if [[ ! "$postgres_password" =~ ^[[:xdigit:]]{32}$ ]]; then
  echo "The production Postgres password is missing or has an unexpected format. No migration was run." >&2
  exit 1
fi

if [[ "$MODE" == "local" ]]; then
  echo "This applies pending migrations to the local Docker production database. It does not reset or delete database data."
else
  echo "This applies pending migrations to the self-hosted production database. It does not reset or delete database data."
fi
read -r -p 'Type APPLY SELF-HOSTED MIGRATIONS to continue: ' confirmation
if [[ "$confirmation" != "APPLY SELF-HOSTED MIGRATIONS" ]]; then
  echo "Cancelled."
  exit 1
fi

export PGPASSWORD="$postgres_password"
export SUPABASE_DB_URL="$DATABASE_URL"
unset postgres_password

docker compose --project-name supabase --env-file "$ENV_FILE" -f "$COMPOSE_FILE" -f "$OVERRIDE_FILE" \
  exec -T db pg_isready -U postgres -d postgres >/dev/null

cd "$REPO_ROOT"
npx supabase db push --db-url "$SUPABASE_DB_URL"
node scripts/apply-selfhosted-seeds.mjs
