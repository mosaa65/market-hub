#!/usr/bin/env bash
set -Eeuo pipefail

echo "Migration push is disabled in this checkout: supabase/migrations contains a baseline for new databases." >&2
echo "Do not apply it to an existing self-hosted or cloud database." >&2
echo "The guarded Windows local initializer is: npm run db:selfhosted:push:local" >&2
echo "Existing deployments need a separately reviewed migration-history transition." >&2
exit 1
