# ==============================================================================
# Vortex ERP - مشغل النظام الذكي المباشر (Vortex Smart Launcher)
# ==============================================================================
# - يحرر المنفذ المخصص (Port 3000) فوراً من أي عملية عالقة
# - يدعم الدومين الفخم vortex.erp أو localhost
# - يفتح المتصفح تلقائياً ويعرض سيرفر Vite مباشرة أمام المستخدم دون نوافذ خفية
# ==============================================================================

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'
Set-StrictMode -Off

$TargetPort = 3000
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host "                   VORTEX ERP - مشغل النظام الذكي المباشر                       " -ForegroundColor Cyan
Write-Host "===============================================================================" -ForegroundColor Cyan
Write-Host ""

# ------------------------------------------------------------------------------
# 1. فحص بيئة التشغيل الأساسية (Node.js & npm)
# ------------------------------------------------------------------------------
Write-Host "[1/4] فحص بيئة التشغيل..." -ForegroundColor Yellow
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Host "خطأ: Node.js غير مثبت على هذا الجهاز!" -ForegroundColor Red
    Write-Host "يرجى تثبيت Node.js من: https://nodejs.org" -ForegroundColor DarkGray
    Read-Host "اضغط Enter للخروج..."
    exit 1
}
$nodeVer = (& node -v)
Write-Host "  ✓ محرك Node.js جاهز: $nodeVer" -ForegroundColor Green

# ------------------------------------------------------------------------------
# 2. فحص الحزم (تثبيت فوري بدون تأخير إذا كانت موجودة)
# ------------------------------------------------------------------------------
Write-Host "[2/4] التحقق من حزم المشروع..." -ForegroundColor Yellow
$nodeModulesPath = Join-Path $root "node_modules"
if (-not (Test-Path $nodeModulesPath)) {
    Write-Host "  الحزم غير موجودة، جاري التثبيت لأول مرة (npm install)..." -ForegroundColor Yellow
    & npm install
} else {
    Write-Host "  ✓ الحزم جاهزة ومكتملة." -ForegroundColor Green
}

# ------------------------------------------------------------------------------
# 3. إدارة المنفذ 3000 وتحريره من العمليات العالقة
# ------------------------------------------------------------------------------
Write-Host "[3/4] فحص المنفذ ($TargetPort) وتحرير أي عملية سابقة..." -ForegroundColor Yellow
try {
    $activeConns = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue
    if ($activeConns -and $activeConns.Count -gt 0) {
        foreach ($conn in $activeConns) {
            $pId = $conn.OwningProcess
            if ($pId -gt 0) {
                Write-Host "  ⚠️ تم العثور على عملية سابقة عالقة على المنفذ $TargetPort (ID: $pId). جاري إغلاقها..." -ForegroundColor Magenta
                Stop-Process -Id $pId -Force -ErrorAction SilentlyContinue
                Start-Sleep -Milliseconds 600
            }
        }
        Write-Host "  ✓ تم تحرير المنفذ $TargetPort بنجاح!" -ForegroundColor Green
    } else {
        Write-Host "  ✓ المنفذ $TargetPort شاغر وجاهز." -ForegroundColor Green
    }
} catch {
    Write-Host "  ✓ تم تخطي فحص المنفذ." -ForegroundColor DarkGray
}

# ------------------------------------------------------------------------------
# 4. تحديد الدومين وتشغيل المتصفح وسيرفر التطبيق
# ------------------------------------------------------------------------------
Write-Host "[4/4] تجهيز رابط النظام وتشغيل السيرفر..." -ForegroundColor Yellow

$siteUrl = "http://localhost:$TargetPort"
try {
    $dnsVortex = [System.Net.Dns]::GetHostAddresses("vortex.erp") 2>$null
    if ($dnsVortex -and ($dnsVortex | Where-Object { $_.IPAddressToString -eq "127.0.0.1" })) {
        $siteUrl = "http://vortex.erp:$TargetPort"
    } else {
        $dnsMarket = [System.Net.Dns]::GetHostAddresses("market-hub.local") 2>$null
        if ($dnsMarket -and ($dnsMarket | Where-Object { $_.IPAddressToString -eq "127.0.0.1" })) {
            $siteUrl = "http://market-hub.local:$TargetPort"
        }
    }
} catch {}

# تشغيل فتح المتصفح في الخلفية بعد ثانيتين حتى يكون السيرفر قد استجاب
Start-Job -ScriptBlock {
    param($target)
    Start-Sleep -Seconds 2
    Start-Process $target
} -ArgumentList $siteUrl | Out-Null

Write-Host ""
Write-Host "===============================================================================" -ForegroundColor Green
Write-Host "               ✓ جاري تشغيل سيرفر VORTEX ERP الآن!                             " -ForegroundColor Green
Write-Host "===============================================================================" -ForegroundColor Green
Write-Host "  رابط الدخول: $siteUrl" -ForegroundColor Cyan
if ($siteUrl -eq "http://localhost:$TargetPort") {
    Write-Host "  (لتفعيل الرابط الفخم http://vortex.erp:$TargetPort شغل setup-local-domain.bat)" -ForegroundColor DarkGray
}
Write-Host "  سيتم فتح المتصفح تلقائياً..." -ForegroundColor Yellow
Write-Host "===============================================================================" -ForegroundColor Green
Write-Host ""

# تشغيل خادم التطبيق مباشرة داخل نفس النافذة ليرى المستخدم السجلات الحية
& npm run dev
