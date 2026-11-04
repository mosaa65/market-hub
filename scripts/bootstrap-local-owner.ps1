Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$AppEnvPath = Join-Path $RepoRoot "deploy/.env.local-production"
$StackEnvPath = Join-Path $RepoRoot "deploy/supabase-stack/.env"

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

function Convert-SecureStringToPlainText([SecureString]$Value) {
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

if ((Read-EnvValue $AppEnvPath "SUPABASE_TARGET") -ne "docker" -or
    (Read-EnvValue $AppEnvPath "VITE_SUPABASE_TARGET") -ne "docker" -or
    (Read-EnvValue $AppEnvPath "VITE_SUPABASE_URL") -ne "http://localhost:8000" -or
    (Read-EnvValue $AppEnvPath "SUPABASE_URL") -ne "http://api-gw:8000") {
    throw "Refusing owner setup: the app environment is not the isolated local Docker target."
}

$env:SUPABASE_BOOTSTRAP_URL = "http://localhost:8000"
$env:SUPABASE_BOOTSTRAP_SECRET_KEY = Read-EnvValue $AppEnvPath "SUPABASE_SECRET_KEY"
$env:SUPABASE_BOOTSTRAP_DB_PASSWORD = Read-EnvValue $StackEnvPath "POSTGRES_PASSWORD"
$env:SUPABASE_BOOTSTRAP_OWNER_EMAIL = (Read-Host "Owner email").Trim().ToLowerInvariant()
$env:SUPABASE_BOOTSTRAP_OWNER_NAME = (Read-Host "Owner full name").Trim()

$securePassword = Read-Host "Owner password (minimum 16 characters)" -AsSecureString
$secureConfirmation = Read-Host "Confirm owner password" -AsSecureString
$plainPassword = $null
$plainConfirmation = $null
try {
    $plainPassword = Convert-SecureStringToPlainText $securePassword
    $plainConfirmation = Convert-SecureStringToPlainText $secureConfirmation
    if ($plainPassword -cne $plainConfirmation) {
        throw "The passwords do not match."
    }
    $env:SUPABASE_BOOTSTRAP_OWNER_PASSWORD = $plainPassword

    Push-Location $RepoRoot
    try {
        & node scripts/bootstrap-local-owner.mjs
        if ($LASTEXITCODE -ne 0) {
            throw "Initial owner setup failed with exit code $LASTEXITCODE."
        }
    }
    finally {
        Pop-Location
    }
}
finally {
    $plainPassword = $null
    $plainConfirmation = $null
    Remove-Item Env:SUPABASE_BOOTSTRAP_URL -ErrorAction SilentlyContinue
    Remove-Item Env:SUPABASE_BOOTSTRAP_SECRET_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:SUPABASE_BOOTSTRAP_DB_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:SUPABASE_BOOTSTRAP_OWNER_EMAIL -ErrorAction SilentlyContinue
    Remove-Item Env:SUPABASE_BOOTSTRAP_OWNER_NAME -ErrorAction SilentlyContinue
    Remove-Item Env:SUPABASE_BOOTSTRAP_OWNER_PASSWORD -ErrorAction SilentlyContinue
    $securePassword.Dispose()
    $secureConfirmation.Dispose()
}
