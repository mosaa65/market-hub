Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$StackDir = Join-Path $RepoRoot "deploy/supabase-stack"
$StackEnvPath = Join-Path $StackDir ".env"
$AppEnvPath = Join-Path $RepoRoot "deploy/.env.local-production"
$ComposePath = Join-Path $StackDir "docker-compose.yml"
$OverridePath = Join-Path $StackDir "docker-compose.local-production.override.yaml"
$SupabaseCli = Join-Path $RepoRoot "node_modules/.bin/supabase.cmd"
$MigrationPath = Join-Path $RepoRoot "supabase/migrations"
$DatabaseUrl = "postgresql://supabase_admin@127.0.0.1:5433/postgres?sslmode=disable"

function Read-EnvValue([string]$Path, [string]$Name) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Required private environment file is missing: $Path"
    }
    $prefix = "$Name="
    $foundRows = @(Get-Content -LiteralPath $Path | Where-Object { $_.StartsWith($prefix, [StringComparison]::Ordinal) })
    if ($foundRows.Count -ne 1) {
        throw "Expected exactly one $Name entry in the private environment file."
    }
    return $foundRows[0].Substring($prefix.Length).Trim()
}

foreach ($path in @($StackEnvPath, $AppEnvPath, $ComposePath, $OverridePath, $SupabaseCli)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "Local production setup is incomplete: $path"
    }
}

if ((Read-EnvValue $AppEnvPath "SUPABASE_TARGET") -ne "docker" -or
    (Read-EnvValue $AppEnvPath "VITE_SUPABASE_TARGET") -ne "docker" -or
    (Read-EnvValue $AppEnvPath "VITE_SUPABASE_URL") -ne "http://localhost:8000" -or
    (Read-EnvValue $AppEnvPath "SUPABASE_URL") -ne "http://api-gw:8000") {
    throw "Refusing migration: the app environment is not the isolated local Docker target."
}

$versions = @{}
$migrations = @(Get-ChildItem -LiteralPath $MigrationPath -Filter "*.sql" -File | Sort-Object Name)
if ($migrations.Count -ne 17) {
    throw "Expected the approved 17-file baseline in supabase/migrations; found $($migrations.Count)."
}
foreach ($migration in $migrations) {
    if ($migration.Name -notmatch '^([0-9]{3})_[a-z0-9_]+\.sql$') {
        throw "Invalid active baseline filename: $($migration.Name)"
    }
    $version = $Matches[1]
    if ($versions.ContainsKey($version)) {
        throw "Duplicate migration version ${version}: $($versions[$version]) and $($migration.Name)"
    }
    $versions[$version] = $migration.Name
}
$actualVersions = ($versions.Keys | Sort-Object) -join ","
if ($actualVersions -ne "001,002,003,004,005,006,007,008,009,010,011,012,013,014,015,016,017") {
    throw "Active migration versions do not match the approved baseline sequence."
}

$PostgresPassword = Read-EnvValue $StackEnvPath "POSTGRES_PASSWORD"
if ($PostgresPassword -notmatch '^[A-Fa-f0-9]{32}$') {
    throw "The generated Postgres password is missing or has an unexpected format. No migration was run."
}

Write-Host "This applies the 15 baseline migrations to the local Docker production database. It does not reset or delete data."
$confirmation = Read-Host "Type APPLY SELF-HOSTED MIGRATIONS to continue"
if ($confirmation -cne "APPLY SELF-HOSTED MIGRATIONS") {
    throw "Cancelled; no migration was run."
}

$env:PGPASSWORD = $PostgresPassword
$env:SUPABASE_DB_URL = $DatabaseUrl
try {
    $publishedDbPort = @(& docker compose --project-name supabase --env-file $StackEnvPath -f $ComposePath -f $OverridePath port db 5432)
    if ($LASTEXITCODE -ne 0 -or $publishedDbPort.Count -ne 1 -or $publishedDbPort[0].Trim() -ne "127.0.0.1:5433") {
        throw "Refusing migration: this Compose project does not publish its database only at 127.0.0.1:5433."
    }

    & docker compose --project-name supabase --env-file $StackEnvPath -f $ComposePath -f $OverridePath exec -T db pg_isready -U postgres -d postgres | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Local production PostgreSQL is not healthy; no migration was run."
    }

    $publicObjectCheck = @'
SELECT
  (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S'))
  + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public')
  + (SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public' AND t.typtype IN ('e', 'd'));
'@
    $publicObjectState = @(& docker compose --project-name supabase --env-file $StackEnvPath -f $ComposePath -f $OverridePath exec -T db psql -U postgres -d postgres -Atqc $publicObjectCheck)
    if ($LASTEXITCODE -ne 0 -or $publicObjectState.Count -ne 1 -or $publicObjectState[0].Trim() -ne "0") {
        throw "Refusing baseline migration: the local database already has public objects. No migration was run."
    }
    $migrationLedgerExists = @(& docker compose --project-name supabase --env-file $StackEnvPath -f $ComposePath -f $OverridePath exec -T db psql -U postgres -d postgres -Atqc "SELECT to_regclass('supabase_migrations.schema_migrations') IS NOT NULL")
    if ($LASTEXITCODE -ne 0 -or $migrationLedgerExists.Count -ne 1) {
        throw "Could not verify the local migration ledger. No migration was run."
    }
    if ($migrationLedgerExists[0].Trim() -eq "t") {
        $appliedMigrationCount = @(& docker compose --project-name supabase --env-file $StackEnvPath -f $ComposePath -f $OverridePath exec -T db psql -U postgres -d postgres -Atqc "SELECT count(*) FROM supabase_migrations.schema_migrations")
        if ($LASTEXITCODE -ne 0 -or $appliedMigrationCount.Count -ne 1 -or $appliedMigrationCount[0].Trim() -ne "0") {
            throw "Refusing baseline migration: the local migration ledger already contains entries. No migration was run."
        }
    }

    Push-Location $RepoRoot
    try {
        & $SupabaseCli db push --dry-run --db-url $DatabaseUrl
        if ($LASTEXITCODE -ne 0) {
            throw "Supabase migration dry-run failed with exit code $LASTEXITCODE."
        }

        $canAssumeMigrationOwner = @(& docker compose --project-name supabase --env-file $StackEnvPath -f $ComposePath -f $OverridePath exec -T db psql -U supabase_admin -d postgres -Atqc "SELECT pg_has_role('postgres', 'supabase_admin', 'MEMBER')")
        if ($LASTEXITCODE -ne 0 -or $canAssumeMigrationOwner.Count -ne 1) {
            throw "Could not verify the local migration-owner permission. No migration was run."
        }
        if ($canAssumeMigrationOwner[0].Trim() -ne "t") {
            & docker compose --project-name supabase --env-file $StackEnvPath -f $ComposePath -f $OverridePath exec -T db psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -c "GRANT supabase_admin TO postgres"
            if ($LASTEXITCODE -ne 0) {
                throw "Could not grant the local migration role required by the Supabase baseline. No migration was run."
            }
        }

        & $SupabaseCli db push --db-url $DatabaseUrl
        if ($LASTEXITCODE -ne 0) {
            throw "Supabase migration push failed with exit code $LASTEXITCODE."
        }

        & node scripts/apply-selfhosted-seeds.mjs
        if ($LASTEXITCODE -ne 0) {
            throw "System seed application failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:SUPABASE_DB_URL -ErrorAction SilentlyContinue
    $PostgresPassword = $null
}
