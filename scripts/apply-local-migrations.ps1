# ============================================================================== 
# scripts/apply-local-migrations.ps1
# Applies pending migrations to the local Docker Supabase database only.
# This script does not reset or delete data. It only applies new SQL files.
# ============================================================================== 

$ErrorActionPreference = "Stop"

# Ensure Docker is available.
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") +
  ";C:\Program Files\Docker\Docker\resources\bin"
$dockerVersion = & docker info --format "{{.ServerVersion}}" 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "Docker daemon is not responding. Open Docker Desktop and wait until it is ready, then retry."
}
Write-Host "[OK] Docker daemon v$dockerVersion" -ForegroundColor Green

# Find the local database container.
$dbContainer = (& docker ps --format "{{.Names}}" | Select-String "supabase_db_").ToString()
if (-not $dbContainer) {
  throw "No supabase_db_* container is running. Start it first with: npm run db:local:start"
}
Write-Host "[OK] Database container: $dbContainer" -ForegroundColor Green

# Read currently applied migrations.
$appliedRaw = docker exec $dbContainer psql -U postgres -d postgres -At -c `
  "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;"
if ($LASTEXITCODE -ne 0) { throw "Could not read supabase_migrations.schema_migrations." }
$applied = @($appliedRaw | Where-Object { $_ -and $_.Trim() -ne "" })
Write-Host "[OK] Applied migrations: $($applied.Count)" -ForegroundColor Green

# List local migration files.
$migrationsDir = Join-Path $PSScriptRoot "..\supabase\migrations"
$files = Get-ChildItem $migrationsDir -Filter "*.sql" | Sort-Object Name
if ($files.Count -eq 0) { throw "No migration files were found in supabase/migrations." }

# Apply only new migration files.
$appliedCount = 0
$skippedCount = 0
foreach ($file in $files) {
  if ($file.BaseName -notmatch '^(\d+)_') {
    Write-Host "[SKIP] $($file.Name) - file name does not start with a version number" -ForegroundColor DarkGray
    continue
  }

  $version = $Matches[1]
  if ($applied -contains $version) {
    $skippedCount++
    continue
  }

  Write-Host "-> Applying: $($file.Name) (version $version)" -ForegroundColor Cyan
  $tmpPath = "/tmp/migration_$version.sql"
  docker cp $file.FullName "${dbContainer}:${tmpPath}"
  if ($LASTEXITCODE -ne 0) { throw "Failed to copy $($file.Name) into the container." }

  docker exec $dbContainer psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f $tmpPath
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to apply $($file.Name). See the SQL error above. The file was not marked as applied."
  }

  docker exec $dbContainer psql -U postgres -d postgres -At -c `
    "INSERT INTO supabase_migrations.schema_migrations(version, name, statements) VALUES ('$version', '$($file.BaseName)', 1) ON CONFLICT (version) DO NOTHING;"
  if ($LASTEXITCODE -ne 0) { throw "Failed to register $version in schema_migrations." }

  $appliedCount++
}

Write-Host ""
Write-Host "════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "Result: applied $($appliedCount) new migration file(s) | skipped $($skippedCount) already applied" -ForegroundColor Green

# Reload PostgREST metadata so new functions are visible to the app.
if ($appliedCount -gt 0) {
  docker exec $dbContainer psql -U postgres -d postgres -At -c "NOTIFY pgrst, 'reload schema';"
  Start-Sleep -Seconds 2
  Write-Host "[OK] PostgREST schema reload triggered" -ForegroundColor Green
}

# Quick verification.
docker exec $dbContainer psql -U postgres -d postgres -At -c `
  "SELECT 'Migrations: ' || count(*) || ' - latest: ' || max(version) FROM supabase_migrations.schema_migrations; SELECT 'Public tables: ' || count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';"
if ($LASTEXITCODE -ne 0) { throw "Post-apply verification failed." }
