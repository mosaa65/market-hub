#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly SUPABASE_REF="self-hosted/v0.8.3"
readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly STACK_DIR="$REPO_ROOT/deploy/supabase-stack"

usage() {
  echo "Usage: bash deploy/bootstrap-self-hosted-supabase.sh <app-domain> <supabase-api-domain>" >&2
  echo "Example: bash deploy/bootstrap-self-hosted-supabase.sh erp.example.com api.example.com" >&2
}

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Run this bootstrap on the Linux production server, not on the Windows development PC." >&2
  exit 1
fi

if [[ $# -ne 2 ]]; then
  usage
  exit 2
fi

APP_DOMAIN="$1"
SUPABASE_DOMAIN="$2"
domain_pattern='^([A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$'
if [[ ! "$APP_DOMAIN" =~ $domain_pattern || ! "$SUPABASE_DOMAIN" =~ $domain_pattern ]]; then
  echo "Both arguments must be real DNS hostnames, without scheme, path, or port." >&2
  exit 2
fi
if [[ "$APP_DOMAIN" == "$SUPABASE_DOMAIN" ]]; then
  echo "Use separate hostnames for the application and Supabase API." >&2
  exit 2
fi

for command_name in git python3 openssl jq docker; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is missing: $command_name" >&2
    exit 1
  fi
done

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose is not available to this Linux user." >&2
  exit 1
fi
compose_version="$(docker compose version --short | sed 's/^v//')"
minimum_compose_version="2.24.4"
if [[ "$(printf '%s\n' "$minimum_compose_version" "$compose_version" | sort -V | head -n 1)" != "$minimum_compose_version" ]]; then
  echo "Docker Compose $minimum_compose_version or newer is required for the production port override." >&2
  exit 1
fi

if [[ -e "$STACK_DIR" ]]; then
  echo "Refusing to replace existing self-hosted Supabase directory: $STACK_DIR" >&2
  echo "Move or back it up manually only after reviewing its contents." >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

echo "Fetching the official Supabase Docker configuration at $SUPABASE_REF..."
git clone --quiet --depth 1 --branch "$SUPABASE_REF" --filter=blob:none --sparse \
  https://github.com/supabase/supabase.git "$tmp_dir/upstream"
git -C "$tmp_dir/upstream" sparse-checkout set docker

upstream_docker="$tmp_dir/upstream/docker"
if ! grep -Eq '^name:[[:space:]]*supabase$' "$upstream_docker/docker-compose.yml" || \
  ! grep -Eq '^  api-gw:' "$upstream_docker/docker-compose.yml" || \
  ! grep -Eq '^  supavisor:' "$upstream_docker/docker-compose.yml" || \
  ! grep -Eq '^  db:' "$upstream_docker/docker-compose.yml"; then
  echo "The pinned official Compose layout differs from the expected network and service names." >&2
  exit 1
fi

mkdir -p "$STACK_DIR"
cp -a "$upstream_docker/." "$STACK_DIR/"
cp "$REPO_ROOT/deploy/supabase-production.override.yaml" \
  "$STACK_DIR/docker-compose.production.override.yaml"
cp "$STACK_DIR/.env.example" "$STACK_DIR/.env"
printf 'ref=%s\n' "$SUPABASE_REF" > "$STACK_DIR/.supabase-version"

# Generate unique installation secrets locally. Suppress stdout because the
# official generators print API keys as well as writing them to the private env.
(
  cd "$STACK_DIR"
  sh utils/generate-keys.sh --update-env >/dev/null
  sh utils/add-new-auth-keys.sh --update-env >/dev/null
)

python3 - "$STACK_DIR/.env" "$APP_DOMAIN" "$SUPABASE_DOMAIN" <<'PY'
from pathlib import Path
import sys

env_path = Path(sys.argv[1])
app_domain = sys.argv[2]
supabase_domain = sys.argv[3]
values = {
    "SUPABASE_PUBLIC_URL": f"https://{supabase_domain}",
    "API_EXTERNAL_URL": f"https://{supabase_domain}",
    "SITE_URL": f"https://{app_domain}",
    "ADDITIONAL_REDIRECT_URLS": f"https://{app_domain}/**",
    "PROXY_DOMAIN": supabase_domain,
    "DISABLE_SIGNUP": "true",
    "ENABLE_EMAIL_AUTOCONFIRM": "false",
    "ENABLE_PHONE_AUTOCONFIRM": "false",
    "ENABLE_ANONYMOUS_USERS": "false",
}
lines = env_path.read_text(encoding="utf-8").splitlines()
for key, value in values.items():
    prefix = f"{key}="
    for index, line in enumerate(lines):
        if line.startswith(prefix):
            lines[index] = prefix + value
            break
    else:
        lines.append(prefix + value)
env_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
PY

chmod 600 "$STACK_DIR/.env"
find "$STACK_DIR" -maxdepth 1 -type f -name '.env*' -exec chmod 600 {} +
echo "Prepared the official Supabase stack in deploy/supabase-stack."
echo "Secrets were generated locally and their values were not printed."
echo "The database stack was not started. Review DNS, .env permissions, and the deployment guide first."
