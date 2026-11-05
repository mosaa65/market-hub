Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$BootstrapScript = Join-Path $RepoRoot "deploy/bootstrap-self-hosted-supabase.sh"
$ProtectScript = Join-Path $PSScriptRoot "protect-local-production-env.ps1"
$StackDir = Join-Path $RepoRoot "deploy/supabase-stack"
$AppEnvFile = Join-Path $RepoRoot "deploy/.env.local-production"

if (-not (Test-Path -LiteralPath $BootstrapScript -PathType Leaf)) {
    throw "Local production bootstrap script is missing: $BootstrapScript"
}

$GitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
if (-not $GitCommand) {
    $GitCommand = Get-Command git -ErrorAction SilentlyContinue
}
if (-not $GitCommand) {
    throw "Git for Windows is required to provide Git Bash."
}

$GitInstallDir = Split-Path -Parent (Split-Path -Parent $GitCommand.Source)
$GitBash = Join-Path $GitInstallDir "bin/bash.exe"
if (-not (Test-Path -LiteralPath $GitBash -PathType Leaf)) {
    throw "Git Bash was not found beside Git for Windows: $GitBash"
}

foreach ($Path in @($StackDir, $AppEnvFile)) {
    if (Test-Path -LiteralPath $Path) {
        throw "Refusing to overwrite existing local production data or secrets: $Path"
    }
}

$DockerCommand = Get-Command docker.exe -ErrorAction SilentlyContinue
if (-not $DockerCommand) {
    $DockerCommand = Get-Command docker -ErrorAction SilentlyContinue
}
if (-not $DockerCommand) {
    throw "Docker Desktop CLI is not available in PATH."
}

$ComposeVersion = (& $DockerCommand.Source compose version --short).Trim().TrimStart('v')
if ($LASTEXITCODE -ne 0 -or $ComposeVersion -notmatch '^\d+\.\d+\.\d+') {
    throw "Docker Compose could not be queried. Start Docker Desktop and try again."
}
if ([version]$ComposeVersion -lt [version]'2.24.4') {
    throw "Docker Compose 2.24.4 or newer is required; found $ComposeVersion."
}

Push-Location $RepoRoot
try {
    & $GitBash -lc 'bash deploy/bootstrap-self-hosted-supabase.sh --local'
    if ($LASTEXITCODE -ne 0) {
        throw "Supabase bootstrap failed with exit code $LASTEXITCODE. No containers were started."
    }

    & (Join-Path $env:SystemRoot "System32/WindowsPowerShell/v1.0/powershell.exe") `
        -NoProfile -ExecutionPolicy Bypass -File $ProtectScript
    if ($LASTEXITCODE -ne 0) {
        throw "Bootstrap completed, but Windows secret-file permissions could not be restricted. Do not start the stack until this is fixed."
    }
}
finally {
    Pop-Location
}

Write-Host "Prepared the local production configuration from Windows PowerShell."
Write-Host "No containers were started and no database migrations were applied."
