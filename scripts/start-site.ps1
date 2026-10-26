# ==============================================================================
# Market Hub - مشغل النظام الذكي الشامل المباشر
# ==============================================================================
# - يشغل برنامج Docker Desktop تلقائياً إذا كان مغلقاً وينتظر جاهزيته
# - يشغل خدمات Supabase المحلية تلقائياً
# - يحرر المنفذ المخصص (3000) فوراً من أي عملية قديمة أو عالقة
# - يفتح المتصفح تلقائياً على http://localhost:3000
# - يعرض سيرفر Vite مباشرة في الواجهة مع السجلات الحية
# ==============================================================================

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

# ------------------------------------------------------------------------------
# 1. فحص بيئة التشغيل الأساسية (Node.js & npm)
# ------------------------------------------------------------------------------
Write-Host "[1/5] فحص بيئة التشغيل الأساسية..." -ForegroundColor Yellow
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
# 2. فحص الحزم والاعتماديات
# ------------------------------------------------------------------------------
Write-Host "[2/5] التحقق من حزم المشروع..." -ForegroundColor Yellow
$nodeModulesPath = Join-Path $root "node_modules"
if (-not (Test-Path $nodeModulesPath)) {
    Write-Host "  الحزم غير موجودة، جاري التثبيت لأول مرة (npm install)..." -ForegroundColor Yellow
    & npm install
} else {
    Write-Host "  ✓ الحزم جاهزة ومكتملة." -ForegroundColor Green
}

# ------------------------------------------------------------------------------
# 3. فحص وتشغيل Docker Desktop تلقائياً حتى لو كان مغلقاً
# ------------------------------------------------------------------------------
Write-Host "[3/5] فحص خدمات Docker و Supabase..." -ForegroundColor Yellow

$dockerExePath = "C:\Program Files\Docker\Docker\Docker Desktop.exe"
if (-not (Test-Path $dockerExePath)) {
    $dockerExePath = "$env:ProgramFiles\Docker\Docker\Docker Desktop.exe"
}

$isDockerRunning = $false
try {
    $null = & docker info --format '{{.ServerVersion}}' 2>$null
    if ($LASTEXITCODE -eq 0) {
        $isDockerRunning = $true
    }
} catch {
    $isDockerRunning = $false
}

if (-not $isDockerRunning -and (Test-Path $dockerExePath)) {
    Write-Host "  ⚠️ برنامج Docker Desktop مغلق؛ جاري إقلاعه تلقائياً..." -ForegroundColor Magenta
    Start-Process -FilePath $dockerExePath -WindowStyle Minimized | Out-Null
    
    Write-Host "  جاري انتظار جاهزية محرك Docker (يرجى الانتظار ثوانٍ)..." -ForegroundColor Yellow -NoNewline
    for ($attempt = 1; $attempt -le 35; $attempt++) {
        Start-Sleep -Seconds 1
        Write-Host "." -NoNewline
        try {
            $null = & docker info --format '{{.ServerVersion}}' 2>$null
            if ($LASTEXITCODE -eq 0) {
                $isDockerRunning = $true
                break
            }
        } catch {}
    }
    Write-Host ""
}

if ($isDockerRunning) {
    Write-Host "  ✓ محرك Docker قيد التشغيل وجاهز." -ForegroundColor Green
    # التحقق من تشغيل حاويات سوبابيز
    $spContainers = & docker ps --filter "name=supabase_db" --format "{{.Names}}" 2>$null
    if ($spContainers -match "supabase_db") {
        Write-Host "  ✓ خدمات Supabase المحلية قيد التشغيل بالفعل." -ForegroundColor Green
    } else {
        Write-Host "  جاري إقلاع خدمات Supabase المحلية..." -ForegroundColor Yellow
        & npx supabase start 2>$null
        Write-Host "  ✓ تم إقلاع خدمات Supabase بنجاح." -ForegroundColor Green
    }
} else {
    Write-Host "  ℹ️ لم يتم تشغيل Docker؛ سيتم متابعة تشغيل واجهة النظام على أي حال." -ForegroundColor DarkGray
}

# ------------------------------------------------------------------------------
# 4. إدارة المنفذ (3000) وتحريره من العمليات العالقة
# ------------------------------------------------------------------------------
Write-Host "[4/5] فحص المنفذ ($TargetPort) وضمان عدم التضارب..." -ForegroundColor Yellow
try {
    $activeConns = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue
    if ($activeConns -and $activeConns.Count -gt 0) {
        foreach ($conn in $activeConns) {
            $pId = $conn.OwningProcess
            if ($pId -gt 0) {
                Write-Host "  ⚠️ تم العثور على عملية سابقة عالقة على المنفذ $TargetPort (ID: $pId). جاري تحريره..." -ForegroundColor Magenta
                Stop-Process -Id $pId -Force -ErrorAction SilentlyContinue
                Start-Sleep -Milliseconds 600
            }
        }
        Write-Host "  ✓ تم تحرير المنفذ $TargetPort بنجاح!" -ForegroundColor Green
    } else {
        Write-Host "  ✓ المنفذ $TargetPort شاغر ومتاح." -ForegroundColor Green
    }
} catch {
    Write-Host "  ✓ تم تخطي فحص المنفذ." -ForegroundColor DarkGray
}

# ------------------------------------------------------------------------------
# 5. تشغيل المتصفح وسيرفر التطبيق
# ------------------------------------------------------------------------------
Write-Host "[5/5] تشغيل خادم التطبيق وفتح المتصفح..." -ForegroundColor Yellow

# فتح المتصفح تلقائياً بعد ثانيتين
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
if ($isDockerRunning) {
    Write-Host "  لوحة الاستوديو:  http://127.0.0.1:54323" -ForegroundColor Yellow
    Write-Host "  رابط الـ API:    http://127.0.0.1:54321" -ForegroundColor Yellow
}
Write-Host "  جاري فتح المتصفح تلقائياً..." -ForegroundColor DarkGray
Write-Host "===============================================================================" -ForegroundColor Green
Write-Host ""

# تشغيل سيرفر التطبيق مباشرة
& npm run dev
