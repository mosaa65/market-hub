param(
  [string]$ProjectRef,
  [switch]$IncludeDemoData
)

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot

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
        [Environment]::SetEnvironmentVariable($name, $value, "Process")
      }
    }
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
    throw "Set SUPABASE_DB_URL to this project's direct database URL before deployment. Its value is never printed or stored by this script."
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
