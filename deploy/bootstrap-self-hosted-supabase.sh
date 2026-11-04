#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly SUPABASE_REF="self-hosted/v0.8.3"
readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly STACK_DIR="$REPO_ROOT/deploy/supabase-stack"
MODE="public"
if [[ "${1:-}" == "--local" ]]; then
  MODE="local"
  shift
fi

if [[ "$MODE" == "local" ]]; then
  readonly APP_ENV_FILE="$REPO_ROOT/deploy/.env.local-production"
else
  readonly APP_ENV_FILE="$REPO_ROOT/deploy/.env.production"
fi

usage() {
  echo "Usage: bash deploy/bootstrap-self-hosted-supabase.sh <app-domain> <supabase-api-domain>" >&2
  echo "Example: bash deploy/bootstrap-self-hosted-supabase.sh erp.example.com api.example.com" >&2
  echo "Local Windows Docker Desktop host: bash deploy/bootstrap-self-hosted-supabase.sh --local" >&2
}

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "Run this bootstrap from Linux/WSL with Docker Desktop integration enabled." >&2
  exit 1
fi

if [[ "$MODE" == "local" ]]; then
  if [[ $# -ne 0 ]]; then
    usage
    exit 2
  fi
  APP_DOMAIN="app.localhost"
  SUPABASE_DOMAIN="api.localhost"
  APP_URL="http://localhost:3001"
  API_URL="http://localhost:8000"
else
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
  APP_URL="https://$APP_DOMAIN"
  API_URL="https://$SUPABASE_DOMAIN"
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
if [[ -e "$APP_ENV_FILE" ]]; then
  echo "Refusing to overwrite existing application environment: $APP_ENV_FILE" >&2
  echo "Review and back it up manually before preparing a new production stack." >&2
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
# The app provisions store staff through this project's Edge Function. Add all
# project functions beside the official router before the stack is started.
mkdir -p "$STACK_DIR/volumes/functions"
cp -a "$REPO_ROOT/supabase/functions/." "$STACK_DIR/volumes/functions/"
if [[ "$MODE" == "local" ]]; then
  cp "$REPO_ROOT/deploy/supabase-local-production.override.yaml" \
    "$STACK_DIR/docker-compose.local-production.override.yaml"
else
  cp "$REPO_ROOT/deploy/supabase-production.override.yaml" \
    "$STACK_DIR/docker-compose.production.override.yaml"
fi
cp "$STACK_DIR/.env.example" "$STACK_DIR/.env"
printf 'ref=%s\n' "$SUPABASE_REF" > "$STACK_DIR/.supabase-version"

# Generate unique installation secrets locally. Suppress stdout because the
# official generators print API keys as well as writing them to the private env.
(
  cd "$STACK_DIR"
  sh utils/generate-keys.sh --update-env >/dev/null
  sh utils/add-new-auth-keys.sh --update-env >/dev/null
)

python3 - "$STACK_DIR/.env" "$APP_DOMAIN" "$SUPABASE_DOMAIN" "$APP_URL" "$API_URL" "$MODE" <<'PY'
from pathlib import Path
import sys
import subprocess

env_path = Path(sys.argv[1])
app_domain = sys.argv[2]
supabase_domain = sys.argv[3]
app_url = sys.argv[4]
api_url = sys.argv[5]
mode = sys.argv[6]
api_external_url = f"{api_url}/auth/v1" if mode == "local" else api_url
dashboard_password = "Vx" + subprocess.run(
    ["openssl", "rand", "-hex", "24"], check=True, capture_output=True, text=True
).stdout.strip()
values = {
    "SUPABASE_PUBLIC_URL": api_url,
    "API_EXTERNAL_URL": api_external_url,
    "SITE_URL": app_url,
    "ADDITIONAL_REDIRECT_URLS": f"{app_url}/**",
    "PROXY_DOMAIN": supabase_domain,
    "DISABLE_SIGNUP": "true",
    "ENABLE_PHONE_SIGNUP": "false",
    "ENABLE_EMAIL_AUTOCONFIRM": "false",
    "ENABLE_PHONE_AUTOCONFIRM": "false",
    "ENABLE_ANONYMOUS_USERS": "false",
    "DASHBOARD_PASSWORD": dashboard_password,
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

python3 - "$STACK_DIR/.env" "$APP_ENV_FILE" "$APP_DOMAIN" "$SUPABASE_DOMAIN" "$APP_URL" "$API_URL" <<'PY'
from pathlib import Path
import os
import sys

stack_env = Path(sys.argv[1])
app_env = Path(sys.argv[2])
app_domain = sys.argv[3]
supabase_domain = sys.argv[4]
app_url = sys.argv[5]
api_url = sys.argv[6]
stack_values = {}
for line in stack_env.read_text(encoding="utf-8").splitlines():
    if not line or line.lstrip().startswith("#") or "=" not in line:
        continue
    key, value = line.split("=", 1)
    stack_values[key] = value

required = ("SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY")
missing = [key for key in required if not stack_values.get(key)]
if missing:
    raise SystemExit("Generated Supabase environment is missing required API keys; application env was not written.")

content = "\n".join((
    "VITE_SUPABASE_TARGET=docker",
    f"VITE_SUPABASE_URL={api_url}",
    f"VITE_SUPABASE_PUBLISHABLE_KEY={stack_values['SUPABASE_PUBLISHABLE_KEY']}",
    "SUPABASE_TARGET=docker",
    "SUPABASE_URL=http://api-gw:8000",
    f"SUPABASE_PUBLISHABLE_KEY={stack_values['SUPABASE_PUBLISHABLE_KEY']}",
    f"SUPABASE_SECRET_KEY={stack_values['SUPABASE_SECRET_KEY']}",
    f"APP_DOMAIN={app_domain}",
    f"SUPABASE_DOMAIN={supabase_domain}",
    "",
))
fd = os.open(app_env, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as stream:
    stream.write(content)
os.chmod(app_env, 0o600)
PY

chmod 600 "$STACK_DIR/.env"
chmod 600 "$APP_ENV_FILE"
find "$STACK_DIR" -maxdepth 1 -type f -name '.env*' -exec chmod 600 {} +
echo "Prepared the official Supabase stack in deploy/supabase-stack."
echo "Prepared $APP_ENV_FILE from the generated stack keys with private file permissions."
echo "Secret values were not printed."
echo "The database stack was not started. Review the deployment guide and local disk/network constraints first."
