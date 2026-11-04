Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$PrivateFiles = @(
    (Join-Path $RepoRoot "deploy/.env.local-production"),
    (Join-Path $RepoRoot "deploy/supabase-stack/.env")
)
$CurrentUserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$IcaclsPath = Join-Path $env:SystemRoot "System32/icacls.exe"

foreach ($PrivateFile in $PrivateFiles) {
    if (-not (Test-Path -LiteralPath $PrivateFile -PathType Leaf)) {
        throw "Required private environment file is missing: $PrivateFile"
    }

    $Grants = @(
        "*$($CurrentUserSid):(F)"
        "*S-1-5-18:(F)"
        "*S-1-5-32-544:(F)"
    )
    & $IcaclsPath $PrivateFile /inheritance:r /grant:r @Grants | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not restrict access to private environment file: $PrivateFile"
    }
    Write-Host "Restricted access to $PrivateFile"
}
