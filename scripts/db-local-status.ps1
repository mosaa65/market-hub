$ErrorActionPreference = "Stop"

$previousPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
$output = & supabase status --output json 2>&1
$exitCode = $LASTEXITCODE
$ErrorActionPreference = $previousPreference

if ($exitCode -ne 0) {
  foreach ($line in $output) { Write-Host $line }
  throw "Could not read local Supabase status."
}

$jsonStart = -1
for ($index = 0; $index -lt $output.Count; $index++) {
  if (([string]$output[$index]).Trim() -eq "{") {
    $jsonStart = $index
    break
  }
}
if ($jsonStart -lt 0) { throw "Supabase status did not return JSON." }
$jsonText = ($output[$jsonStart..($output.Count - 1)] -join [Environment]::NewLine)
$jsonEnd = $jsonText.LastIndexOf("}")
if ($jsonEnd -lt 0) { throw "Supabase status returned incomplete JSON." }
$status = $jsonText.Substring(0, $jsonEnd + 1) | ConvertFrom-Json
$projectRefPath = Join-Path $PSScriptRoot "..\supabase\.temp\project-ref"
$projectRef = if (Test-Path $projectRefPath) { (Get-Content $projectRefPath -Raw).Trim() } else { $null }

[pscustomobject]@{
  ProjectRef = $projectRef
  API = $status.API_URL
  REST = $status.REST_URL
  Database = $status.DB_URL
  Studio = $status.STUDIO_URL
  Mailpit = $status.MAILPIT_URL
} | Format-List
