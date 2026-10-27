param()

$ErrorActionPreference = "Stop"
$repoRoot = Split-Path -Parent $PSScriptRoot
$projectId = "kwzqvgdyadylwnvjghqn"
$confirmation = "RESET LOCAL $projectId"

function Invoke-Supabase {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  $output = & supabase @Arguments 2>&1
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference

  foreach ($line in $output) {
    $text = [string]$line
    if ($text -match 'ANON_KEY|PUBLISHABLE_KEY|SECRET_KEY|SERVICE_ROLE_KEY|JWT_SECRET|S3_PROTOCOL_ACCESS_KEY') {
      continue
    }
    Write-Host $text
  }
  if ($exitCode -ne 0) {
    throw "Supabase CLI command failed: supabase $($Arguments -join ' ')"
  }
}

Write-Host "This rebuild deletes the local Docker database only." -ForegroundColor Yellow
Write-Host "It does not reset or modify the linked cloud database." -ForegroundColor Yellow
$answer = Read-Host "Type '$confirmation' to continue"
if ($answer -cne $confirmation) {
  throw "Local rebuild cancelled. No database changes were made."
}

docker info --format "{{.ServerVersion}}" | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Docker Desktop is not ready. Start Docker Desktop and retry."
}

Invoke-Supabase start
Invoke-Supabase db reset --local --yes

$container = "supabase_db_$projectId"
$sampleSeed = Join-Path $repoRoot "supabase\seeds\03_samples\sample-mill.sql"
docker cp $sampleSeed "$($container):/tmp/sample-mill.sql" | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Could not copy the sample-mill seed into the local database container."
}
docker exec $container psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /tmp/sample-mill.sql
if ($LASTEXITCODE -ne 0) {
  throw "The local sample-mill seed failed."
}

$migrationFiles = Get-ChildItem (Join-Path $repoRoot "supabase\migrations") -Filter "*.sql" | Where-Object { $_.BaseName -match '^\d+_' } | Sort-Object Name
$expectedVersion = ($migrationFiles[-1].BaseName -split "_", 2)[0]
$verifySql = @"
SELECT
  count(*),
  max(version),
  (SELECT count(*) FROM public.grain_types),
  (SELECT count(*) FROM public.products WHERE is_custody_item),
  (SELECT count(*) FROM public.products WHERE item_class = 'SERVICE' AND name_ar = 'أجور طحن وتجهيز' AND NOT is_custody_item),
  (SELECT count(*) FROM public.products WHERE is_custody_item AND (
      item_nature <> 'GOOD'
      OR inventory_policy <> 'CUSTOMER_OWNED'
      OR tracking <> 'NONE'
      OR costing_method <> 'NONE'
      OR is_sellable
      OR is_purchasable
      OR sale_price <> 0
      OR cost_price <> 0
      OR tax_rate <> 0
      OR item_class NOT IN ('RAW_MATERIAL','FINISHED_GOOD','BY_PRODUCT')
  )),
  (SELECT count(*) FROM auth.users WHERE id::text LIKE 'a0000000-%' AND encrypted_password IS NOT NULL)
FROM supabase_migrations.schema_migrations;
"@
$verifyOutput = docker exec $container psql -U postgres -d postgres -At -F "`t" -v ON_ERROR_STOP=1 -c $verifySql 2>&1
$verifyExitCode = $LASTEXITCODE
if ($verifyExitCode -ne 0) {
  $verifyOutput | ForEach-Object { Write-Host $_ }
  throw "Could not verify the rebuilt local database."
}
$verification = ([string]($verifyOutput | Select-Object -Last 1)).Trim() -split "`t"
if ($verification.Count -ne 7 -or $verification[1] -ne $expectedVersion) {
  throw "Local verification failed: expected migration $expectedVersion."
}
if ([int]$verification[2] -ne 4 -or [int]$verification[3] -ne 8 -or [int]$verification[4] -ne 1 -or [int]$verification[5] -ne 0 -or [int]$verification[6] -ne 4) {
  throw "Local verification failed: expected 8 isolated mill-custody items, 1 non-custody service, 4 grain types, 4 demo accounts, and no invalid custody product."
}

Write-Host "Local Supabase is rebuilt and verified." -ForegroundColor Green
Write-Host "API:    http://127.0.0.1:54321"
Write-Host "Studio: http://127.0.0.1:54323"
Write-Host "Migrations: $($verification[0]), latest: $($verification[1])"
Write-Host "Mill custody items: $($verification[3]); milling service items: $($verification[4]); invalid custody items: $($verification[5]); grain types: $($verification[2]); demo accounts: $($verification[6])"
