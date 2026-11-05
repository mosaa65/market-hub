Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$StackDir = Join-Path $RepoRoot "deploy/supabase-stack"
$PrivateFiles = @((Join-Path $RepoRoot "deploy/.env.local-production"))
if (Test-Path -LiteralPath $StackDir -PathType Container) {
    $PrivateFiles += @(
        Get-ChildItem -LiteralPath $StackDir -Force -File |
            Where-Object { $_.Name -eq ".env" -or $_.Name.StartsWith(".env.", [StringComparison]::Ordinal) } |
            ForEach-Object { $_.FullName }
    )
}
if ($PrivateFiles.Count -lt 2) {
    throw "The self-hosted Supabase environment file was not found under $StackDir."
}
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
