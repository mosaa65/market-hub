Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$StackDir = Join-Path $RepoRoot "deploy/supabase-stack"
$StackEnvPath = Join-Path $StackDir ".env"
$AppEnvPath = Join-Path $RepoRoot "deploy/.env.local-production"
$ComposePath = Join-Path $StackDir "docker-compose.yml"
$OverridePath = Join-Path $StackDir "docker-compose.local-production.override.yaml"
$SupabaseCli = Join-Path $RepoRoot "node_modules/.bin/supabase.cmd"
$DatabaseUrl = "postgresql://postgres@127.0.0.1:5433/postgres?sslmode=disable"

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
foreach ($migration in Get-ChildItem -LiteralPath (Join-Path $RepoRoot "supabase/migrations") -Filter "*.sql" -File) {
    if ($migration.Name -notmatch '^([0-9]+)_[a-z0-9_]+\.sql$') {
        throw "Invalid migration filename: $($migration.Name)"
    }
    $version = $Matches[1]
    if ($versions.ContainsKey($version)) {
        throw "Duplicate migration version ${version}: $($versions[$version]) and $($migration.Name)"
    }
    $versions[$version] = $migration.Name
}

$PostgresPassword = Read-EnvValue $StackEnvPath "POSTGRES_PASSWORD"
if ($PostgresPassword -notmatch '^[A-Fa-f0-9]{32}$') {
    throw "The generated Postgres password is missing or has an unexpected format. No migration was run."
}

Write-Host "This applies pending migrations to the local Docker production database. It does not reset or delete data."
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

    Push-Location $RepoRoot
    try {
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
