param(
  [string]$ProjectRef,
  [switch]$IncludeDemoData
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$cloudDbUrlOverride = $env:SUPABASE_CLOUD_DB_URL

function Invoke-Supabase {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  $displayArguments = [System.Collections.Generic.List[string]]::new()
  for ($index = 0; $index -lt $Arguments.Count; $index++) {
    if ($Arguments[$index] -eq "--db-url" -and $index + 1 -lt $Arguments.Count) {
      $displayArguments.Add("--db-url")
      $displayArguments.Add("<redacted database URL>")
      $index++
      continue
    }
    $displayArguments.Add($Arguments[$index])
  }

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $output = & supabase @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference

  foreach ($line in $output) {
    $text = [string]$line
    if ($text -match 'ANON_KEY|PUBLISHABLE_KEY|SECRET_KEY|SERVICE_ROLE_KEY|JWT_SECRET|S3_PROTOCOL_ACCESS_KEY|postgres(?:ql)?://\S+') {
      continue
    }
    Write-Host $text
  }
  if ($exitCode -ne 0) {
    throw "Supabase CLI command failed: supabase $($displayArguments -join ' ')"
  }
}

Push-Location $repoRoot
try {
  $envFile = Join-Path $repoRoot ".env"
  if (Test-Path $envFile) {
    foreach ($line in Get-Content $envFile) {
      $trimmed = $line.Trim()
      if ($trimmed -match '^[A-Za-z_][A-Za-z0-9_]*\s*=') {
        $parts = $trimmed -split '=', 2
        $name = $parts[0].Trim()
        $value = $parts[1].Trim().Trim('"').Trim("'")
        if ($cloudDbUrlOverride -and $name -in @("SUPABASE_DB_URL", "SUPABASE_DB_PASSWORD")) {
          continue
        }
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
      }
    }
  }

  # Keep the app's local .env target intact while allowing a one-process cloud
  # connection override. The URI is validated below and is never printed.
  if ($cloudDbUrlOverride) {
    $env:SUPABASE_DB_URL = $cloudDbUrlOverride
  }

  $linkedRefPath = Join-Path $repoRoot "supabase\.temp\project-ref"

  if ($ProjectRef) {
    Write-Host "Linking this workspace to cloud project $ProjectRef..." -ForegroundColor Cyan
    Invoke-Supabase link --project-ref $ProjectRef
  }

  if (-not (Test-Path $linkedRefPath)) {
    throw "No cloud project is linked. Run: supabase link --project-ref <project-ref>"
  }
  $linkedRef = (Get-Content $linkedRefPath -Raw).Trim()
  if ($ProjectRef -and $linkedRef -ne $ProjectRef) {
    throw "Linked project mismatch: expected $ProjectRef, found $linkedRef."
  }

  if (-not $env:SUPABASE_DB_URL) {
    throw "Set SUPABASE_DB_URL in .env or SUPABASE_CLOUD_DB_URL in this process to this project's direct database URL. Its value is never printed or stored by this script."
  }
  try {
    $databaseHost = ([uri]$env:SUPABASE_DB_URL).Host
  } catch {
    throw "SUPABASE_DB_URL is not a valid URL."
  }
  $databaseUri = [uri]$env:SUPABASE_DB_URL
  $databaseUserInfo = [uri]::UnescapeDataString($databaseUri.UserInfo)
  $databaseCredentials = $databaseUserInfo -split ":", 2
  if ($databaseCredentials.Count -ne 2 -or -not $databaseCredentials[1]) {
    throw "SUPABASE_DB_URL must include the target database password in its user-info section."
  }

  $directConnection = $databaseHost -eq "db.$linkedRef.supabase.co" -and $databaseCredentials[0] -eq "postgres"
  $poolerConnection = $databaseHost -match '^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$' -and $databaseCredentials[0] -eq "postgres.$linkedRef"
  if (-not ($directConnection -or $poolerConnection)) {
    throw "SUPABASE_DB_URL host/user does not identify linked project $linkedRef."
  }
  $env:SUPABASE_DB_PASSWORD = $databaseCredentials[1]

  # Permit an empty target, or an existing cloud whose ledger is a complete
  # prefix of the approved 001-017 baseline. This allows forward migrations
  # added after the original 001-015 rebuild, while refusing mixed histories.
  $baselineSafetySql = @'
WITH migration_state AS (
  SELECT
    count(*)::int AS migration_count,
    string_agg(version::text, ',' ORDER BY version) AS versions,
    count(*) FILTER (WHERE version NOT IN ('001','002','003','004','005','006','007','008','009','010','011','012','013','014','015','016','017'))::int AS other_count
  FROM supabase_migrations.schema_migrations
), public_state AS (
  SELECT count(*)::int AS relation_count
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
)
SELECT CASE
  WHEN migration_state.other_count > 0 THEN 'INCOMPATIBLE_HISTORY'
  WHEN migration_state.migration_count = 0 AND public_state.relation_count = 0 THEN 'EMPTY_BASELINE_TARGET'
  WHEN migration_state.versions IN (
    '001,002,003,004,005,006,007,008,009,010,011,012,013,014,015',
    '001,002,003,004,005,006,007,008,009,010,011,012,013,014,015,016',
    '001,002,003,004,005,006,007,008,009,010,011,012,013,014,015,016,017'
  ) THEN 'BASELINE_READY'
  ELSE 'UNSAFE_TARGET'
END AS migration_target
FROM migration_state CROSS JOIN public_state;
'@
  $baselineSafetySql = ($baselineSafetySql -replace '\s+', ' ').Trim()
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $safetyOutput = & supabase db query --db-url $env:SUPABASE_DB_URL $baselineSafetySql 2>&1
  $safetyExitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
  if ($safetyExitCode -ne 0) {
    throw "Could not safely verify the cloud schema and migration ledger. No cloud migration was run."
  }
  $safetyText = $safetyOutput -join "`n"
  if ($safetyText -notmatch "EMPTY_BASELINE_TARGET|BASELINE_READY") {
    throw "Refusing to push migrations into this cloud project: its schema is not empty and its migration history is not a complete 001-017 baseline prefix."
  }

  Write-Host "Target cloud project: $linkedRef" -ForegroundColor Yellow
  Write-Host "This command applies pending migrations and safe system reference seeds only. It never resets the cloud database." -ForegroundColor Yellow
  $confirmation = Read-Host "Type CLOUD $linkedRef to continue"
  if ($confirmation -cne "CLOUD $linkedRef") {
    throw "Cloud deployment cancelled. No database changes were made."
  }

  # Use the validated direct connection URI from SUPABASE_DB_URL. `--linked`
  # can select a pooler endpoint independently and fail even when this URI is
  # valid; this also keeps schema deployment on the exact verified target.
  Invoke-Supabase db push --db-url $env:SUPABASE_DB_URL

  if ($IncludeDemoData) {
    Write-Host "WARNING: this adds test platform accounts and fictitious mill business data." -ForegroundColor Red
    $demoConfirmation = Read-Host "Type DEMO DATA $linkedRef to continue"
    if ($demoConfirmation -cne "DEMO DATA $linkedRef") {
      throw "Demo seed cancelled. Migrations and safe reference seeds remain applied."
    }
  }

  $seedArgs = @("scripts/apply-cloud-seeds.mjs", $linkedRef)
  if ($IncludeDemoData) { $seedArgs += "--include-demo" }
  node @seedArgs
  if ($LASTEXITCODE -ne 0) { throw "Cloud seed application failed. The database URL was not printed." }

  Write-Host "Cloud migrations and safe reference seeds completed for $linkedRef." -ForegroundColor Green
  Write-Host "The migration push used the validated direct database URL."
}
finally {
  Pop-Location
}
