$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Market Hup - Launcher" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Error "Node.js is not installed. Install Node.js and run this file again."
    exit 1
}

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) {
    Write-Error "npm is not installed. Install Node.js and run this file again."
    exit 1
}

Write-Host "[1/4] Installing dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Error "Dependency installation failed."
    exit $LASTEXITCODE
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if ($docker) {
    Write-Host "[2/4] Starting local Supabase..." -ForegroundColor Yellow
    npm run db:local:start
    if ($LASTEXITCODE -ne 0) {
        Write-Warning "Supabase startup reported a problem; continuing anyway because the app may still work with an existing remote connection."
    }
} else {
    Write-Host "[2/4] Docker not found; skipping local Supabase startup." -ForegroundColor Yellow
}

Write-Host "[3/4] Starting the website..." -ForegroundColor Yellow
$devCommand = "Set-Location '$root'; npm run dev"
Start-Process powershell -ArgumentList '-NoExit', '-Command', $devCommand | Out-Null

$siteUrl = $null
for ($i = 0; $i -lt 60; $i++) {
    foreach ($candidate in @('http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002')) {
        try {
            $response = Invoke-WebRequest -Uri $candidate -Method Get -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                $siteUrl = $candidate
                break
            }
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }

    if ($siteUrl) {
        break
    }

    Start-Sleep -Seconds 2
}

if (-not $siteUrl) {
    $siteUrl = 'http://localhost:3000'
}

Write-Host "[4/4] Opening browser..." -ForegroundColor Yellow
Start-Process $siteUrl

Write-Host "Project started successfully." -ForegroundColor Green
Write-Host "URL: $siteUrl" -ForegroundColor Green
Write-Host "If the browser does not open automatically, use this URL: $siteUrl" -ForegroundColor DarkGray
Write-Host "----------------------------------------" -ForegroundColor Cyan
