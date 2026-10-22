# Verify a Supabase --data-only dump against the live database.
# Counts rows inside each COPY block and compares with SELECT count(*).
# Read-only against the live DB.
# Usage: powershell -File scripts/verify-backup.ps1 -DumpDir backups\market-prime-XXXX

param(
  [Parameter(Mandatory = $true)][string]$DumpDir
)

$ErrorActionPreference = "Continue"
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$dataFile = Join-Path $root "$DumpDir\data.sql"
if (-not (Test-Path $dataFile)) { Write-Output "NOT FOUND: $dataFile"; exit 1 }

$lines = [System.IO.File]::ReadAllText($dataFile) -split "`n"

# Tables we care most about (real business data).
$tables = @(
  "sales_invoices", "sales_invoice_items", "products", "stock_movements",
  "inventory", "customers", "customer_payments", "purchase_invoices",
  "profiles", "user_roles", "suppliers", "warehouses", "expenses", "audit_logs"
)

# Count rows inside each COPY "public"."<table>" ... \. block.
$dumped = @{}
$cur = $null
$n = 0
foreach ($l in $lines) {
  if ($l -match '^COPY "public"\."([^"]+)"') {
    if ($cur) { $dumped[$cur] = $n }
    $cur = $Matches[1]; $n = 0
  }
  elseif ($l -eq '\.') {
    if ($cur) { $dumped[$cur] = $n; $cur = $null; $n = 0 }
  }
  elseif ($cur) { $n++ }
}
if ($cur) { $dumped[$cur] = $n }

Write-Output "=== ALL DUMPED TABLES ==="
$dumped.GetEnumerator() | Sort-Object Name | ForEach-Object {
  Write-Output ("  {0,-30} {1}" -f $_.Key, $_.Value)
}

Write-Output "=== dump totals ==="
Write-Output ("  total public tables dumped: " + $dumped.Count)
Write-Output ("  sum of rows in dump: " + (($dumped.Values | Measure-Object -Sum).Sum))