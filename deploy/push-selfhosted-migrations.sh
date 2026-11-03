#!/usr/bin/env bash
set -Eeuo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly STACK_DIR="$REPO_ROOT/deploy/supabase-stack"
readonly COMPOSE_FILE="$STACK_DIR/docker-compose.yml"
readonly OVERRIDE_FILE="$STACK_DIR/docker-compose.production.override.yaml"
readonly ENV_FILE="$STACK_DIR/.env"
readonly DATABASE_URL="postgresql://postgres@127.0.0.1:5433/postgres?sslmode=disable"

if [[ ! -f "$ENV_FILE" || ! -f "$COMPOSE_FILE" || ! -f "$OVERRIDE_FILE" ]]; then
  echo "Self-hosted Supabase is not prepared. Run deploy/bootstrap-self-hosted-supabase.sh on the Linux server first." >&2
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

echo "This applies pending migrations to the self-hosted production database. It does not reset or delete database data."
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
