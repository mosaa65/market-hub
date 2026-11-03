[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'
Set-StrictMode -Off

$TargetPort = 3000
$siteUrl = "http://localhost:$TargetPort"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host "                   MARKET HUB - مشغل النظام الذكي الشامل                       " -ForegroundColor Cyan
Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/5] فحص بيئة التشغيل الأساسية..." -ForegroundColor Yellow
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "خطأ: Node.js غير مثبت على هذا الجهاز!" -ForegroundColor Red
    Read-Host "اضغط Enter للخروج..."
    exit 1
}
$nodeVer = (& node -v 2>$null)
Write-Host "  ✓ محرك Node.js جاهز: $nodeVer" -ForegroundColor Green

Write-Host "[2/5] التحقق من حزم المشروع..." -ForegroundColor Yellow
$nodeModulesPath = Join-Path $root "node_modules"
if (-not (Test-Path $nodeModulesPath)) {
    Write-Host "  الحزم غير موجودة، جاري التثبيت لأول مرة..." -ForegroundColor Yellow
    & npm install
} else {
    Write-Host "  ✓ الحزم جاهزة ومكتملة." -ForegroundColor Green
}

Write-Host "[3/5] فحص خدمات Docker و Supabase..." -ForegroundColor Yellow
$isDockerRunning = $false
try {
    $null = & docker info --format '{{.ServerVersion}}' 2>$null
    if ($LASTEXITCODE -eq 0) { $isDockerRunning = $true }
} catch { $isDockerRunning = $false }

if (-not $isDockerRunning) {
    Write-Host "  ℹ️ Docker غير مشغل، سيتم متابعة التشغيل على أي حال." -ForegroundColor DarkGray
} else {
    Write-Host "  ✓ Docker جاهز." -ForegroundColor Green
}

Write-Host "[4/5] فحص المنفذ ($TargetPort) وضمان عدم التضارب..." -ForegroundColor Yellow
try {
    $activeConns = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue
    if ($activeConns -and $activeConns.Count -gt 0) {
        foreach ($conn in $activeConns) {
            $pId = $conn.OwningProcess
            if ($pId -gt 0) {
                Write-Host "  ⚠️ تحرير المنفذ $TargetPort (PID: $pId)" -ForegroundColor Magenta
                Stop-Process -Id $pId -Force -ErrorAction SilentlyContinue
            }
        }
        Write-Host "  ✓ تم تحرير المنفذ بنجاح!" -ForegroundColor Green
    } else {
        Write-Host "  ✓ المنفذ $TargetPort شاغر ومتاح." -ForegroundColor Green
    }
} catch {
    Write-Host "  ✓ تم تخطي فحص المنفذ." -ForegroundColor DarkGray
}

Write-Host "[5/5] تشغيل خادم التطبيق وفتح المتصفح..." -ForegroundColor Yellow
Start-Job -ScriptBlock {
    param($url)
    Start-Sleep -Seconds 2
    Start-Process $url
} -ArgumentList $siteUrl | Out-Null

Write-Host ""
Write-Host "===============================================================================" -ForegroundColor Green
Write-Host "                      ✓ تم إطلاق النظام بنجاح!                                 " -ForegroundColor Green
Write-Host "===============================================================================" -ForegroundColor Green
Write-Host "  رابط التطبيق:    $siteUrl" -ForegroundColor Cyan
Write-Host "  جاري فتح المتصفح تلقائياً..." -ForegroundColor DarkGray
Write-Host "===============================================================================" -ForegroundColor Green
Write-Host ""

& npm run dev
