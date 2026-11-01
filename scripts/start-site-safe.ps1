$ErrorActionPreference = 'Continue'
Set-StrictMode -Off

$TargetPort = 3000
$siteUrl = "http://localhost:$TargetPort"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host "                    MARKET HUB - Startup Launcher                     " -ForegroundColor Cyan
Write-Host "========================================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/5] Checking Node.js and npm..." -ForegroundColor Yellow
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "Error: Node.js is not installed." -ForegroundColor Red
    Read-Host "Press Enter to exit..."
    exit 1
}

$nodeVer = (& node -v 2>$null)
Write-Host "  Node.js ready: $nodeVer" -ForegroundColor Green

Write-Host "[2/5] Checking project dependencies..." -ForegroundColor Yellow
if (-not (Test-Path (Join-Path $root "node_modules"))) {
    Write-Host "  node_modules not found. Installing dependencies..." -ForegroundColor Yellow
    & npm install
} else {
    Write-Host "  Dependencies are ready." -ForegroundColor Green
}

Write-Host "[3/5] Checking Docker status..." -ForegroundColor Yellow
$isDockerRunning = $false
try {
    $null = & docker info --format '{{.ServerVersion}}' 2>$null
    if ($LASTEXITCODE -eq 0) {
        $isDockerRunning = $true
    }
} catch {
    $isDockerRunning = $false
}

if ($isDockerRunning) {
    Write-Host "  Docker is running." -ForegroundColor Green
} else {
    Write-Host "  Docker is not running. Continuing without it." -ForegroundColor DarkGray
}

Write-Host "[4/5] Checking port $TargetPort..." -ForegroundColor Yellow
try {
    $activeConns = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue
    if ($activeConns -and $activeConns.Count -gt 0) {
        foreach ($conn in $activeConns) {
            $pId = $conn.OwningProcess
            if ($pId -gt 0) {
                Write-Host "  Releasing port $TargetPort from PID $pId" -ForegroundColor Magenta
                Stop-Process -Id $pId -Force -ErrorAction SilentlyContinue
            }
        }
    }
    Write-Host "  Port $TargetPort is ready." -ForegroundColor Green
} catch {
    Write-Host "  Port check skipped." -ForegroundColor DarkGray
}

Write-Host "[5/5] Starting app and browser..." -ForegroundColor Yellow
Start-Process $siteUrl

Write-Host ""
Write-Host "========================================================================" -ForegroundColor Green
Write-Host "                        App is starting...                           " -ForegroundColor Green
Write-Host "========================================================================" -ForegroundColor Green
Write-Host "  App URL: $siteUrl" -ForegroundColor Cyan
Write-Host "  Browser will open automatically." -ForegroundColor DarkGray
Write-Host "========================================================================" -ForegroundColor Green
Write-Host ""

& npm run dev
